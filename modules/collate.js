// How names are ordered wherever QuickTS sorts them.
//
// This file imports nothing.

// One collator, built once and shared. Its compare() orders exactly as
// localeCompare() does, but a bare localeCompare() call resolves a collator
// every time, and these comparators run over the whole tailnet — several
// thousand nodes once Mullvad is enabled.
const collator = new Intl.Collator();

/**
 * Order two names the way a reader expects, accented letters included.
 *
 * @param {string} a A name.
 * @param {string} b Another.
 * @returns {number} Negative, zero or positive, as for Array.prototype.sort.
 */
export function compareNames(a, b) {
    return collator.compare(a, b);
}
