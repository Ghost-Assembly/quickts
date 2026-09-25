// Cancellation, as a plain value that can be passed around and awaited on.
//
// This file imports nothing. GJS 1.88 has no AbortController and no
// AbortSignal — checked against the running interpreter, not assumed — so
// there is nothing on the platform to use here and the type is ours to define.
//
// The whole point of it is the pairing in `onCancel`. Canceling must both
// release the resource *and* settle whatever was waiting on it. Doing only the
// first — removing a GLib timeout a reconnect loop is awaiting — means the
// callback never runs, the promise never settles, and the loop, its async
// generator, its input stream and its Soup session all stay alive until the
// Shell restarts.

/** Thrown by anything that was waiting when the token was canceled. */
export class CanceledError extends Error {
    /**
     * @param {string} [message] Description.
     */
    constructor(message = 'canceled') {
        super(message);

        // Set explicitly rather than left to the constructor name, so that
        // isCanceled() still recognizes it after a minifier or a second realm.
        this.name = 'CanceledError';
    }
}

/**
 * Whether an error means "we canceled this", rather than "this failed".
 *
 * Gio reports its own cancellation as a GError in the Gio.IOErrorEnum domain.
 * Translating that into a CanceledError is modules/io.js's job, at the
 * boundary where Gio is actually in scope — this file must stay importless. A
 * Gio error that escapes untranslated is still handled safely, because every
 * caller checks `token.canceled` before it consults this.
 *
 * @param {unknown} error Caught value.
 * @returns {boolean} True if the operation was canceled rather than failed.
 */
export function isCanceled(error) {
    return error instanceof CanceledError || error?.name === 'CanceledError';
}

/** A one-way flag that fires callbacks when it is set. */
export class CancelToken {
    #canceled = false;
    #callbacks = new Set();

    /** @returns {boolean} Whether cancel() has been called. */
    get canceled() {
        return this.#canceled;
    }

    /**
     * Cancel, running every registered callback exactly once.
     *
     * Idempotent, because disable() may run after something has already given
     * up. Callbacks are collected before any of them runs, so a callback that
     * registers another one during teardown cannot extend the iteration.
     *
     * A throwing callback must not strand the ones after it: teardown is the
     * one moment where a single failure would leak everything else.
     */
    cancel() {
        if (this.#canceled) return;
        this.#canceled = true;

        const callbacks = [...this.#callbacks];
        this.#callbacks.clear();

        for (const callback of callbacks) {
            try {
                callback();
            } catch (error) {
                console.warn(`[quickts] cancellation callback failed: ${error}`);
            }
        }
    }

    /**
     * Register a callback to run on cancellation.
     *
     * Registering after cancellation runs the callback immediately, so a caller
     * that races disable() still cleans up rather than waiting for a signal
     * that has already been sent.
     *
     * @param {() => void} callback Runs once, when the token is canceled.
     * @returns {() => void} Unregisters the callback. Safe to call more than once.
     */
    onCancel(callback) {
        if (this.#canceled) {
            callback();
            return () => {};
        }

        this.#callbacks.add(callback);
        return () => this.#callbacks.delete(callback);
    }

    /** @throws {CanceledError} If the token has been canceled. */
    throwIfCanceled() {
        if (this.#canceled) throw new CanceledError();
    }

    /** @returns {number} Registered callbacks. Lets a test assert nothing leaked. */
    get callbackCount() {
        return this.#callbacks.size;
    }
}
