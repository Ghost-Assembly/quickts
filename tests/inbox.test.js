import { describe, expect, it } from 'vitest';

import {
    MAX_CANDIDATES,
    candidateNames,
    formatSize,
    isSafeFileName,
    waitingFiles,
} from '../modules/inbox.js';

describe('waitingFiles', () => {
    it('reads the shape the daemon sends', () => {
        expect(
            waitingFiles([
                { Name: 'report.pdf', Size: 1024 },
                { Name: 'notes.txt', Size: 12 },
            ]),
        ).toEqual([
            { name: 'report.pdf', size: 1024 },
            { name: 'notes.txt', size: 12 },
        ]);
    });

    // The endpoint answers null, not [], when nothing is waiting.
    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a non-array', {}],
    ])('returns nothing for %s', (_reason, files) => {
        expect(waitingFiles(files)).toEqual([]);
    });

    it('drops an entry with no usable name', () => {
        expect(waitingFiles([{ Name: '', Size: 1 }, { Size: 2 }, null])).toEqual([]);
    });

    it.each([
        ['a missing size', { Name: 'a', Size: undefined }],
        ['a negative size', { Name: 'a', Size: -5 }],
        ['a size that is not a number', { Name: 'a', Size: 'big' }],
    ])('treats %s as zero', (_reason, file) => {
        expect(waitingFiles([file]).at(0).size).toBe(0);
    });
});

describe('formatSize', () => {
    it.each([
        [0, '0 B'],
        [12, '12 B'],
        [999, '999 B'],
        [1000, '1.0 kB'],
        [1536, '1.5 kB'],
        [1_000_000, '1.0 MB'],
        [2_500_000_000, '2.5 GB'],
    ])('formats %i as %s', (bytes, expected) => {
        expect(formatSize(bytes)).toBe(expected);
    });

    it.each([
        ['a negative size', -1],
        ['a non-number', 'big'],
        ['undefined', undefined],
    ])('reports %s as nothing', (_reason, bytes) => {
        expect(formatSize(bytes)).toBe('0 B');
    });

    it('does not run past the largest unit', () => {
        expect(formatSize(Number.MAX_SAFE_INTEGER)).toMatch(/TB$/);
    });
});

describe('isSafeFileName', () => {
    it.each(['report.pdf', 'README', 'a.tar.gz', 'photo (1).jpg', 'naïve café.txt'])(
        'accepts %s',
        name => {
            expect(isSafeFileName(name)).toBe(true);
        },
    );

    // The name comes from whoever sent the file. tailscaled validates it too,
    // but it becomes a path on this machine here, so it is checked here: none
    // of these may name anything but a new file in the download directory.
    it.each([
        ['empty', ''],
        ['a path', 'sub/dir.txt'],
        ['an absolute path', '/etc/passwd'],
        ['a parent reference', '..'],
        ['a traversal', '../escape.txt'],
        ['the directory itself', '.'],
        ['a hidden file', '.bashrc'],
        ['a NUL byte', 'a\0b.txt'],
        ['not a string', null],
    ])('refuses %s', (_reason, name) => {
        expect(isSafeFileName(name)).toBe(false);
    });
});

describe('candidateNames', () => {
    const first = (name, count) => [...candidateNames(name)].slice(0, count);

    it('offers the name as sent first', () => {
        expect(first('report.pdf', 1)).toEqual(['report.pdf']);
    });

    // Two people can both send "report.pdf", and a save that overwrites is a
    // save that loses data. The caller creates each candidate exclusively and
    // moves on when one exists, so the numbering goes before the extension,
    // the way every file manager does it.
    it('numbers the rest before the extension', () => {
        expect(first('report.pdf', 3)).toEqual([
            'report.pdf',
            'report (1).pdf',
            'report (2).pdf',
        ]);
    });

    it('handles a name with no extension', () => {
        expect(first('README', 2)).toEqual(['README', 'README (1)']);
    });

    it('uses the last dot', () => {
        expect(first('a.tar.gz', 2)).toEqual(['a.tar.gz', 'a.tar (1).gz']);
    });

    // A directory where every name is taken must fail the save, not hang the
    // Shell.
    it('ends', () => {
        expect([...candidateNames('a.txt')]).toHaveLength(MAX_CANDIDATES);
    });
});
