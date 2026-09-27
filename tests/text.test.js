import { describe, expect, it } from 'vitest';

import { fill } from '../modules/text.js';

describe('fill', () => {
    // A replacement string reads $&, $` and $' as patterns, but a node or file
    // name is data, and a translated sentence has to show it as it is.
    it.each(['$&', '$`', "$'"])('does not read %s in a value as a pattern', pattern => {
        expect(fill('Saved %s here', `a${pattern}b`)).toBe(`Saved a${pattern}b here`);
    });

    it('does not fill a placeholder that a value brought in', () => {
        expect(fill('%s ms, relayed via %s', '%s', 'lhr')).toBe(
            '%s ms, relayed via lhr',
        );
    });

    it('fills every placeholder in order, %s and %d alike', () => {
        expect(fill('Sent %d files to %s', 2, 'laptop')).toBe('Sent 2 files to laptop');
    });

    it('leaves a placeholder past the last value untouched', () => {
        expect(fill('%s and %s', 'only')).toBe('only and %s');
    });

    it('does not let a later $ pattern read an earlier value', () => {
        expect(fill('%s then %s', '$&', '$1')).toBe('$& then $1');
    });
});
