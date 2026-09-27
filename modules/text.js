// Filling a translated sentence with the values it names.
//
// This file imports nothing, so modules/errors.js can use it and stay
// import-free, and prefs.js can reach it without the Shell's modules.

/**
 * Fill a translated template's "%s" and "%d" placeholders, in order.
 *
 * Not String.prototype.replace with a string: that reads "$&", "$`" and "$'"
 * in a value as replacement patterns, and a node or file name is data. A
 * function replacer inserts each value as it is, and one pass over the
 * template never rescans a value that itself contains "%s". Each placeholder
 * past the last value is left as it is.
 *
 * The body is the same as QuickClip's and QuickMusic's copies; keep them so.
 *
 * @param {string} template Text with zero or more "%s"/"%d" placeholders.
 * @param {...*} values One value per placeholder, in order.
 * @returns {string} The filled template.
 */
export function fill(template, ...values) {
    let next = 0;
    return template.replace(/%[sd]/g, match =>
        next < values.length ? String(values[next++]) : match,
    );
}
