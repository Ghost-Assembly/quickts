// The rules for capturing an accelerator.
//
// Lifted from the sibling tiler repo, minus its conflictingActions: QuickTS
// has one shortcut, so there is nothing of its own for it to collide with.
// Nothing here or in Mutter detects an accelerator that something else also
// binds — Mutter refuses only a keybinding NAME already registered, which
// modules/panel.js handles by checking what addKeybinding returned.
//
// Imports nothing from gi://. The Gdk and Gtk values these rules need are
// passed in by prefs.js, which keeps the decisions testable on plain Node and
// leaves prefs.js holding only widget construction — the part no unit test can
// say anything useful about.

/** Close the capture dialog, changing nothing. */
export const CAPTURE_CANCEL = 'cancel';

/** Unbind the shortcut and close. */
export const CAPTURE_CLEAR = 'clear';

/** Not bindable; swallow the key and keep waiting. */
export const CAPTURE_IGNORE = 'ignore';

/** Bind the combination and close. */
export const CAPTURE_ASSIGN = 'assign';

/**
 * Keys that Shift alone may not be bound to, although none of them types a
 * visible character: Shift with one of them selects text, moves focus or
 * ends a line in every application.
 *
 * GNOME Settings' own list, forbidden_keyvals in is_valid_binding()
 * (gnome-control-center, panels/keyboard/keyboard-shortcuts.c), plus
 * ISO_Left_Tab, which is what GTK reports for Shift+Tab. Values are
 * Gdk.KEY_* under gjs with Gdk 4.
 */
const SHIFT_FORBIDDEN_KEYVALS = new Set([
    0xff50, // Home
    0xff51, // Left
    0xff52, // Up
    0xff53, // Right
    0xff54, // Down
    0xff55, // Page_Up
    0xff56, // Page_Down
    0xff57, // End
    0xff09, // Tab
    0xfe20, // ISO_Left_Tab
    0xff8d, // KP_Enter
    0xff0d, // Return
    0xff7e, // Mode_switch
]);

/**
 * The dead keys, as inclusive keyval ranges.
 *
 * Derived under gjs with Gdk 4.22: Gdk.keyval_name(k) for every k in
 * 0xfe50..0xfeff names dead_grave..dead_currency at 0xfe50-0xfe6f and
 * dead_a..dead_hamza at 0xfe80-0xfe8d, and nothing else starting with dead_.
 * The Gdk.KEY_dead_* constants add dead_lowline..dead_longsolidusoverlay at
 * 0xfe90-0xfe93, which keyval_name cannot name (it returns "0xfe90"), so they
 * are listed too.
 */
const DEAD_KEY_RANGES = [
    [0xfe50, 0xfe6f],
    [0xfe80, 0xfe8d],
    [0xfe90, 0xfe93],
];

/**
 * Whether a key is a dead key, which types nothing itself but puts an accent
 * on the next letter typed.
 *
 * @param {number} keyval Key value.
 * @returns {boolean} True for a dead key.
 */
function isDeadKey(keyval) {
    return DEAD_KEY_RANGES.some(([first, last]) => keyval >= first && keyval <= last);
}

/**
 * Whether a key's own code point types something visible.
 *
 * Control characters (Tab, Return, Delete, and the function keys, which carry
 * no code point at all) type nothing, which is what makes Shift+F5 bindable
 * where Shift+A is not: Shift+A is how a capital A is typed.
 *
 * @param {number} codePoint The character the key types on its own, as
 *   Gdk.keyval_to_unicode gives it; 0 or negative for none.
 * @returns {boolean} True if the key types a visible character.
 */
function typesVisibly(codePoint) {
    return codePoint > 0 && !/\p{Cc}/u.test(String.fromCodePoint(codePoint));
}

/**
 * Whether a captured key combination may be bound as a global shortcut.
 *
 * A bare key would steal it from every application, so it never may. Shift
 * alone may only with a key that types no visible character and is not one
 * that editing text needs (SHIFT_FORBIDDEN_KEYVALS) or a dead key: Shift+F5
 * may, Shift+A, Shift+Left and Shift+dead_acute may not. Any other modifier
 * makes a combination bindable, subject to Gtk's own accelerator check.
 *
 * Built on GNOME Settings' is_valid_binding() (gnome-control-center,
 * panels/keyboard/keyboard-shortcuts.c), and differs in three ways: this
 * refuses every bare key, where GNOME allows one such as F5; it refuses
 * Shift with a dead key, which GNOME's list leaves out; and it judges what
 * Shift alone types by whether the key's code point is a visible character,
 * where GNOME checks per-script keyval ranges.
 *
 * @param {number} mask Modifier mask, already reduced to the default mod mask.
 * @param {number} keyval Key value.
 * @param {{shiftMask: number, acceleratorValid: Function, codePoint: number}} gtk
 *   Gdk/Gtk values. codePoint is the character the key types on its own, as
 *   Gdk.keyval_to_unicode gives it.
 * @returns {boolean} True if the combination may be bound.
 */
export function isValidBinding(
    mask,
    keyval,
    { shiftMask, acceleratorValid, codePoint },
) {
    if (mask === 0) return false;
    if (
        mask === shiftMask &&
        (typesVisibly(codePoint) ||
            SHIFT_FORBIDDEN_KEYVALS.has(keyval) ||
            isDeadKey(keyval))
    )
        return false;

    return acceleratorValid(keyval, mask);
}

/**
 * What the capture dialog should do about a keypress.
 *
 * Escape and Backspace are treated as commands only when pressed unmodified,
 * so Ctrl+Escape and the like stay bindable rather than being swallowed.
 *
 * @param {number} keyval Key value.
 * @param {number} mask Modifier mask, reduced to the default mod mask.
 * @param {object} gtk Gdk/Gtk values: escapeKey, backspaceKey, shiftMask,
 *   acceleratorValid, and the key's codePoint.
 * @returns {string} One of the CAPTURE_* outcomes.
 */
export function captureOutcome(keyval, mask, gtk) {
    if (mask === 0 && keyval === gtk.escapeKey) return CAPTURE_CANCEL;
    if (mask === 0 && keyval === gtk.backspaceKey) return CAPTURE_CLEAR;
    if (!isValidBinding(mask, keyval, gtk)) return CAPTURE_IGNORE;

    return CAPTURE_ASSIGN;
}
