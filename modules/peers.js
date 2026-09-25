// The one shape a node has in QuickTS.
//
// Every peer in the extension comes through normalizePeer, and the only input
// it accepts is a peer from /localapi/v0/status. Nothing else in the codebase
// reads a raw peer field, so there is exactly one place where Tailscale's
// spelling meets ours — see modules/bus.js for what happens to a codebase that
// has two.
//
// This file imports nothing.

// One collator, built once. Its compare() orders exactly as localeCompare()
// does, but a bare localeCompare() call resolves a collator every time — and
// this comparator runs over the whole tailnet.
const collator = new Intl.Collator();

/** Tag Tailscale puts on a Mullvad exit node. */
export const MULLVAD_TAG = 'tag:mullvad-exit-node';

/**
 * Strip the tailnet suffix off a peer's DNS name.
 *
 * DNSName arrives fully qualified and with a trailing dot —
 * `laptop.example-tailnet.ts.net.` — which is not what anyone wants to read in
 * a menu.
 *
 * A node shared in from another tailnet keeps that tailnet's suffix, so taking
 * the first label would render two unrelated machines under one identical name
 * — which is a correctness problem, not a cosmetic one, because the rows are
 * clickable. Stripping only the common `.ts.net` tail leaves
 * `laptop.other-tailnet`: short enough for a menu, and unambiguous.
 *
 * @param {object} peer Raw peer from /status.
 * @param {string} [magicDNSSuffix] The tailnet's suffix, without a leading dot.
 * @returns {string} A name to show.
 */
export function displayName(peer, magicDNSSuffix = '') {
    const fqdn = (peer?.DNSName ?? '').replace(/\.$/, '');

    if (fqdn === '') return peer?.HostName || peer?.ID || '';

    const suffix = magicDNSSuffix ? `.${magicDNSSuffix.replace(/^\.|\.$/g, '')}` : '';
    if (suffix && fqdn.endsWith(suffix)) return fqdn.slice(0, -suffix.length);

    // Someone else's tailnet, or no suffix was known. Keep what distinguishes
    // it and drop only the part every tailnet has in common.
    if (fqdn.endsWith('.ts.net')) return fqdn.slice(0, -'.ts.net'.length);

    return fqdn.split('.')[0];
}

/** Where Mullvad's nodes live; the suffix cmd/tailscale/cli/status.go checks. */
const MULLVAD_DOMAIN = '.mullvad.ts.net';

/**
 * Whether a peer is one of Mullvad's exit nodes.
 *
 * By name first, the way Tailscale's own CLI decides: status.go treats an
 * exit node whose DNSName ends in mullvad.ts.net as Mullvad's. The tag is
 * accepted too, for a /status that carries it.
 *
 * Not by Location. tailcfg.Location is "only set if explicitly declared by a
 * node", and any node may declare one — so a location proves only that
 * someone filled it in, and taking it as Mullvad pulled ordinary exit nodes
 * out of the list and into a country group.
 *
 * @param {object} peer Raw peer from /status.
 * @returns {boolean} True if the peer is a Mullvad exit node.
 */
export function isMullvad(peer) {
    if (Array.isArray(peer?.Tags) && peer.Tags.includes(MULLVAD_TAG)) return true;

    const fqdn = String(peer?.DNSName ?? '').replace(/\.$/, '');
    return fqdn.endsWith(MULLVAD_DOMAIN);
}

/**
 * The icon for a node row.
 *
 * Offline wins over everything else: a phone that cannot be reached is more
 * usefully drawn as unreachable than as a phone.
 *
 * @param {object} node A normalized node.
 * @returns {string} A symbolic icon name present in Adwaita.
 */
export function iconNameFor(node) {
    if (!node.online) return 'network-offline-symbolic';
    if (node.os === 'android' || node.os === 'iOS') return 'phone-symbolic';
    if (node.isMullvad) return 'network-vpn-symbolic';

    return 'computer-symbolic';
}

/**
 * Turn a raw /status peer into the shape the rest of QuickTS uses.
 *
 * `isExitNode` is taken from the *preferences*, not from the peer's own
 * ExitNode field. The two differ for as long as it takes a route change to
 * take effect, and the preference is the one that flips the instant the user
 * clicks — so the checkmark follows the click rather than lagging the network.
 *
 * @param {object} peer Raw peer from /status.
 * @param {object} [context] Context.
 * @param {string} [context.exitNodeId] ExitNodeID from /prefs.
 * @param {string} [context.magicDNSSuffix] The tailnet's DNS suffix.
 * @returns {object} A normalized node.
 */
export function normalizePeer(peer, { exitNodeId = '', magicDNSSuffix = '' } = {}) {
    const id = peer?.ID ?? '';
    const node = {
        id,
        name: displayName(peer, magicDNSSuffix),
        hostName: peer?.HostName ?? '',
        os: peer?.OS ?? '',

        // Online is omitted rather than set false for a peer the daemon has
        // never reached, so an absent value means offline.
        online: peer?.Online === true,

        isExitNode: id !== '' && id === exitNodeId,
        canBeExitNode: peer?.ExitNodeOption === true,

        // TailscaleIPs is absent for a peer with no addresses yet. An empty
        // array keeps every caller from having to check before indexing, which
        // is where upstream's "empty entries" came from.
        ips: Array.isArray(peer?.TailscaleIPs) ? peer.TailscaleIPs : [],
        tags: Array.isArray(peer?.Tags) ? peer.Tags : [],

        isMullvad: isMullvad(peer),
        location: peer?.Location ?? null,

        // Carried through as the daemon's own number; modules/taildrop.js is
        // where it becomes a decision and a reason.
        taildropTarget:
            typeof peer?.TaildropTarget === 'number' ? peer.TaildropTarget : 0,
        noFileSharingReason: peer?.NoFileSharingReason ?? '',
    };

    node.icon = iconNameFor(node);

    return node;
}

/**
 * Normalize every peer in a /status response.
 *
 * The Peer field is an object keyed by public key, and it is null rather than
 * empty on a single-node tailnet and whenever ?peers=false was used.
 *
 * @param {object|null} rawPeers The Peer field from /status.
 * @param {object} [context] Passed through to {@link normalizePeer}.
 * @returns {object[]} Normalized nodes, sorted.
 */
export function normalizePeers(rawPeers, context = {}) {
    const peers =
        rawPeers && typeof rawPeers === 'object' ? Object.values(rawPeers) : [];

    return sortNodes(peers.map(peer => normalizePeer(peer, context)));
}

/**
 * Order nodes for display.
 *
 * The exit node first, because it is the one piece of state a person opens
 * this menu to check. Then anything reachable, then alphabetically. Sorting is
 * done on a copy: the array handed in belongs to the caller.
 *
 * A collator rather than < so that accented names sort where a reader expects
 * rather than after z.
 *
 * @param {object[]} nodes Normalized nodes.
 * @returns {object[]} A new, sorted array.
 */
export function sortNodes(nodes) {
    return [...nodes].sort(
        (a, b) =>
            Number(b.isExitNode) - Number(a.isExitNode) ||
            Number(b.online) - Number(a.online) ||
            collator.compare(a.name, b.name),
    );
}

/**
 * The node currently serving as exit node, if any.
 *
 * @param {object[]} nodes Normalized nodes.
 * @returns {object|null} The exit node, or null.
 */
export function exitNodeOf(nodes) {
    return nodes.find(node => node.isExitNode) ?? null;
}
