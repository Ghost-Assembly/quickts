// The settings QuickTS has, named once.
//
// Both modules/panel.js and prefs.js read this list rather than spelling the
// key strings out again, and tests/settings.test.js parses the gschema and
// asserts the two agree. That is how a preference that is configurable and
// inert gets caught before it ships.
//
// This file imports nothing.

/** Keys that hold a value. */
export const KEYS = Object.freeze({
    SHOW_OFFLINE_NODES: 'show-offline-nodes',
    SHOW_MULLVAD: 'show-mullvad',
    MAX_MENU_HEIGHT: 'max-menu-height',
});

/**
 * Keys that hold an accelerator.
 *
 * Main.wm.addKeybinding registers the key's NAME with Mutter, whose names are
 * one table shared by the whole Shell and every extension, and a second
 * registration of a name is refused. Hence the prefix: "open-menu" is a name
 * any extension might choose.
 */
export const SHORTCUT_KEYS = Object.freeze({
    OPEN_MENU: 'quickts-open-menu',
});

/**
 * Every key in the schema, with its type.
 *
 * tests/settings.test.js checks this list against the gschema, and that
 * settingText() has words for every key in it.
 */
export const SETTINGS = Object.freeze([
    Object.freeze({ key: KEYS.SHOW_OFFLINE_NODES, type: 'b' }),
    Object.freeze({ key: KEYS.SHOW_MULLVAD, type: 'b' }),
    Object.freeze({ key: KEYS.MAX_MENU_HEIGHT, type: 'i' }),
    Object.freeze({ key: SHORTCUT_KEYS.OPEN_MENU, type: 'as' }),
]);

/** Just the keys, in schema order. */
export const ALL_KEYS = Object.freeze(SETTINGS.map(setting => setting.key));

/**
 * What the preferences window calls a key, translated.
 *
 * The wording lives here rather than in prefs.js so that this file remains the
 * one place a key is described; spelling a title out again in prefs.js is how
 * the two drifted apart before. Each string is a literal inside its own `_()`,
 * the same pattern as modules/errors.js's problemMessage: prefs.js used to
 * pass this list's own English to `_()`, and xgettext never sees a variable.
 *
 * gettext is passed in, so this file still imports nothing.
 *
 * @param {string} key A key from KEYS or SHORTCUT_KEYS.
 * @param {Function} _ gettext.
 * @returns {{label: string, detail: string}} The row's title and subtitle,
 *   both empty for a key this file does not know.
 */
export function settingText(key, _) {
    switch (key) {
        case KEYS.SHOW_OFFLINE_NODES:
            return {
                label: _('Show offline devices'),
                detail: _('List devices that are not currently reachable.'),
            };
        case KEYS.SHOW_MULLVAD:
            return {
                label: _('Show Mullvad exit nodes'),
                detail: _('Grouped by country. A tailnet with Mullvad has thousands.'),
            };
        case KEYS.MAX_MENU_HEIGHT:
            return {
                label: _('Maximum height'),
                detail: _(
                    'Pixels. Zero uses whatever room the screen leaves below it.',
                ),
            };
        case SHORTCUT_KEYS.OPEN_MENU:
            return {
                label: _('Open the menu'),
                detail: _(
                    'Unbound by default, so it cannot collide with a GNOME shortcut.',
                ),
            };
        default:
            return { label: '', detail: '' };
    }
}
