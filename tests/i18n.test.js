import { describe, expect, it } from 'vitest';

import { nonLiteralGettextCalls } from './support/i18n.js';

// A source-level guard alongside the scenario tests in panel.test.js,
// taildrop-section.test.js and device-section.test.js: those catch a
// composed message that happens to read differently from its literal, but
// every reason whose composed English coincides with its own literal one for
// one — every TaildropTargetStatus does, since modules/taildrop.js's
// reasonFor and modules/taildrop-section.js's taildropReason were written
// from the same wording — would pass those tests even with the bug back:
// `_(reason)` and `taildropReason(status, _)` show identical text under
// `gettext: message => message`. Only reading the source tells them apart.
describe('gettext calls under modules/', () => {
    it('never takes a variable, property or template as its message', () => {
        expect(nonLiteralGettextCalls()).toEqual([]);
    });
});
