import { describe, expect, it } from 'vitest';

import {
    CAPTURE_ASSIGN,
    CAPTURE_CANCEL,
    CAPTURE_CLEAR,
    CAPTURE_IGNORE,
    captureOutcome,
    isValidBinding,
} from '../modules/shortcuts.js';

// Stand-ins for the Gdk and Gtk values prefs.js passes in.
const SHIFT = 1;
const CONTROL = 4;
const ESCAPE = 0xff1b;
const BACKSPACE = 0xff08;
const F5 = 0xffc2;
const TAB = 0xff09;

const gtk = {
    escapeKey: ESCAPE,
    backspaceKey: BACKSPACE,
    shiftMask: SHIFT,
    acceleratorValid: () => true,
    // What Gdk.keyval_to_unicode gives for the key: 0x61 is 'a', which types
    // something on its own.
    codePoint: 0x61,
};

describe('isValidBinding', () => {
    it('accepts a modified key', () => {
        expect(isValidBinding(CONTROL, 0x61, gtk)).toBe(true);
    });

    // A bare key would steal it from every application, F5 included, and
    // Shift with a letter is how a capital letter is typed.
    it.each([
        ['no modifier', 0, 0x61, 0x61],
        ['a bare F5', 0, F5, 0],
        ['Shift+a', SHIFT, 0x61, 0x61],
        ['Shift+A', SHIFT, 0x41, 0x41],
    ])('rejects %s', (_reason, mask, keyval, codePoint) => {
        expect(isValidBinding(mask, keyval, { ...gtk, codePoint })).toBe(false);
    });

    // Close to GNOME Settings' rule: Shift alone is enough for a key that types
    // nothing on its own — a function key has no code point, and Tab's is a
    // control character.
    it.each([
        ['Shift+F5', F5, 0],
        ['Shift+Tab', TAB, 0x09],
    ])('accepts %s', (_reason, keyval, codePoint) => {
        expect(isValidBinding(SHIFT, keyval, { ...gtk, codePoint })).toBe(true);
    });

    it('defers to Gtk on what is a valid accelerator', () => {
        expect(
            isValidBinding(CONTROL, 0x61, { ...gtk, acceleratorValid: () => false }),
        ).toBe(false);
    });
});

describe('captureOutcome', () => {
    it('assigns a valid combination', () => {
        expect(captureOutcome(0x61, CONTROL, gtk)).toBe(CAPTURE_ASSIGN);
    });

    it('cancels on a bare Escape', () => {
        expect(captureOutcome(ESCAPE, 0, gtk)).toBe(CAPTURE_CANCEL);
    });

    it('clears on a bare Backspace', () => {
        expect(captureOutcome(BACKSPACE, 0, gtk)).toBe(CAPTURE_CLEAR);
    });

    // Otherwise Ctrl+Escape could never be bound, because the dialog would
    // swallow it as a cancel.
    it.each([
        ['Escape', ESCAPE],
        ['Backspace', BACKSPACE],
    ])(
        'binds a modified %s rather than treating it as a command',
        (_reason, keyval) => {
            expect(captureOutcome(keyval, CONTROL, gtk)).toBe(CAPTURE_ASSIGN);
        },
    );

    it('swallows a combination that cannot be bound', () => {
        expect(captureOutcome(0x61, 0, gtk)).toBe(CAPTURE_IGNORE);
    });

    it('assigns Shift with a key that types nothing', () => {
        expect(captureOutcome(F5, SHIFT, { ...gtk, codePoint: 0 })).toBe(
            CAPTURE_ASSIGN,
        );
    });
});
