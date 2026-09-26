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

/**
 * @returns {Set<string>} Every literal a translator would actually be shown,
 *   from every _() and _n() call anywhere under modules/.
 */
export function extractableMsgids() {
    const dir = fileURLToPath(new URL('../../modules/', import.meta.url));
    const ids = new Set();
    // A module-relative constant directory and the files in it, not input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const files = readdirSync(dir).filter(name => name.endsWith('.js'));
    for (const file of files) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const source = readFileSync(dir + file, 'utf8');
        for (const match of source.matchAll(SINGLE)) ids.add(match[1]);
        for (const match of source.matchAll(PLURAL)) {
            ids.add(match[1]);
            ids.add(match[2]);
        }
    }
    return ids;
}
