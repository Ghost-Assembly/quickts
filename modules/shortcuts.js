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
 * Whether a captured combination may be bound as a global shortcut.
 *
 * A bare key would steal it from every application. Shift alone is bindable
 * only when the key types nothing on its own, close to GNOME Settings' rule.
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
    if (mask === shiftMask && typesVisibly(codePoint)) return false;

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
