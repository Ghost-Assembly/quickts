// What went wrong talking to tailscaled, as a value rather than a string.
//
// This file imports nothing but modules/text.js, which imports nothing
// either. modules/io.js is the only place with Gio and Soup in scope, so it
// reads the code off a GError, or the status off an answer, and hands it
// here, with Gio.IOErrorEnum passed in rather than imported; the reason is
// decided here and io.js throws it. Everything downstream — the reducer, the
// menu, the tests — reasons about the symbol.
//
// The division is deliberate: io.js knows Gio and Soup, this file knows what
// they mean.

import { fill } from './text.js';

/**
 * Why a request failed.
 *
 * These are the cases QuickTS can say something useful about. Anything else is
 * UNKNOWN, which is reported verbatim rather than guessed at.
 */
export const REASON = Object.freeze({
    /** tailscaled is not installed, or has never run. No socket on disk. */
    SOCKET_MISSING: 'socket-missing',
    /** The socket exists but nothing is listening. The daemon is stopped. */
    CONNECTION_REFUSED: 'connection-refused',
    /**
     * The daemon answered 401 or 403, or the socket itself refused us. Almost
     * always the operator is not set: without it the daemon refuses every
     * change with a 403.
     */
    PERMISSION_DENIED: 'permission-denied',
    /** The daemon answered, with a status we cannot use. */
    HTTP: 'http',
    /** The daemon answered with something that is not what it claimed to be. */
    PROTOCOL: 'protocol',
    /** A file here could not be written: a full disk, an unwritable directory. */
    LOCAL_FILE: 'local-file',
    /** Anything else. */
    UNKNOWN: 'unknown',
});

/** A request to tailscaled that did not produce a usable answer. */
export class TransportError extends Error {
    /**
     * @param {string} reason One of {@link REASON}.
     * @param {string} message Description, for the log rather than the menu.
     * @param {object} [details] Details.
     * @param {number} [details.status] HTTP status, when there was one.
     * @param {unknown} [details.cause] The GError or exception underneath.
     */
    constructor(reason, message, { status = 0, cause = undefined } = {}) {
        // `cause` keeps the original GError reachable. Without it the Gio
        // domain and code — the only things that say *which* syscall failed —
        // are flattened into the message and gone.
        super(message, { cause });

        // Set explicitly so it survives a realm boundary, as CanceledError does.
        this.name = 'TransportError';
        this.reason = reason;
        this.status = status;
    }
}

/**
 * The reason to report for a caught value.
 *
 * @param {unknown} error Caught value.
 * @returns {string} One of {@link REASON}.
 */
export function reasonOf(error) {
    return error?.name === 'TransportError' ? error.reason : REASON.UNKNOWN;
}

/**
 * The reason to report for a failed Gio operation.
 *
 * A socket and a file fail with the same codes and mean different things by
 * them. NOT_FOUND is no daemon on the one and no download directory on the
 * other; PERMISSION_DENIED is a missing operator on the one and a directory
 * this user cannot write on the other. Only the caller knows which it was
 * talking to, so it says.
 *
 * Gio.IOErrorEnum is passed in, as prefs.js passes its Gtk values to
 * modules/shortcuts.js, so this stays importable on plain Node.
 *
 * @param {number|null} code The GError's code, or null when the error is not
 *   one of Gio.IOErrorEnum's.
 * @param {object} IOErrorEnum Gio.IOErrorEnum.
 * @param {object} [where] What the failed operation touched.
 * @param {boolean} [where.local] A file on this machine.
 * @param {boolean} [where.remote] The daemon: its socket, or a stream from it.
 * @returns {string} One of {@link REASON}.
 */
export function reasonForIoError(
    code,
    IOErrorEnum,
    { local = false, remote = true } = {},
) {
    // Creating a file touches nothing else, so whatever failed, it was the file.
    if (local && !remote) return REASON.LOCAL_FILE;

    // A copy from the daemon's stream into a file. The connection is already
    // open by then, so these can only be the file's; the rest are the stream's.
    const fileSystem = [
        IOErrorEnum.NO_SPACE,
        IOErrorEnum.READ_ONLY,
        IOErrorEnum.PERMISSION_DENIED,
        IOErrorEnum.NOT_FOUND,
    ];
    if (local && fileSystem.includes(code)) return REASON.LOCAL_FILE;

    switch (code) {
        case IOErrorEnum.NOT_FOUND:
            return REASON.SOCKET_MISSING;
        case IOErrorEnum.CONNECTION_REFUSED:
            return REASON.CONNECTION_REFUSED;
        case IOErrorEnum.PERMISSION_DENIED:
            return REASON.PERMISSION_DENIED;
        default:
            return REASON.UNKNOWN;
    }
}

const UNAUTHORIZED = 401;
const FORBIDDEN = 403;

/**
 * The reason to report for an HTTP status the daemon answered with.
 *
 * 403 is the interesting one: it is what tailscaled returns to a user who is
 * not the tailscale operator, and it is the single most common reason this
 * extension appears to do nothing at all.
 *
 * @param {number} status The HTTP status.
 * @returns {string|null} One of {@link REASON}, or null for a 2xx, which is
 *   an answer to use rather than a failure.
 */
export function reasonForStatus(status) {
    if (status >= 200 && status < 300) return null;

    return status === UNAUTHORIZED || status === FORBIDDEN
        ? REASON.PERMISSION_DENIED
        : REASON.HTTP;
}

/** The one command that fixes a permission failure. */
const OPERATOR_COMMAND = 'sudo tailscale set --operator=$USER';

/**
 * Whether the reason is something the user can act on.
 *
 * Drives whether the menu offers the message as a prominent row or keeps it as
 * a subtitle: telling someone the daemon is unreachable is noise, telling them
 * they need to be the operator is not.
 *
 * @param {string} reason One of {@link REASON}.
 * @returns {boolean} True if there is something to do about it.
 */
export function isActionable(reason) {
    return reason === REASON.PERMISSION_DENIED || reason === REASON.SOCKET_MISSING;
}

/**
 * The shell command that fixes the reason, if one does.
 *
 * The command is data, so it is returned as data. It used to be recovered in
 * modules/panel.js by running a regular expression over the message prose —
 * which meant a reason whose message names no command (SOCKET_MISSING is
 * actionable and names none) copied a whole English sentence to the clipboard,
 * and rewording a message here broke the clipboard silently.
 *
 * @param {string} reason One of {@link REASON}.
 * @returns {string} The command, or '' if there is nothing to run.
 */
export function commandFor(reason) {
    return reason === REASON.PERMISSION_DENIED ? OPERATOR_COMMAND : '';
}

/**
 * The sentence for a failure, translated.
 *
 * The wording is chosen here, a whole literal sentence per case inside its own
 * `_()`, where xgettext can see every one of them. Handing gettext a sentence
 * composed at run time asks it for a msgid no translator was ever given.
 *
 * gettext is passed in rather than imported, which keeps this file importable
 * on plain Node and from prefs.js, which cannot reach the Shell's modules — so
 * the preferences window words a failure exactly as the menu does.
 *
 * PERMISSION_DENIED is the one that earns its place. The daemon refuses every
 * change with a 403 from a user who is not the tailscale operator, and a
 * switch that just flips back would leave no way to discover that one command
 * fixes it.
 *
 * @param {string} reason One of {@link REASON}.
 * @param {Function} _ gettext.
 * @returns {string} A sentence for the menu.
 */
export function problemMessage(reason, _) {
    switch (reason) {
        case REASON.SOCKET_MISSING:
            return _('Tailscale is not installed, or has never been started.');
        case REASON.CONNECTION_REFUSED:
            return _('The Tailscale daemon is not running.');
        case REASON.PERMISSION_DENIED:
            return fill(_('Not permitted. Run: %s'), commandFor(reason));
        case REASON.HTTP:
            return _('The Tailscale daemon refused the request.');
        case REASON.PROTOCOL:
            return _('The Tailscale daemon sent an unexpected response.');
        case REASON.LOCAL_FILE:
            return _('Could not save the file.');
        default:
            return _('Could not reach the Tailscale daemon.');
    }
}
