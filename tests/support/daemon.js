// A fake tailscaled, good enough to drive modules/model.js.
//
// This is the whole of what the model needs injected: four client methods and
// a delay. There is no GNOME type anywhere in it, which is why the model — the
// reconnect loop, the refresh policy and the failure handling included — runs
// under Vitest with no stubs at all.
//
// It behaves like a Linux tailscaled of the version QuickTS targets, not like
// the one the tests would find convenient. A fake that sent a runtime NetMap
// kept the suite green for a peer list that never refreshed on a real
// machine, so each rule below is a real daemon's:
//
//   The subscription mask is honored. Fields the mask did not ask for are
//   never sent, and NotifyRateLimit alongside a delta bit is refused with a
//   400, as ipn.ValidateNotifyWatchOpt refuses it.
//
//   NetMap is never sent after the first message. ipn/ipnlocal/bus.go sends
//   it at runtime only on Windows since Tailscale 1.100.
//
//   NotifyInitialState answers at once with the current State.
//
//   /file-targets fails with a 500 unless the backend is Running, which is
//   what the Taildrop extension's FileTargets() error turns into.

import { CancelToken, CanceledError } from '../../modules/cancel.js';
import { REASON, TransportError } from '../../modules/errors.js';
import { NOTIFY } from '../../modules/localapi.js';
import { SUFFIX, rawPeer, rawPeerMap } from '../fixtures/peers.js';

/** ipn.State, as the bus carries it. */
const STATE_NUMBER = new Map([
    ['NoState', 0],
    ['InUseOtherUser', 1],
    ['NeedsLogin', 2],
    ['NeedsMachineAuth', 3],
    ['Stopped', 4],
    ['Starting', 5],
    ['Running', 6],
]);

/** NotifyRateLimit, which no longer appears in modules/localapi.js. */
const RATE_LIMIT = 1 << 8;

/** The bits ipn.ValidateNotifyWatchOpt will not combine with RATE_LIMIT. */
const RATE_LIMIT_INCOMPATIBLE =
    NOTIFY.PEER_CHANGES | (1 << 13) | (1 << 14) | NOTIFY.PEER_PATCHES;

/**
 * Build a fake client whose answers a test can set.
 *
 * @param {object} [seed] Starting responses.
 * @returns {object} The client, plus the recording around it.
 */
export function createDaemon(seed = {}) {
    const responses = {
        status: {
            BackendState: 'Running',
            AuthURL: '',
            Health: [],
            MagicDNSSuffix: SUFFIX,
            CurrentTailnet: { Name: 'example@example.com' },
            Self: { HostName: 'desktop', TailscaleIPs: ['100.64.0.9'] },
            Peer: rawPeerMap(rawPeer()),
        },
        prefs: {
            WantRunning: true,
            RouteAll: false,
            CorpDNS: true,
            ExitNodeAllowLANAccess: false,
            ShieldsUp: false,
            RunSSH: false,
            ExitNodeID: '',
        },
        profiles: [
            { ID: '1', Name: 'work', NetworkProfile: { DisplayName: 'WorkNet' } },
        ],
        current: { ID: '1' },
        fileTargets: [],
        ping: { Err: '', LatencySeconds: 0.001, Endpoint: '10.0.0.1:41641' },
        // The endpoint answers null, not [], when nothing is waiting.
        files: null,
        suggestion: { ID: 'nGATE', Name: 'gateway.example-tailnet.ts.net.' },
        ...seed,
    };

    /** Every path requested, in order. */
    const paths = [];
    /** Bodies of every PATCH, in order. */
    const patches = [];
    /** Paths the daemon should reject, mapped to the error to throw. */
    const failures = new Map();
    /** Files the daemon was told to forget, in order. */
    const deleted = [];
    /** Files written to disk, as {name, path}. */
    const saved = [];

    let streamController = null;

    const client = {
        async request({ method, path, body }) {
            paths.push(path);
            if (method === 'PATCH') patches.push(body);

            const failure = [...failures.entries()].find(([prefix]) =>
                path.startsWith(prefix),
            );
            if (failure) throw failure[1];

            if (path.startsWith('/localapi/v0/prefs')) {
                // The daemon answers a PATCH with the resulting preferences,
                // which is what lets a user-initiated change skip the bus.
                if (method === 'PATCH') Object.assign(responses.prefs, stripMask(body));
                return { ...responses.prefs };
            }
            if (path.startsWith('/localapi/v0/status'))
                return path.includes('peers=false')
                    ? { ...responses.status, Peer: null }
                    : { ...responses.status };
            if (path.startsWith('/localapi/v0/profiles/current'))
                return responses.current;
            if (path.startsWith('/localapi/v0/profiles')) return responses.profiles;
            if (path.startsWith('/localapi/v0/file-targets')) {
                if (responses.status.BackendState !== 'Running')
                    throw new TransportError(
                        REASON.HTTP,
                        'HTTP 500 Internal Server Error',
                        {
                            status: 500,
                        },
                    );
                return responses.fileTargets;
            }
            if (path.startsWith('/localapi/v0/ping')) return responses.ping;
            if (path.startsWith('/localapi/v0/suggest-exit-node'))
                return responses.suggestion;
            if (path.startsWith('/localapi/v0/files/')) {
                if (method === 'DELETE') {
                    deleted.push(path);
                    return {};
                }
                return responses.files;
            }
            if (path.startsWith('/localapi/v0/files')) return responses.files;

            return {};
        },

        /** Writes nowhere; records what would have been written. */
        async saveFile({ path }, name) {
            paths.push(path);

            const failure = [...failures.entries()].find(([prefix]) =>
                path.startsWith(prefix),
            );
            if (failure) throw failure[1];

            const written = `/home/someone/Downloads/${name}`;
            saved.push({ name, path: written });

            return written;
        },

        async *stream({ path }) {
            paths.push(path);

            const mask = Number(
                new URL(path, 'http://x').searchParams.get('mask') ?? 0,
            );
            if (mask & RATE_LIMIT && mask & RATE_LIMIT_INCOMPATIBLE)
                throw new TransportError(REASON.HTTP, 'HTTP 400 Bad Request', {
                    status: 400,
                });

            const queue = [];
            let wake = null;
            let ended = false;

            if (mask & NOTIFY.INITIAL_STATE)
                queue.push(
                    JSON.stringify({
                        Version: '1.102.3',
                        SessionID: 'session',
                        ErrMessage: null,
                        LoginFinished: null,
                        State: STATE_NUMBER.get(responses.status.BackendState) ?? 0,
                        Prefs: null,
                        NetMap: null,
                        Engine: null,
                        BrowseToURL: null,
                    }),
                );

            streamController = {
                mask,
                push(line) {
                    queue.push(line);
                    wake?.();
                },
                end() {
                    ended = true;
                    wake?.();
                },
            };

            for (;;) {
                if (queue.length > 0) {
                    yield queue.shift();
                    continue;
                }
                if (ended) return;
                await new Promise(resolve => {
                    wake = resolve;
                });
            }
        },
    };

    return {
        client,
        responses,
        paths,
        patches,
        failures,
        deleted,
        saved,
        token: new CancelToken(),

        /**
         * Send one notification down the open bus, as the daemon would.
         *
         * Fields the subscription did not ask for are dropped, and a
         * notification left with nothing in it is not sent at all.
         */
        emit(notify) {
            if (!streamController) return;

            const shaped = shapeFor(notify, streamController.mask);
            if (shaped !== null) streamController.push(JSON.stringify(shaped));
        },

        /**
         * Announce a new netmap the way a Linux tailscaled does: SelfChange
         * always, PeersChanged only for a subscriber that asked for it, and
         * no NetMap.
         */
        netmapChanged() {
            this.emit({
                SelfChange: { ID: 1 },
                PeersChanged: Object.values(responses.status.Peer ?? {}),
                NetMap: { Peers: [] },
            });
        },

        /** Close the open bus. */
        endStream() {
            streamController?.end();
        },

        /** Paths matching a fragment, for asserting what was and was not read. */
        pathsMatching(fragment) {
            return paths.filter(path => path.includes(fragment));
        },

        reset() {
            paths.length = 0;
            patches.length = 0;
        },
    };
}

/**
 * What a Linux tailscaled would actually send for a notification.
 *
 * @param {unknown} notify What the test asked to send.
 * @param {number} mask The subscription mask.
 * @returns {unknown} The notification as sent, or null if nothing is left.
 */
function shapeFor(notify, mask) {
    // A malformed line is passed through untouched; it is what the test is
    // exercising.
    if (notify === null || typeof notify !== 'object') return notify;

    const peerChanges = Boolean(mask & (NOTIFY.PEER_CHANGES | NOTIFY.PEER_PATCHES));
    const patches = Boolean(mask & NOTIFY.PEER_PATCHES);

    const shaped = { ...notify };
    delete shaped.NetMap;
    if (!peerChanges) {
        delete shaped.PeersChanged;
        delete shaped.PeersRemoved;
        delete shaped.UserProfiles;
    }
    if (!patches) {
        // Promoted rather than dropped for a PEER_CHANGES subscriber.
        if (peerChanges && shaped.PeerChangedPatch)
            shaped.PeersChanged = [...(shaped.PeersChanged ?? []), {}];
        delete shaped.PeerChangedPatch;
    }

    return Object.keys(shaped).length === 0 && Object.keys(notify).length > 0
        ? null
        : shaped;
}

/**
 * Drop the `<Name>Set` mask fields, leaving the values a real daemon would keep.
 *
 * @param {object} body A MaskedPrefs body.
 * @returns {object} Just the preference values.
 */
function stripMask(body) {
    return Object.fromEntries(
        Object.entries(body ?? {}).filter(([key]) => !key.endsWith('Set')),
    );
}

/**
 * A scheduler that records waits instead of performing them.
 *
 * It must still move the clock. A delay that records the duration but leaves
 * the time alone is not a fast delay, it is a stopped one: modules/model.js
 * re-checks flushDelay after each wait precisely because more signals may have
 * arrived, and against a frozen clock that re-check never converges.
 *
 * @param {import('../../modules/cancel.js').CancelToken} token Lifetime.
 * @param {{advance: (ms: number) => void}} clock Clock to move.
 * @returns {object} The scheduler and its record.
 */
export function createScheduler(token, clock) {
    const waits = [];

    return {
        waits,
        scheduler: {
            delay(ms) {
                waits.push(ms);
                if (token.canceled) return Promise.reject(new CanceledError());

                clock.advance(ms);

                // Resolved on a macrotask, not a microtask. A real delay
                // yields to the event loop, which is what lets the bus lines
                // already queued behind it be delivered before the wait ends —
                // resolving immediately would let a flush fire between two
                // lines of the same burst and make coalescing untestable.
                return new Promise(resolve => setTimeout(resolve, 0));
            },
        },
    };
}

/** A clock a test can move. */
export function createClock(start = 1_000_000) {
    let time = start;

    return {
        now: () => time,
        advance(ms) {
            time += ms;
        },
    };
}
