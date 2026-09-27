// Preferences. Runs in its own process, with no access to gnome-shell's
// resource:// modules — so nothing here may import modules/panel.js or
// modules/io.js.
//
// It holds only widget construction. The capture rules live in
// modules/shortcuts.js and the key list in modules/settings.js, both of which
// import nothing and are tested on plain Node; this file is excluded from
// coverage for exactly that reason.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { CancelToken } from './modules/cancel.js';
import { problemMessage, reasonOf } from './modules/errors.js';
import { createIo } from './modules/io.js';
import { patchPrefsRequest, prefsRequest } from './modules/localapi.js';
import { parseRoutes, subnetRoutes, withSubnets } from './modules/routes.js';
import { KEYS, SHORTCUT_KEYS, settingText } from './modules/settings.js';
import {
    CAPTURE_ASSIGN,
    CAPTURE_CANCEL,
    CAPTURE_CLEAR,
    captureOutcome,
} from './modules/shortcuts.js';
import { fill } from './modules/text.js';

// The Gdk and Gtk values modules/shortcuts.js needs. Passed in rather than
// imported there, so the rules themselves stay testable on plain Node.
const GTK_BINDING = {
    get escapeKey() {
        return Gdk.KEY_Escape;
    },
    get backspaceKey() {
        return Gdk.KEY_BackSpace;
    },
    get shiftMask() {
        return Gdk.ModifierType.SHIFT_MASK;
    },
    acceleratorValid: (keyval, mask) => Gtk.accelerator_valid(keyval, mask),
};

const ShortcutRow = GObject.registerClass(
    class QuickTSShortcutRow extends Adw.ActionRow {
        /**
         * @param {Gio.Settings} settings Extension settings.
         * @param {string} key Schema key holding the binding.
         * @param {string} title Human-readable name.
         * @param {string} subtitle What the shortcut does.
         */
        _init(settings, key, title, subtitle) {
            super._init({ title, subtitle, activatable: true });

            this._settings = settings;
            this._key = key;

            this._label = new Gtk.ShortcutLabel({
                disabled_text: _('Disabled'),
                valign: Gtk.Align.CENTER,
            });
            this.add_suffix(this._label);

            this._sync();
            this._changedId = settings.connect(`changed::${key}`, () => this._sync());
            this.connect('destroy', () => {
                if (this._changedId) {
                    this._settings.disconnect(this._changedId);
                    this._changedId = 0;
                }
            });
            this.connect('activated', () => this._capture());
        }

        /** Refresh the displayed accelerator from settings. */
        _sync() {
            this._label.accelerator = this._settings.get_strv(this._key)[0] ?? '';
        }

        /** Open a modal window that records the next key combination. */
        _capture() {
            const dialog = new Adw.Window({
                modal: true,
                transient_for: this.get_root(),
                default_width: 420,
                default_height: 220,
            });

            const view = new Adw.ToolbarView();
            view.add_top_bar(new Adw.HeaderBar({ show_end_title_buttons: false }));
            view.content = new Adw.StatusPage({
                title: _('Press a shortcut'),
                description: _('Backspace clears it, Escape cancels.'),
            });
            dialog.content = view;

            const controller = new Gtk.EventControllerKey();
            controller.connect('key-pressed', (_controller, keyval, keycode, state) => {
                const mask = state & Gtk.accelerator_get_default_mod_mask();
                const codePoint = Gdk.keyval_to_unicode(keyval);

                // The decision lives in modules/shortcuts.js and is tested
                // there; this only carries it out on the widgets.
                const outcome = captureOutcome(keyval, mask, {
                    ...GTK_BINDING,
                    codePoint,
                });

                if (outcome === CAPTURE_CANCEL) {
                    dialog.close();
                    return Gdk.EVENT_STOP;
                }

                if (outcome === CAPTURE_CLEAR) {
                    this._settings.set_strv(this._key, []);
                    dialog.close();
                    return Gdk.EVENT_STOP;
                }

                if (outcome !== CAPTURE_ASSIGN) return Gdk.EVENT_STOP;

                this._settings.set_strv(this._key, [
                    Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask),
                ]);
                dialog.close();
                return Gdk.EVENT_STOP;
            });
            dialog.add_controller(controller);

            // Stop GNOME acting on its own shortcuts while one is being
            // captured, so a combination like Super or Print SysRq reaches
            // this dialog and can be refused or bound here, instead of opening
            // the overview or taking a screenshot out from under it. Mutter
            // runs global keybindings before a focused client sees the key
            // unless that client's surface inhibits them. gnome-control-center
            // does the same; the Shell may ask the user first the first time
            // an extension asks for this.
            //
            // Inhibited on map rather than right after present(), because the
            // surface exists only once the window is realized, and restored on
            // unmap, so that every way out — Escape, Backspace, an assigned
            // key, the window's own close button — gives the shortcuts back.
            // The same timing as QuickTiler's prefs.js.
            dialog.connect('map', () => {
                const surface = dialog.get_surface();
                if (surface instanceof Gdk.Toplevel)
                    surface.inhibit_system_shortcuts(null);
            });
            dialog.connect('unmap', () => {
                const surface = dialog.get_surface();
                if (surface instanceof Gdk.Toplevel) surface.restore_system_shortcuts();
            });

            dialog.present();
        }
    },
);

/**
 * The row that edits the subnets this machine advertises.
 *
 * Talks to tailscaled rather than to GSettings. The daemon owns
 * AdvertiseRoutes, and mirroring it into a settings key would be two sources
 * of truth that drift the first time anyone runs `tailscale set`. This is
 * possible at all because modules/io.js imports Gio, GLib and Soup and nothing
 * from resource:/// — so the preferences process, which has no access to the
 * Shell's modules, can still use it.
 *
 * Feedback goes to a toast on the window. Adw.EntryRow has no subtitle — its
 * only text properties are the title and the entry itself — so a message
 * assigned to one is set on nothing and never seen.
 */
const RoutesRow = GObject.registerClass(
    class QuickTSRoutesRow extends Adw.EntryRow {
        /**
         * @param {object} io The transport, from createIo.
         * @param {(message: string) => void} say Shows a message to the user.
         */
        _init(io, say) {
            super._init({
                title: _('Advertised subnets'),
                // Applied on Enter or on the apply button, not on every
                // keystroke: half a CIDR prefix is not a route.
                show_apply_button: true,
            });

            this._io = io;
            this._say = say;

            this.connect('apply', () => void this._apply());
            void this._load();
        }

        /** Read the current routes off the daemon. */
        async _load() {
            try {
                const prefs = await this._io.client.request(prefsRequest());
                this.text = subnetRoutes(prefs.AdvertiseRoutes).join(', ');
            } catch (error) {
                this.sensitive = false;
                this._say(problemMessage(reasonOf(error), _));
                console.warn(`[quickts] could not read routes: ${error}`);
            }
        }

        /** Send what was typed, refusing anything that is not a prefix. */
        async _apply() {
            const { routes, invalid } = parseRoutes(this.text);

            if (invalid.length > 0) {
                // Reported rather than dropped: silently discarding a typo
                // would leave someone believing a subnet is advertised.
                this.add_css_class('error');
                this._say(fill(_('Not a subnet: %s'), invalid.join(', ')));
                return;
            }

            this.remove_css_class('error');

            try {
                // Read first rather than trusting what was loaded: the
                // exit-node setting lives in the same list and may have been
                // toggled from the menu since.
                const current = await this._io.client.request(prefsRequest());
                await this._io.client.request(
                    patchPrefsRequest({
                        AdvertiseRoutes: withSubnets(current.AdvertiseRoutes, routes),
                    }),
                );
                this._say(_('Advertised subnets updated'));
            } catch (error) {
                this._say(problemMessage(reasonOf(error), _));
                console.warn(`[quickts] could not set routes: ${error}`);
            }
        }
    },
);

export default class QuickTSPreferences extends ExtensionPreferences {
    /**
     * @param {Adw.PreferencesWindow} window Window to populate.
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        const menu = new Adw.PreferencesGroup({
            title: _('Menu'),
            description: _('What the Quick Settings menu lists.'),
        });

        // Titled from modules/settings.js, which is where a key is described,
        // and bound the one way every row is bound.
        const addRow = (group, key, row, property) => {
            const { label, detail } = settingText(key, _);

            row.title = label;
            row.subtitle = detail;
            settings.bind(key, row, property, Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };

        addRow(menu, KEYS.SHOW_OFFLINE_NODES, new Adw.SwitchRow(), 'active');
        addRow(menu, KEYS.SHOW_MULLVAD, new Adw.SwitchRow(), 'active');
        addRow(
            menu,
            KEYS.MAX_MENU_HEIGHT,
            new Adw.SpinRow({
                adjustment: new Gtk.Adjustment({
                    lower: 0,
                    upper: 2000,
                    step_increment: 10,
                    page_increment: 100,
                }),
            }),
            'value',
        );

        page.add(menu);

        const routing = new Adw.PreferencesGroup({
            title: _('Routing'),
            description: _(
                'Subnets this machine offers to route for, comma separated — ' +
                    'for example 192.168.1.0/24. Running as an exit node is ' +
                    'toggled from the menu.',
            ),
        });

        // One token for the lifetime of the window; canceling it aborts any
        // request still in flight when it closes.
        const token = new CancelToken();
        const io = createIo({ token });
        window.connect('close-request', () => {
            token.cancel();
            io.dispose();
            return false;
        });

        // use_markup off: the message can carry what was typed, and a stray
        // angle bracket in markup is a parse error rather than text.
        const say = message =>
            window.add_toast(new Adw.Toast({ title: message, use_markup: false }));

        routing.add(new RoutesRow(io, say));
        page.add(routing);

        const shortcut = new Adw.PreferencesGroup({ title: _('Keyboard shortcut') });
        const openMenu = settingText(SHORTCUT_KEYS.OPEN_MENU, _);
        shortcut.add(
            new ShortcutRow(
                settings,
                SHORTCUT_KEYS.OPEN_MENU,
                openMenu.label,
                openMenu.detail,
            ),
        );
        page.add(shortcut);

        window.add(page);
    }
}
