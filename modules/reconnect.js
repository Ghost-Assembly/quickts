// Keep a stream open for as long as the token is live.
//
// This file imports nothing but modules/cancel.js, and takes the connection,
// the clock and the schedule as arguments — so the entire retry behavior is
// exercised in Vitest on plain Node, with no timers and no sockets.

import { isCanceled } from './cancel.js';

/**
 * Consume a stream, reconnecting until canceled.
 *
 * Three rules, each one a way a stream loop goes quietly dead. Every error
 * that is not a cancellation is retried, never treated as the end. The wait
 * between attempts must reject on cancellation — the paired remove-and-reject
 * in modules/io.js — because this loop relies on that rejection to get out on
 * teardown. And a daemon that stays down is retried on a growing schedule,
 * not at a fixed rate forever.
 *
 * The attempt counter is driven by whether a connection *produced anything*,
 * not by whether it threw. A socket that accepts and immediately hangs up
 * exits the for-await cleanly, and treating that as success would hold the
 * backoff at its floor and hammer a half-open daemon. A stream that delivered
 * events and was then closed resets the count, so it is retried after
 * backoff(0) — half a second to a second — rather than after the climb.
 * QuickTS subscribes with NotifyInitialState, so a healthy subscription
 * produces an event immediately and the distinction costs nothing.
 *
 * `onOpen` is told when a stream produces its first event, and whether an
 * earlier connection came before it. The bus only reports what changes from
 * the moment of subscribing, so anything that changed while it was down is
 * never announced; a resumed stream is the caller's cue to re-read it.
 *
 * @param {object} options Options.
 * @param {import('./cancel.js').CancelToken} options.token Lifetime.
 * @param {() => AsyncIterable<string>} options.connect Opens the stream.
 * @param {(event: string) => void} options.onEvent Receives each line.
 * @param {(error: unknown) => void} options.onError Receives each failure.
 * @param {(resumed: boolean) => void} [options.onOpen] Told of each stream's first event.
 * @param {(ms: number) => Promise<void>} options.delay Waits, rejecting on cancel.
 * @param {(attempt: number) => number} options.backoff How long to wait before retry n.
 * @returns {Promise<void>} Resolves once the token is canceled.
 */
export async function runWithReconnect({
    token,
    connect,
    onEvent,
    onError,
    onOpen = () => {},
    delay,
    backoff,
}) {
    let attempt = 0;
    let connections = 0;

    while (!token.canceled) {
        // Counted per connection, not per success: a daemon that was down at
        // the first attempt was never read, so its first stream is a resume.
        connections += 1;
        const resumed = connections > 1;

        const outcome = await consumeStream({
            token,
            connect,
            onEvent,
            onError,
            onOpen: () => onOpen(resumed),
        });

        if (outcome === STREAM.CANCELED || token.canceled) return;
        if (outcome === STREAM.PRODUCTIVE) attempt = 0;

        try {
            await delay(backoff(attempt));
        } catch {
            // The only thing delay rejects with is cancellation.
            return;
        }

        if (outcome !== STREAM.PRODUCTIVE) attempt += 1;
    }
}

/** How one pass over the stream ended. */
const STREAM = Object.freeze({
    /** It delivered at least one event. */
    PRODUCTIVE: 'productive',
    /** It connected and delivered nothing, or failed. */
    BARREN: 'barren',
    /** The token was canceled; the loop should stop. */
    CANCELED: 'canceled',
});

/**
 * Consume one connection to exhaustion, or until it fails.
 *
 * Split out of the loop because the loop's job — how long to wait and whether
 * to count this as a failed attempt — is a different question from what
 * happened to this particular connection, and reading them together is what
 * pushed the loop past a sensible complexity.
 *
 * @param {object} options Options.
 * @param {import('./cancel.js').CancelToken} options.token Lifetime.
 * @param {() => AsyncIterable<string>} options.connect Opens the stream.
 * @param {(event: string) => void} options.onEvent Receives each line.
 * @param {(error: unknown) => void} options.onError Receives a real failure.
 * @param {() => void} options.onOpen Called once, before the first event.
 * @returns {Promise<string>} One of {@link STREAM}.
 */
async function consumeStream({ token, connect, onEvent, onError, onOpen }) {
    let productive = false;

    try {
        // `for await` gives correct teardown for free: breaking out of it, or
        // throwing through it, calls the generator's return(), which runs the
        // finally that closes the stream.
        for await (const event of connect()) {
            if (token.canceled) return STREAM.CANCELED;

            if (!productive) onOpen();
            productive = true;
            onEvent(event);
        }
    } catch (error) {
        // Checked before isCanceled, so a Gio cancellation that escaped
        // untranslated still ends the loop rather than being retried.
        if (token.canceled || isCanceled(error)) return STREAM.CANCELED;

        onError(error);
    }

    return productive ? STREAM.PRODUCTIVE : STREAM.BARREN;
}
