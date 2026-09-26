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

// A scratch probe over synthetic sources, not modules/ — the scenario above
// can only prove today's code is clean; it says nothing about whether the
// checker would catch a regression. `_n()`'s plural argument is pulled out by
// xgettext (-k_n:1,2) exactly like its first, so a variable there is exactly
// as invisible, and a checker that only ever looked at the first argument
// would pass a file with the bug back in it.
describe('nonLiteralGettextCalls(), against synthetic sources', () => {
    const probe = source => nonLiteralGettextCalls([{ name: 'probe.js', source }]);

    it('flags a variable plural argument in _n()', () => {
        expect(probe("_n('one thing', pluralLabel, n)")).toEqual([
            'probe.js:1: pluralLabel, n)',
        ]);
    });

    it('accepts a literal plural argument in _n()', () => {
        expect(probe("_n('one thing', 'many things', n)")).toEqual([]);
    });

    it('still flags a non-literal first argument in _n()', () => {
        expect(probe('_n(label, "many things", n)')).toEqual([
            'probe.js:1: _n(label, "many things", n)',
        ]);
    });

    it('accepts a double-quoted literal', () => {
        expect(probe('_("hello")')).toEqual([]);
        expect(probe('_n("one thing", "many things", n)')).toEqual([]);
    });
});
