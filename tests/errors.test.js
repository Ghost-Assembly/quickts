import { describe, expect, it } from 'vitest';

import {
    REASON,
    TransportError,
    commandFor,
    isActionable,
    messageFor,
    reasonForIoError,
    reasonOf,
} from '../modules/errors.js';

// Stand-ins for the Gio.IOErrorEnum codes modules/io.js passes in, with the
// values GIO gives them.
const IO = Object.freeze({
    FAILED: 0,
    NOT_FOUND: 1,
    FILENAME_TOO_LONG: 9,
    NO_SPACE: 12,
    PERMISSION_DENIED: 14,
    READ_ONLY: 21,
    CONNECTION_REFUSED: 39,
    CONNECTION_CLOSED: 44,
});

describe('TransportError', () => {
    it('carries its reason and status', () => {
        const error = new TransportError(REASON.HTTP, 'HTTP 500', { status: 500 });

        expect(error.reason).toBe(REASON.HTTP);
        expect(error.status).toBe(500);
    });

    it('defaults the status when there was no response', () => {
        expect(new TransportError(REASON.CONNECTION_REFUSED, 'refused').status).toBe(0);
    });

    // Without cause, the Gio domain and code — the only things that say which
    // syscall failed — are flattened into the message and unrecoverable.
    it('keeps the original error reachable', () => {
        const gerror = new Error('g-io-error-quark: Connection refused (39)');

        expect(new TransportError(REASON.UNKNOWN, 'x', { cause: gerror }).cause).toBe(
            gerror,
        );
    });

    it('is recognizable across a realm boundary', () => {
        expect(new TransportError(REASON.HTTP, 'x').name).toBe('TransportError');
    });
});

describe('reasonOf', () => {
    it('reads the reason off a TransportError', () => {
        expect(reasonOf(new TransportError(REASON.PERMISSION_DENIED, 'x'))).toBe(
            REASON.PERMISSION_DENIED,
        );
    });

    it.each([
        ['a plain error', new Error('boom')],
        ['null', null],
        ['undefined', undefined],
    ])('reports %s as unknown', (_reason, value) => {
        expect(reasonOf(value)).toBe(REASON.UNKNOWN);
    });
});

describe('messageFor', () => {
    it('gives every reason a sentence', () => {
        for (const reason of Object.values(REASON))
            expect(messageFor(reason)).toMatch(/\S/);
    });

    // The whole point of classifying at all. tailscaled answers 403 to anyone
    // who is not the operator, and the extension QuickTS replaces logged that
    // to the journal and drew an empty menu — leaving no way to find out that
    // one command fixes it.
    it('names the command that fixes a permission failure', () => {
        expect(messageFor(REASON.PERMISSION_DENIED)).toContain(
            'tailscale set --operator=',
        );
    });

    it('falls back rather than returning nothing for an unknown reason', () => {
        expect(messageFor('something-new')).toBe(messageFor(REASON.UNKNOWN));
    });
});

describe('isActionable', () => {
    it.each([[REASON.PERMISSION_DENIED], [REASON.SOCKET_MISSING]])(
        '%s is something the user can act on',
        reason => {
            expect(isActionable(reason)).toBe(true);
        },
    );

    // Telling someone the daemon is unreachable is noise; it belongs in a
    // subtitle, not a row of its own.
    it.each([
        [REASON.CONNECTION_REFUSED],
        [REASON.HTTP],
        [REASON.UNKNOWN],
        [REASON.LOCAL_FILE],
    ])('%s is not', reason => {
        expect(isActionable(reason)).toBe(false);
    });
});

describe('commandFor', () => {
    // No command fixes a full disk or a download directory that is not
    // writable, and the operator command would be the wrong advice.
    it('names no command for a local file failure', () => {
        expect(commandFor(REASON.LOCAL_FILE)).toBe('');
    });
});

describe('reasonForIoError', () => {
    describe('talking to the daemon', () => {
        it.each([
            { name: 'NOT_FOUND', code: IO.NOT_FOUND, reason: REASON.SOCKET_MISSING },
            {
                name: 'CONNECTION_REFUSED',
                code: IO.CONNECTION_REFUSED,
                reason: REASON.CONNECTION_REFUSED,
            },
            {
                name: 'PERMISSION_DENIED',
                code: IO.PERMISSION_DENIED,
                reason: REASON.PERMISSION_DENIED,
            },
            {
                name: 'CONNECTION_CLOSED',
                code: IO.CONNECTION_CLOSED,
                reason: REASON.UNKNOWN,
            },
            { name: 'FAILED', code: IO.FAILED, reason: REASON.UNKNOWN },
        ])('reports $name as $reason', ({ code, reason }) => {
            expect(reasonForIoError(code, IO)).toBe(reason);
        });

        it('reports something that is not an I/O error as unknown', () => {
            expect(reasonForIoError(null, IO)).toBe(REASON.UNKNOWN);
        });
    });

    // Only the file was involved, so whatever went wrong went wrong with the
    // file. A name too long for the file system is not the daemon missing.
    describe('creating a local file', () => {
        it.each([
            { name: 'NOT_FOUND', code: IO.NOT_FOUND },
            { name: 'PERMISSION_DENIED', code: IO.PERMISSION_DENIED },
            { name: 'NO_SPACE', code: IO.NO_SPACE },
            { name: 'READ_ONLY', code: IO.READ_ONLY },
            { name: 'FILENAME_TOO_LONG', code: IO.FILENAME_TOO_LONG },
            { name: 'FAILED', code: IO.FAILED },
        ])('reports $name as the file', ({ code }) => {
            expect(reasonForIoError(code, IO, { local: true, remote: false })).toBe(
                REASON.LOCAL_FILE,
            );
        });
    });

    // A copy from the daemon's stream into the file: the codes only a file
    // system reports are the file's, and the rest are the stream's.
    describe('copying from the daemon into a local file', () => {
        it.each([
            { name: 'NO_SPACE', code: IO.NO_SPACE },
            { name: 'READ_ONLY', code: IO.READ_ONLY },
            { name: 'PERMISSION_DENIED', code: IO.PERMISSION_DENIED },
            { name: 'NOT_FOUND', code: IO.NOT_FOUND },
        ])('reports $name as the file, not the daemon', ({ code }) => {
            expect(reasonForIoError(code, IO, { local: true })).toBe(REASON.LOCAL_FILE);
        });

        it.each([
            {
                name: 'CONNECTION_CLOSED',
                code: IO.CONNECTION_CLOSED,
                reason: REASON.UNKNOWN,
            },
            {
                name: 'CONNECTION_REFUSED',
                code: IO.CONNECTION_REFUSED,
                reason: REASON.CONNECTION_REFUSED,
            },
            { name: 'FAILED', code: IO.FAILED, reason: REASON.UNKNOWN },
        ])('reports $name as $reason', ({ code, reason }) => {
            expect(reasonForIoError(code, IO, { local: true })).toBe(reason);
        });
    });
});
