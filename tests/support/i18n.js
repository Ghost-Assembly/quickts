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

// A literal argument: a single- or double-quoted string. xgettext's own
// extractor (and extractableMsgids above) only ever sees these two shapes;
// prettier keeps this codebase to single quotes, but a checker that rejected
// a double-quoted literal as if it were a variable would be checking its own
// house style, not extractability.
const LITERAL_ARG = /^(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/;

/**
 * Every _()/_n() call under modules/ whose first argument — or, for _n(),
 * whose second (plural) argument — is not a string literal, as far as a
 * regex can tell — the same authority extractableMsgids already relies on.
 * `_(variable)`, `_(a.b)` and `` _(`template`) `` are all invisible to
 * xgettext exactly the same way, and so is `_n('one', pluralVar, n)`: the
 * PLURAL regex above pulls its msgid_plural from the same position, and a
 * variable there is just as silently dropped. This is how a test catches one
 * before it ships rather than after a translator asks where a string's msgid
 * went.
 *
 * @param {{name: string, source: string}[]} [files] Files to check; defaults
 *   to every module file, and is otherwise only ever overridden by a test.
 * @returns {string[]} One line per offending call: "file:line: what follows".
 */
export function nonLiteralGettextCalls(files = moduleFiles()) {
    const violations = [];
    for (const { name, source } of files) {
        for (const match of source.matchAll(CALL_START)) {
            const after = source.slice(match.index + match[0].length);
            const leadingSpace = after.match(/^\s*/)[0];
            const rest = after.slice(leadingSpace.length);

            // A bare _()/_n() with no argument at all is never real code —
            // nothing calls gettext with no message — and is how this file's
            // own comments can still say "_()".
            if (rest[0] === ')') continue;

            const first = rest.match(LITERAL_ARG);
            if (!first) {
                const line = source.slice(0, match.index).split('\n').length;
                const snippet = after.slice(0, 40).replace(/\s+/g, ' ').trim();
                violations.push(`${name}:${line}: ${match[0]}${snippet}`);
                continue;
            }

            // Only _n() takes a second, plural argument — and only once the
            // first was itself a literal; a non-literal first argument was
            // already flagged above.
            if (match[0] !== '_n(') continue;

            const afterFirst = rest.slice(first[0].length);
            const comma = afterFirst.match(/^\s*,\s*/);
            if (!comma) continue; // not a well-formed call; not this check's job

            const second = afterFirst.slice(comma[0].length);
            if (!LITERAL_ARG.test(second)) {
                const offset =
                    match.index +
                    match[0].length +
                    leadingSpace.length +
                    first[0].length +
                    comma[0].length;
                const line = source.slice(0, offset).split('\n').length;
                const snippet = second.slice(0, 40).replace(/\s+/g, ' ').trim();
                violations.push(`${name}:${line}: ${snippet}`);
            }
        }
    }
    return violations;
}
