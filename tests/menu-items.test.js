import { describe, expect, it } from 'vitest';

import { REASON, commandFor } from '../modules/errors.js';
import { problemMessage } from '../modules/menu-items.js';

// Every branch, the same way tests/errors.test.js exercises messageFor's:
// problemMessage mirrors it, but through a literal _() call per case rather
// than translating messageFor's own composed English.
describe('problemMessage', () => {
    it.each(Object.values(REASON))('says something for %s', reason => {
        expect(problemMessage(reason, message => message)).toMatch(/\S/);
    });

    it('names the fix-it command for a permission failure', () => {
        expect(problemMessage(REASON.PERMISSION_DENIED, message => message)).toContain(
            commandFor(REASON.PERMISSION_DENIED),
        );
    });

    it('falls back to the same text as an unrecognized reason', () => {
        expect(problemMessage('something-new', message => message)).toBe(
            problemMessage(REASON.UNKNOWN, message => message),
        );
    });

    it('asks gettext to translate a literal, not the composed sentence', () => {
        const asked = [];
        problemMessage(
            REASON.PERMISSION_DENIED,
            message => (asked.push(message), message),
        );

        expect(asked).toEqual(['Not permitted. Run: %s']);
    });
});
