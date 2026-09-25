// Exercise modules/io.js against the tailscaled running on this machine.
//
// Run by scripts/localapi-check.sh under plain gjs, with no gnome-shell and no
// compositor. That is possible only because modules/io.js imports nothing from
// resource:///, and it is the reason io.js is split out of modules/panel.js at
// all: a stub of libsoup can only prove that the stub behaves, whereas this
// proves the daemon still answers with the shape modules/state.js expects.

import GLib from 'gi://GLib';

import { dirtyFrom } from '../modules/bus.js';
import { CancelToken, isCanceled } from '../modules/cancel.js';
import { createIo } from '../modules/io.js';
import {
    currentProfileRequest,
    fileTargetsRequest,
    pingRequest,
    suggestExitNodeRequest,
    waitingFilesRequest,
    prefsRequest,
    profilesRequest,
    statusRequest,
    watchBusRequest,
    WATCH_MASK,
} from '../modules/localapi.js';
import { PING_TYPE, describePing } from '../modules/ping.js';

let failures = 0;

const ok = message => print(`ok: ${message}`);
const fail = message => {
    failures += 1;
    printerr(`FAIL: ${message}`);
};

const check = (condition, message) => (condition ? ok(message) : fail(message));

// The oldest tailscaled whose /status carries every field modules/peers.js
// reads: TaildropTarget arrived in 1.82. README.md states the same floor.
const MIN_VERSION = [1, 82];

const has = (object, key) =>
    object !== null && typeof object === 'object' && Object.hasOwn(object, key);

async function checkStatus(client) {
    const status = await client.request(statusRequest());

    // Every field modules/state.js reads. A missing one here is Tailscale
    // having changed the contract, which no unit test could ever notice.
    for (const key of ['BackendState', 'Health', 'Self', 'Peer', 'MagicDNSSuffix'])
        check(has(status, key), `/status carries ${key}`);

    check(Array.isArray(status.Health), '/status Health is an array');

    const [major, minor] = String(status.Version ?? '')
        .split(/[.-]/)
        .map(Number);
    check(
        major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]),
        `tailscaled ${status.Version} is at least ${MIN_VERSION.join('.')}`,
    );

    const peers = Object.values(status.Peer ?? {});
    if (peers.length === 0) {
        ok('/status has no peers to inspect (single-node tailnet)');
        return;
    }

    // The fields modules/peers.js normalizes, which a bus peer does not carry
    // in this shape — see modules/bus.js.
    for (const key of [
        'ID',
        'DNSName',
        'OS',
        'Online',
        'ExitNode',
        'ExitNodeOption',
        'TailscaleIPs',
        'TaildropTarget',
    ])
        check(
            peers.every(peer => has(peer, key)),
            `every /status peer carries ${key}`,
        );
}

async function checkCheapStatus(client) {
    const status = await client.request(statusRequest({ peers: false }));

    check(status.Peer === null, '?peers=false drops the peer map');

    // If any of these stopped surviving the omission, the refresh policy in
    // modules/model.js would have to read the full status on every signal.
    for (const key of ['BackendState', 'Health', 'AuthURL', 'Self'])
        check(has(status, key), `?peers=false keeps ${key}`);
}

async function checkPrefs(client) {
    const prefs = await client.request(prefsRequest());

    for (const key of [
        'WantRunning',
        'RouteAll',
        'CorpDNS',
        'ExitNodeID',
        'ExitNodeAllowLANAccess',
        'ShieldsUp',
        'RunSSH',
    ])
        check(has(prefs, key), `/prefs carries ${key}`);
}

async function checkProfiles(client) {
    const profiles = await client.request(profilesRequest());
    check(Array.isArray(profiles), '/profiles/ returns an array');

    // Asked rather than inferred from prefs, which throws when a profile has
    // no NetworkProfile.
    const current = await client.request(currentProfileRequest());
    check(has(current, 'ID'), '/profiles/current carries ID');
    check(
        profiles.some(profile => profile.ID === current.ID),
        '/profiles/current names one of the listed profiles',
    );
}

async function checkFileTargets(client) {
    const { BackendState } = await client.request(statusRequest({ peers: false }));

    // modules/model.js does not ask unless the tailnet is up, and does not
    // treat a refusal as the daemon being unreachable. This is why: the
    // daemon answers 500 whenever it is not Running.
    if (BackendState !== 'Running') {
        try {
            await client.request(fileTargetsRequest());
            ok(`/file-targets answered while ${BackendState}`);
        } catch (error) {
            check(
                error?.status === 500,
                `/file-targets is refused while ${BackendState} (${error})`,
            );
        }
        return;
    }

    const targets = await client.request(fileTargetsRequest());
    check(Array.isArray(targets), '/file-targets returns an array');
    check(
        targets.every(target => has(target.Node ?? {}, 'StableID')),
        'every file target carries Node.StableID',
    );
}

async function checkPing(client, status) {
    const peer = Object.values(status.Peer ?? {}).find(
        p => p.Online && p.TailscaleIPs?.length,
    );

    if (!peer) {
        ok('no online peer to ping (skipped)');
        return;
    }

    const result = describePing(
        await client.request(pingRequest(peer.TailscaleIPs[0], PING_TYPE.DISCO)),
    );

    // The daemon reports a failed ping as a 200 with Err set, so this is the
    // one call whose success cannot be read off the status code.
    check(
        typeof result.ok === 'boolean',
        '/ping returns a result the reducer can read',
    );

    if (result.ok) {
        check(result.latencyMs > 0, `/ping reports a latency (${result.latencyMs} ms)`);
        check(
            ['direct', 'relay', 'unknown'].includes(result.route),
            `/ping reports a route (${result.route})`,
        );
    } else {
        ok(`/ping reported a failure, which is a valid answer: ${result.error}`);
    }
}

async function checkWaitingFiles(client) {
    const files = await client.request(waitingFilesRequest());

    // Null rather than [] when nothing is waiting is the shape the reducer has
    // to tolerate, and the one a caller reaching for .length would throw on.
    check(
        files === null || Array.isArray(files),
        `/files/ answers null or an array (got ${files === null ? 'null' : typeof files})`,
    );

    for (const file of files ?? [])
        check(
            typeof file.Name === 'string' && typeof file.Size === 'number',
            'a waiting file carries Name and Size',
        );
}

async function checkSuggestedExitNode(client) {
    try {
        const suggestion = await client.request(suggestExitNodeRequest());
        check(
            typeof suggestion?.ID === 'string' && suggestion.ID !== '',
            `/suggest-exit-node names a node (${suggestion?.Name ?? '?'})`,
        );
    } catch (error) {
        // A tailnet with no eligible exit node answers with an error, which is
        // a valid answer and not a failure of ours.
        ok(`/suggest-exit-node had no suggestion: ${error}`);
    }
}

async function checkAdvertiseRoutes(client) {
    const prefs = await client.request(prefsRequest());

    // Null rather than [] when nothing is advertised — modules/routes.js has
    // to handle that, and this is the only place it is seen for real.
    check(
        prefs.AdvertiseRoutes === null || Array.isArray(prefs.AdvertiseRoutes),
        '/prefs AdvertiseRoutes is null or an array',
    );
}

async function checkStreamCancels(io, token) {
    // The subscription mask asks for the initial state, so the daemon answers
    // at once instead of staying silent until the tailnet happens to change.
    // Without that, this check would block for as long as nothing happened,
    // which on a quiet tailnet is indefinitely.
    const stream = io.client.stream(watchBusRequest());

    // Opening at all is the first check: a mask the daemon will not accept
    // (NotifyRateLimit with PEER_CHANGES, say) is refused with a 400 and the
    // extension would never hear from the bus again.
    const first = await stream.next();
    check(
        !first.done,
        `the IPN bus accepts mask ${WATCH_MASK} and answers with the initial state`,
    );

    if (!first.done) {
        const notify = JSON.parse(first.value);
        check(has(notify, 'State'), 'the initial notification carries State');
        // modules/bus.js keys off which fields carry a value, so this is the
        // contract: the first message must read as a state change and nothing
        // more, or every reconnect would trigger reads it does not need.
        const dirty = dirtyFrom(notify);
        check(
            dirty.state && !dirty.peers && !dirty.prefs,
            'modules/bus.js reads the initial notification as a state change only',
        );
    }

    // A read blocked on a quiet bus must come back promptly once the token is
    // canceled, and must report cancellation rather than failure — otherwise
    // every disable() would log an error.
    const blocked = stream.next();
    token.cancel();

    try {
        const next = await blocked;
        check(next.done, 'a canceled stream ends rather than hanging');
    } catch (error) {
        check(isCanceled(error), 'a canceled stream reports cancellation, not failure');
    }
}

// The regression this whole design exists for. Removing the GLib source from
// disable() while a reconnect loop is awaiting that very timeout means the
// callback never runs and the promise never settles: the loop, its generator,
// its input stream and its Soup session survive for the life of the Shell.
// Here the wait must reject promptly instead.
async function checkDelaySettlesOnCancel() {
    const token = new CancelToken();
    const io = createIo({ token });

    const started = GLib.get_monotonic_time();
    const waiting = io.scheduler.delay(60000);

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
        token.cancel();
        return GLib.SOURCE_REMOVE;
    });

    try {
        await waiting;
        fail('a canceled delay resolved instead of rejecting');
    } catch (error) {
        const elapsed = (GLib.get_monotonic_time() - started) / 1000;
        check(isCanceled(error), 'a canceled delay rejects with CanceledError');
        check(
            elapsed < 5000,
            `a canceled delay settles promptly (${Math.round(elapsed)}ms)`,
        );
    }

    io.dispose();
    ok('dispose() reported no timers outliving the token');
}

async function main() {
    const token = new CancelToken();
    const io = createIo({ token });

    if (!io.socket) {
        printerr('FAIL: no tailscaled socket found; is Tailscale installed?');
        return 1;
    }
    ok(`connected to ${io.socket}`);

    await checkStatus(io.client);
    await checkCheapStatus(io.client);
    await checkPrefs(io.client);
    await checkProfiles(io.client);
    await checkFileTargets(io.client);
    await checkPing(io.client, await io.client.request(statusRequest()));
    await checkWaitingFiles(io.client);
    await checkSuggestedExitNode(io.client);
    await checkAdvertiseRoutes(io.client);
    await checkStreamCancels(io, token);
    io.dispose();

    await checkDelaySettlesOnCancel();

    if (failures > 0) {
        printerr(`FAIL: ${failures} check(s) failed`);
        return 1;
    }

    print('PASS');
    return 0;
}

const loop = new GLib.MainLoop(null, false);
let code = 1;

main()
    .then(result => {
        code = result;
    })
    .catch(error => {
        printerr(`FAIL: ${error}\n${error?.stack ?? ''}`);
        code = 1;
    })
    .finally(() => loop.quit());

loop.run();
imports.system.exit(code);
