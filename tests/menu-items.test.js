import { describe, expect, it } from 'vitest';

import { problemMessage as wordedInErrors } from '../modules/errors.js';
import { problemMessage } from '../modules/menu-items.js';

// The wording lives in modules/errors.js, where prefs.js can reach it too, and
// is tested there. The menu sections take it from here with the rest of what
// builds their rows, so it has to be the same function, not a second copy.
describe('problemMessage', () => {
    it('is the one modules/errors.js words failures with', () => {
        expect(problemMessage).toBe(wordedInErrors);
    });
});
