import { describe, expect, it } from 'vitest';

import { compareNames } from '../modules/collate.js';

describe('compareNames', () => {
    // A code-point comparison sorts every accented name after z.
    it('sorts an accented name where a reader expects it', () => {
        expect(['zeta', 'éclair', 'apple'].sort(compareNames)).toEqual([
            'apple',
            'éclair',
            'zeta',
        ]);
    });

    it('treats equal names as equal', () => {
        expect(compareNames('laptop', 'laptop')).toBe(0);
    });
});
