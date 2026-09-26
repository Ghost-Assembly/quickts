// Every msgid xgettext can actually pull out of modules/: a string literal as
// the whole first argument of _(), or the first two arguments of _n()
// (xgettext -k_ -k_n:1,2). A variable, a template, or a composed sentence
// there is invisible to it — the extension would enable, look right under
// `gettext: message => message`, and ship with a msgid no translator was ever
// given.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STRING = `'((?:[^'\\\\]|\\\\.)*)'`;
const SINGLE = new RegExp(`(?<![\\w.$])_\\(\\s*${STRING}\\s*[,)]`, 'g');
const PLURAL = new RegExp(`(?<![\\w.$])_n\\(\\s*${STRING}\\s*,\\s*${STRING}\\s*,`, 'g');

// Every _( or _n( call, wherever it starts — including one whose argument is
// not a literal, which is exactly what nonLiteralGettextCalls looks for. A
// bare `_()`, mentioned as prose in a comment rather than called with
// anything, is excluded so a docstring can still talk about the function.
const CALL_START = /(?<![\w.$])_n?\(/g;

/**
 * @returns {{name: string, source: string}[]} Every module file's name and
 *   contents, under modules/.
 */
function moduleFiles() {
    const dir = fileURLToPath(new URL('../../modules/', import.meta.url));
    // A module-relative constant directory and the files in it, not input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const names = readdirSync(dir).filter(name => name.endsWith('.js'));
    return names.map(name => ({
        name,
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        source: readFileSync(dir + name, 'utf8'),
    }));
}

/**
 * @returns {Set<string>} Every literal a translator would actually be shown,
 *   from every _() and _n() call anywhere under modules/.
 */
export function extractableMsgids() {
    const ids = new Set();
    for (const { source } of moduleFiles()) {
        for (const match of source.matchAll(SINGLE)) ids.add(match[1]);
        for (const match of source.matchAll(PLURAL)) {
            ids.add(match[1]);
            ids.add(match[2]);
        }
    }
    return ids;
}

/**
 * Every _()/_n() call under modules/ whose first argument is not a string
 * literal, as far as a regex can tell — the same authority extractableMsgids
 * already relies on. `_(variable)`, `_(a.b)` and `` _(`template`) `` are all
 * invisible to xgettext exactly the same way, and this is how a test catches
 * one before it ships rather than after a translator asks where a string's
 * msgid went.
 *
 * @returns {string[]} One line per offending call: "file:line: what follows".
 */
export function nonLiteralGettextCalls() {
    const violations = [];
    for (const { name, source } of moduleFiles()) {
        for (const match of source.matchAll(CALL_START)) {
            const after = source.slice(match.index + match[0].length);
            const leadingSpace = after.match(/^\s*/)[0];
            const next = after[leadingSpace.length];
            // A literal argument, or a bare _() with none at all — the latter
            // is never real code (nothing calls gettext with no message) and
            // is how this file's own comments can still say "_()".
            if (next === "'" || next === ')') continue;

            const line = source.slice(0, match.index).split('\n').length;
            const snippet = after.slice(0, 40).replace(/\s+/g, ' ').trim();
            violations.push(`${name}:${line}: ${match[0]}${snippet}`);
        }
    }
    return violations;
}
