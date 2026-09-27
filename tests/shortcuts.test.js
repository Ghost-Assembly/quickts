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
const SUPER = 0x4000000;
const ESCAPE = 0xff1b;
const BACKSPACE = 0xff08;
const F5 = 0xffc2;
const TAB = 0xff09;
const LEFT = 0xff51;

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

    // Shift alone is enough for a key that types nothing on its own and that
    // editing text does not need: a function key has no code point at all.
    it('accepts Shift+F5', () => {
        expect(isValidBinding(SHIFT, F5, { ...gtk, codePoint: 0 })).toBe(true);
    });

    // Shift with these selects text, moves focus or ends a line in every
    // application, though none of them types a visible character. Keyvals and
    // code points as Gdk 4 gives them (Gdk.KEY_*, Gdk.keyval_to_unicode) under
    // gjs; ISO_Left_Tab is what GTK reports for Shift+Tab, and dead_acute is a
    // dead key, which types the accent over the next letter.
    it.each([
        ['Left', LEFT, 0],
        ['Up', 0xff52, 0],
        ['Right', 0xff53, 0],
        ['Down', 0xff54, 0],
        ['Home', 0xff50, 0],
        ['End', 0xff57, 0],
        ['Page_Up', 0xff55, 0],
        ['Page_Down', 0xff56, 0],
        ['Tab', TAB, 0x09],
        ['ISO_Left_Tab', 0xfe20, 0],
        ['Return', 0xff0d, 0x0d],
        ['KP_Enter', 0xff8d, 0],
        ['Mode_switch', 0xff7e, 0],
        ['dead_acute', 0xfe51, 0],
    ])(
        'rejects Shift+%s, which applications need for editing text',
        (_name, keyval, codePoint) => {
            expect(isValidBinding(SHIFT, keyval, { ...gtk, codePoint })).toBe(false);
        },
    );

    // The ends of each run of dead keys.
    it.each([
        ['dead_grave', 0xfe50],
        ['dead_currency', 0xfe6f],
        ['dead_a', 0xfe80],
        ['dead_hamza', 0xfe8d],
        ['dead_lowline', 0xfe90],
        ['dead_longsolidusoverlay', 0xfe93],
    ])('rejects Shift+%s, a dead key', (_name, keyval) => {
        expect(isValidBinding(SHIFT, keyval, { ...gtk, codePoint: 0 })).toBe(false);
    });

    // The same keys stay bindable with a modifier other than Shift.
    it.each([
        ['Ctrl+Left', CONTROL, LEFT, 0],
        ['Super+Tab', SUPER, TAB, 0x09],
    ])('accepts %s', (_reason, mask, keyval, codePoint) => {
        expect(isValidBinding(mask, keyval, { ...gtk, codePoint })).toBe(true);
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
