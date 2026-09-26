// What the menu should say about how things are going.
//
// tailscaled already computes this. /status carries a Health array of
// human-readable warnings — "Some peers are advertising routes but
// --accept-routes is false", "SELinux is enabled; Tailscale SSH may not work"
// — and a BackendState that says whether the daemon is running, starting or
// waiting to be logged in. Reading neither is how a toggle sits there showing
// "on" while the backend waits for a login that nothing in the menu offers.
//
// Nothing here is translated, for the same reason nothing here imports: this
// file has to be loadable from Vitest. It returns a kind and a value, and
// modules/panel.js chooses the wording. That also keeps the format strings
// where a translator can see them, rather than assembled from fragments.
//
// This file imports only other pure modules.

import { REASON, commandFor, isActionable, messageFor } from './errors.js';
import { BACKEND } from './state.js';

/** How many health warnings to show before summarizing the rest. */
export const MAX_HEALTH_LINES = 3;

/** What the subtitle is about. modules/panel.js maps these to wording. */
export const SUMMARY = Object.freeze({
    /** The daemon could not be reached. `value` is a reason from REASON. */
    ERROR: 'error',
    /** Waiting for an interactive login. */
    NEEDS_LOGIN: 'needs-login',
    /** Another user on this machine is using Tailscale. */
    IN_USE: 'in-use',
    /** Coming up. */
    STARTING: 'starting',
    /** Logged in, and waiting for a tailnet admin to approve this machine. */
    NEEDS_APPROVAL: 'needs-approval',
    /** Deliberately down. */
    OFF: 'off',
    /** Routing through a peer. `value` is the node name. */
    EXIT_NODE: 'exit-node',
    /** Up, with warnings. `value` is the number of them. */
    WARNINGS: 'warnings',
    /** Up. `value` is the tailnet name, which may be empty. */
    CONNECTED: 'connected',
});

/**
 * Whether the daemon is waiting for someone to log in.
 *
 * WantRunning alone cannot represent this: it stays true across a logout, so
 * a toggle driven by it shows "on" against a backend that is doing nothing.
 *
 * @param {object} state A snapshot.
 * @returns {boolean} True if an interactive login would help.
 */
export function needsLogin(state) {
    return state.backendState === BACKEND.NEEDS_LOGIN;
}

/**
 * Whether the tailnet is actually carrying traffic.
 *
 * Both halves are required. The preference says what was asked for and the
 * backend state says what came of it, and a menu that reports only the first
 * is a menu that lies whenever they disagree.
 *
 * @param {object} state A snapshot.
 * @returns {boolean} True if up.
 */
export function isUp(state) {
    return state.running && state.backendState === BACKEND.RUNNING;
}

/**
 * Whether the tile should show as on.
 *
 * Not the same question as isUp. A tile is on when clicking it would turn the
 * tailnet off: the preference says to run and the daemon is reachable and
 * working towards it — which includes Starting and NeedsMachineAuth, where
 * nothing is up yet but the only useful click is "stop". A backend waiting
 * for a login is off whatever the preference says, because WantRunning stays
 * true across a logout and a click there starts the login instead.
 *
 * @param {object} state A snapshot.
 * @returns {boolean} True if the tile should be checked.
 */
export function isOn(state) {
    return (
        state.reachable &&
        state.running &&
        !needsLogin(state) &&
        state.backendState !== BACKEND.IN_USE_OTHER_USER
    );
}

/**
 * The health warnings to show.
 *
 * Deduplicated because the same warning can be reported by more than one
 * subsystem, and capped because the list is rendered inside a menu that also
 * has to hold the nodes.
 *
 * @param {object} state A snapshot.
 * @returns {{lines: string[], hidden: number}} What to show, and how many were not shown.
 */
export function healthLines(state) {
    const unique = [...new Set((state.health ?? []).filter(line => line?.trim()))];

    return {
        lines: unique.slice(0, MAX_HEALTH_LINES),
        hidden: Math.max(0, unique.length - MAX_HEALTH_LINES),
    };
}

/**
 * What the toggle's subtitle should be about.
 *
 * Ordered by what a person most needs to know. An unreachable daemon outranks
 * everything, because nothing else on screen can be trusted while it holds; a
 * login prompt outranks the exit node, because the exit node does nothing
 * until the login is done.
 *
 * @param {object} state A snapshot.
 * @returns {{kind: string, value: string|number}} Subject and its parameter.
 */
export function summaryOf(state) {
    if (!state.reachable)
        return { kind: SUMMARY.ERROR, value: state.errorReason || REASON.UNKNOWN };

    if (needsLogin(state)) return { kind: SUMMARY.NEEDS_LOGIN, value: '' };
    if (state.backendState === BACKEND.IN_USE_OTHER_USER)
        return { kind: SUMMARY.IN_USE, value: '' };
    if (state.backendState === BACKEND.STARTING)
        return { kind: SUMMARY.STARTING, value: '' };
    // Before the OFF test below, which it would otherwise fall into: the
    // backend is not Running, and "Off" is the one thing it is not.
    if (state.running && state.backendState === BACKEND.NEEDS_MACHINE_AUTH)
        return { kind: SUMMARY.NEEDS_APPROVAL, value: '' };

    if (!isUp(state)) return { kind: SUMMARY.OFF, value: '' };

    // Keyed on the id, not the derived name. Tailscale's automatic exit node
    // sets ExitNodeID to an "auto:<expression>" form — auto:any — which
    // matches no peer, so the name is empty while an exit node is very much in
    // use. Testing the name would report that as no exit node at all.
    if (state.exitNodeId) return { kind: SUMMARY.EXIT_NODE, value: state.exitNodeName };

    const { lines, hidden } = healthLines(state);
    if (lines.length > 0)
        return { kind: SUMMARY.WARNINGS, value: lines.length + hidden };

    return { kind: SUMMARY.CONNECTED, value: state.tailnetName };
}

/**
 * The message for an unreachable daemon, and whether it is worth a row of its own.
 *
 * A permission failure is the one worth interrupting for: tailscaled answers
 * 403 to anyone who is not the tailscale operator, and one command fixes it —
 * a command nobody would otherwise discover from an empty menu.
 *
 * @param {object} state A snapshot.
 * @returns {{reason: string, message: string, command: string, actionable: boolean}|null}
 *   The reason, untranslated for a log and as a key for modules/panel.js to
 *   translate, the command that fixes it if there is one, or null if fine.
 */
export function problemOf(state) {
    if (state.reachable) return null;

    const reason = state.errorReason || REASON.UNKNOWN;

    return {
        reason,
        message: messageFor(reason),
        command: commandFor(reason),
        actionable: isActionable(reason),
    };
}
