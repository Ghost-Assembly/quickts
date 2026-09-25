// Descriptions of every request QuickTS makes to tailscaled's LocalAPI.
//
// This file imports nothing — not gi://, not resource:///. That is deliberate
// and load-bearing: a request descriptor is a decision (which path, which body,
// what to escape), and decisions belong somewhere Vitest can reach on plain
// Node. modules/io.js only carries a descriptor out; it never builds one.
//
// The API is tailscaled's local HTTP interface, spoken over a Unix socket. It
// is the same one the `tailscale` CLI uses, and it is not versioned in the
// stable-contract sense — hence scripts/localapi-check.sh, which runs the real
// requests against the real daemon.

/** Hostname tailscaled expects in the request line. Any other value is refused. */
export const HOST = 'local-tailscaled.sock';

/**
 * Where tailscaled listens, most-preferred first.
 *
 * /run and /var/run are the same directory on any systemd distribution, but
 * they are not on every distribution QuickTS might be installed on.
 */
export const SOCKET_PATHS = Object.freeze([
    '/run/tailscale/tailscaled.sock',
    '/var/run/tailscale/tailscaled.sock',
]);

const BASE = '/localapi/v0';

/**
 * The first socket path that exists.
 *
 * @param {string[]} paths Candidate paths, most-preferred first.
 * @param {(path: string) => boolean} exists Predicate; injected so this is testable.
 * @returns {string|null} The path to connect to, or null if tailscaled is not installed.
 */
export function pickSocket(paths, exists) {
    return paths.find(path => exists(path)) ?? null;
}

/**
 * Percent-encode one path segment.
 *
 * Node identifiers and Taildrop filenames both end up inside a URL path, and a
 * filename is arbitrary user input — it may contain a slash, a hash or a
 * question mark, each of which would otherwise change which endpoint is being
 * addressed rather than which file. encodeURIComponent escapes all three.
 *
 * It leaves ! ' ( ) * unescaped, which Go's url.PathEscape also permits in a
 * path segment, so the daemon reads back exactly what was sent.
 *
 * @param {string} raw Raw segment.
 * @returns {string} Segment safe to place between two slashes.
 */
function segment(raw) {
    return encodeURIComponent(raw);
}

/**
 * Current daemon and tailnet state.
 *
 * `peers: false` returns everything except the peer map — BackendState, Health,
 * AuthURL, Self, MagicDNSSuffix and CurrentTailnet all survive. That is what
 * makes it affordable to re-read status on every change signal from the IPN
 * bus while the menu is closed, instead of trusting the bus's own peer payload.
 * See modules/bus.js for why trusting it is not an option.
 *
 * @param {object} [options] Options.
 * @param {boolean} [options.peers] Whether to include the peer map.
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function statusRequest({ peers = true } = {}) {
    return {
        method: 'GET',
        path: peers ? `${BASE}/status` : `${BASE}/status?peers=false`,
    };
}

/**
 * The full preference set.
 *
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function prefsRequest() {
    return { method: 'GET', path: `${BASE}/prefs` };
}

/**
 * Change preferences.
 *
 * tailscaled takes an ipn.MaskedPrefs: the new values, plus a `<Name>Set`
 * boolean for each one being changed. Without the mask every unmentioned
 * preference would read as its zero value and be reset.
 *
 * The capital S matters. Go's encoding/json matches field names
 * case-insensitively, so a lowercase `<Name>set` happens to work;
 * encoding/json/v2, which tailscale is already part-way into adopting, does
 * not. Spelling the field the way ipn/prefs.go spells it costs
 * nothing and does not depend on that.
 *
 * @param {Record<string, unknown>} changes Preference names to new values.
 * @returns {{method: string, path: string, body: Record<string, unknown>}} Request descriptor.
 */
export function patchPrefsRequest(changes) {
    const body = { ...changes };
    for (const name of Object.keys(changes)) body[`${name}Set`] = true;

    return { method: 'PATCH', path: `${BASE}/prefs`, body };
}

/**
 * Every profile on this machine.
 *
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function profilesRequest() {
    return { method: 'GET', path: `${BASE}/profiles/` };
}

/**
 * The profile currently in use.
 *
 * Asked rather than inferred. Inferring the active profile means comparing
 * the live prefs' ControlURL and Config.UserProfile.ID against each profile's,
 * which throws whenever a profile has no NetworkProfile.
 *
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function currentProfileRequest() {
    return { method: 'GET', path: `${BASE}/profiles/current` };
}

/**
 * Switch to another profile.
 *
 * @param {string} id Profile id.
 * @returns {{method: string, path: string, body: object}} Request descriptor.
 */
export function switchProfileRequest(id) {
    return { method: 'POST', path: `${BASE}/profiles/${segment(id)}`, body: {} };
}

/**
 * Begin an interactive login. The URL to visit arrives on the next status read.
 *
 * There is deliberately no matching logout. The asymmetry is the point: a
 * login is what unblocks the menu — without one the daemon has no identity and
 * nothing here does anything — whereas a logout is an administrative action
 * that invalidates the node key and needs another browser round trip to undo.
 * A row with that consequence does not belong two clicks from the volume
 * slider, and GNOME's quick settings offer nowhere sensible to confirm it.
 * `tailscale logout` is the right place for it.
 *
 * @returns {{method: string, path: string, body: object}} Request descriptor.
 */
export function loginRequest() {
    return { method: 'POST', path: `${BASE}/login-interactive`, body: {} };
}

/**
 * Peers eligible to receive a file right now.
 *
 * This is the authoritative list. A peer's TaildropTarget field says *why* it
 * is or is not eligible, which is what the menu shows, but only a node named
 * here can actually be sent to.
 *
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function fileTargetsRequest() {
    return { method: 'GET', path: `${BASE}/file-targets` };
}

/**
 * Send one file to one peer.
 *
 * The body is the file's bytes, streamed rather than buffered — see
 * modules/io.js.
 *
 * @param {string} stableId Target node's StableID, from file-targets.
 * @param {string} filename Name the receiver should see.
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function filePutRequest(stableId, filename) {
    return {
        method: 'PUT',
        path: `${BASE}/file-put/${segment(stableId)}/${segment(filename)}`,
    };
}

/**
 * Files that have been sent here and are waiting to be saved.
 *
 * Answers null rather than an empty array when there are none.
 *
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function waitingFilesRequest() {
    return { method: 'GET', path: `${BASE}/files/` };
}

/**
 * Fetch one waiting file's contents.
 *
 * @param {string} name The name as the daemon lists it.
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function getFileRequest(name) {
    return { method: 'GET', path: `${BASE}/files/${segment(name)}` };
}

/**
 * Remove a waiting file from the daemon.
 *
 * Sent after the file has been written, which is the order `tailscale file
 * get` uses: a delete that runs first would lose the file if the write failed.
 *
 * @param {string} name The name as the daemon lists it.
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function deleteFileRequest(name) {
    return { method: 'DELETE', path: `${BASE}/files/${segment(name)}` };
}

/**
 * The exit node tailscaled would pick.
 *
 * Answers {ID, Name}. The id is a StableID and can be handed straight to
 * ExitNodeID.
 *
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function suggestExitNodeRequest() {
    return { method: 'GET', path: `${BASE}/suggest-exit-node` };
}

/**
 * Subscription bits for the IPN bus, from ipn.NotifyWatchOpt.
 *
 * Declared as literals because they are wire values, not an internal enum —
 * ipn/backend.go says as much, and spells them out rather than using iota for
 * exactly that reason.
 */
export const NOTIFY = Object.freeze({
    /** First message, sent at once, carries State and BrowseToURL. */
    INITIAL_STATE: 1 << 1,
    /** Announce peers added, replaced or removed, as PeersChanged and PeersRemoved. */
    PEER_CHANGES: 1 << 12,
    /** Narrow per-field peer patches, as PeerChangedPatch. Not subscribed to. */
    PEER_PATCHES: 1 << 15,
});

/**
 * What QuickTS subscribes to.
 *
 * INITIAL_STATE earns its place twice over. It makes the daemon answer
 * immediately, so the reconnect loop can tell an established subscription from
 * one still waiting on a dead socket, and it carries BrowseToURL, which is how
 * an interactive login hands over its URL.
 *
 * PEER_CHANGES is what makes the peer list refresh at all on Linux. Since
 * Tailscale 1.100 only a Windows tailscaled sends NetMap after the first
 * message, so without it a peer coming online is never announced. QuickTS
 * reads none of what the delta carries — see modules/bus.js — only that it
 * arrived. PEER_PATCHES is left off: without it the daemon promotes each patch
 * into PeersChanged, and one field to watch is simpler than two.
 *
 * NotifyRateLimit (1 << 8) is deliberately absent. ipn.ValidateNotifyWatchOpt
 * rejects it alongside PEER_CHANGES with a 400, which would lose the whole
 * stream; flushDelay in modules/timing.js does the coalescing instead.
 */
export const WATCH_MASK = NOTIFY.INITIAL_STATE | NOTIFY.PEER_CHANGES;

/**
 * Ask the daemon to ping a peer.
 *
 * POST with the parameters in the query string, which is how the endpoint is
 * defined — it reads them with FormValue and takes no body.
 *
 * @param {string} ip A Tailscale address of the peer.
 * @param {string} type One of PING_TYPE from modules/ping.js.
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function pingRequest(ip, type) {
    const query = `ip=${encodeURIComponent(ip)}&type=${encodeURIComponent(type)}`;

    return { method: 'POST', path: `${BASE}/ping?${query}` };
}

/**
 * The change stream.
 *
 * Newline-delimited JSON, one notification per line, open until canceled.
 * QuickTS reads it only to learn *that* something changed; see modules/bus.js.
 *
 * @param {number} [mask] Subscription bits; see {@link WATCH_MASK}.
 * @returns {{method: string, path: string}} Request descriptor.
 */
export function watchBusRequest(mask = WATCH_MASK) {
    return { method: 'GET', path: `${BASE}/watch-ipn-bus?mask=${mask}` };
}
