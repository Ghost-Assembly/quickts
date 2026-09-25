// Files other people have sent here.
//
// Taildrop's receiving half. The daemon buffers an incoming file and lists it
// at /localapi/v0/files/; retrieving it is a GET of that name and removing it
// is a DELETE, which is exactly what `tailscale file get` does. Nothing is
// saved until someone asks for it, so the daemon is the only place a file sits
// until then.
//
// This file imports nothing.

/**
 * Normalize the waiting-file list.
 *
 * The endpoint answers `null` rather than `[]` when nothing is waiting, which
 * is the shape that makes a caller reaching straight for .length throw.
 *
 * @param {object[]|null} files The /files/ response.
 * @returns {Array<{name: string, size: number}>} Waiting files, largest last.
 */
export function waitingFiles(files) {
    if (!Array.isArray(files)) return [];

    return files
        .filter(file => typeof file?.Name === 'string' && file.Name !== '')
        .map(file => ({
            name: file.Name,
            size: Number.isFinite(file.Size) && file.Size > 0 ? file.Size : 0,
        }));
}

/**
 * A file size a person can read.
 *
 * Decimal units, which is what every file manager on this desktop shows, so a
 * number here matches the number there.
 *
 * @param {number} bytes Size in bytes.
 * @returns {string} A short size, untranslated.
 */
export function formatSize(bytes) {
    const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    const units = ['B', 'kB', 'MB', 'GB', 'TB'];

    let value = size;
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1000;
        unit += 1;
    }

    const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1);

    return `${rounded} ${units.at(unit)}`;
}

/** How many names {@link candidateNames} offers before giving up. */
export const MAX_CANDIDATES = 1000;

/**
 * Whether a waiting file's name is safe to use as a file name here.
 *
 * The name comes from whoever sent the file. tailscaled validates it on the
 * way in, but this is where it becomes a path on this machine, so it is not
 * taken on trust: anything that could name a directory, reach outside the
 * download directory, or hide itself as a dot file is refused rather than
 * repaired. A repaired name is a guess at what the sender meant.
 *
 * @param {unknown} name The name as the daemon lists it.
 * @returns {boolean} True if it is one plain, visible file name.
 */
export function isSafeFileName(name) {
    return (
        typeof name === 'string' &&
        name !== '' &&
        !name.includes('/') &&
        !name.includes('\0') &&
        !name.startsWith('.')
    );
}

/**
 * The names to try, in order, when saving a file.
 *
 * Offered rather than chosen: the caller creates each one exclusively and
 * moves to the next only when it already exists. Checking for a free name
 * first and writing it second is a race another process can win, and a
 * symlink planted between the two would be followed.
 *
 * The suffix goes before the extension, the way every file manager does it.
 * Bounded, so a directory where everything is taken fails the save rather
 * than hanging the Shell.
 *
 * @param {string} name A name that passed {@link isSafeFileName}.
 * @yields {string} Candidate names, the name as sent first.
 */
export function* candidateNames(name) {
    yield name;

    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';

    for (let n = 1; n < MAX_CANDIDATES; n += 1) yield `${stem} (${n})${extension}`;
}
