// Gio, as far as modules/panel.js uses it.
//
// modules/io.js also imports Gio, but it is excluded from the suite by design
// — see vitest.config.js — so nothing here needs to resemble libsoup.

/** URIs modules/panel.js asked the desktop to open, in order. */
export const launchedUris = [];

/** The launch contexts passed with them, in the same order. */
export const launchContexts = [];

/** Set to an Error to make the next launch throw, as GIO does with no handler. */
export const launchFailure = { next: null };

/** Reset between tests. */
export function resetGio() {
    launchedUris.length = 0;
    launchContexts.length = 0;
    launchFailure.next = null;
}

export default {
    icon_new_for_string: name => ({ name, isGicon: true }),

    AppInfo: {
        launch_default_for_uri(uri, context) {
            if (launchFailure.next) {
                const error = launchFailure.next;
                launchFailure.next = null;
                throw error;
            }
            launchedUris.push(uri);
            launchContexts.push(context);
            return true;
        },
    },

    SettingsBindFlags: { DEFAULT: 0, GET: 1, SET: 2, NO_SENSITIVITY: 4 },

    FileQueryInfoFlags: { NONE: 0 },

    IOErrorEnum: {
        NOT_FOUND: 1,
        CANCELLED: 19,
        PERMISSION_DENIED: 14,
        CONNECTION_REFUSED: 39,
    },
};
