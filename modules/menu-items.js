// Menu rows and small helpers every section of the QuickTS menu shares.
//
// Split out of modules/panel.js so each section module can build its rows
// the same way. Nothing here holds state: a row class, or a function that
// builds a row or carries one action out.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { describeWarning } from './warnings.js';

/**
 * A row that acts without closing the menu.
 *
 * PopupMenuBase connects to every item's 'activate' with ConnectFlags.AFTER
 * and calls itemActivated(), which closes the top menu — so by default a click
 * anywhere dismisses the whole panel. That is right for a row whose job is
 * finished once it is clicked, like copying an address or picking an exit
 * node, and wrong for one whose result appears in the menu, or that navigates
 * within it.
 *
 * Declining to chain up is how gnome-shell itself keeps a menu open: it is
 * what PopupSwitchMenuItem does for the space key.
 */
export const ActionMenuItem = GObject.registerClass(
    class QuickTSActionMenuItem extends PopupMenu.PopupImageMenuItem {
        _init(text, icon, onActivate) {
            super._init(text, icon);
            this._onActivate = onActivate;
        }

        /**
         * @param {object} _event Unused; the row is the only context needed.
         */
        activate(_event) {
            this._onActivate(this);
        }
    },
);

/**
 * A switch that does not dismiss the menu when it is flipped.
 *
 * Turning on accept-routes and then accept-DNS should not mean two trips
 * through the panel. gnome-shell already allows this from the keyboard —
 * PopupSwitchMenuItem returns early for the space key — and this extends the
 * same behavior to the pointer.
 */
export const StayOpenSwitchMenuItem = GObject.registerClass(
    class QuickTSSwitchMenuItem extends PopupMenu.PopupSwitchMenuItem {
        /**
         * @param {object} _event Unused; toggling is the whole action.
         */
        activate(_event) {
            this.toggle();
        }
    },
);

/**
 * Add a row that acts once and lets the menu close.
 *
 * The counterpart to ActionMenuItem, which is for the rows whose
 * result appears in the menu; the choice between the two is the whole
 * difference, so it stays visible at the call site by which one is
 * used. `owner` owns the connection, so its disconnectObject() — or the
 * row's own destruction — releases it along with everything else.
 *
 * @param {object} menu The menu to add it to.
 * @param {string} label What it says.
 * @param {string} icon Icon name, or '' for none.
 * @param {Function} onActivate What clicking it does.
 * @param {object} owner Who owns the connection.
 * @returns {object} The row.
 */
export function addRow(menu, label, icon, onActivate, owner) {
    const item = new PopupMenu.PopupImageMenuItem(label, icon);
    item.connectObject('activate', onActivate, owner);
    menu.addMenuItem(item);

    return item;
}

/**
 * Put text on both clipboards and say so.
 *
 * Both, because X11 applications paste from PRIMARY with the middle button
 * while everything else uses CLIPBOARD, and a person who has just copied an
 * address does not want to think about which.
 *
 * @param {string} text What to copy.
 * @param {object} gicon Icon for the confirmation.
 * @param {{_: Function}} i18n gettext.
 */
export function copyText(text, gicon, { _ }) {
    if (!text) return;

    const clipboard = St.Clipboard.get_default();
    clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
    clipboard.set_text(St.ClipboardType.PRIMARY, text);

    showOsd(gicon, _('Copied %s').replace('%s', text));
}

/**
 * A row that says something and cannot be activated.
 *
 * @param {object} menu The menu to add it to.
 * @param {string} text What it says.
 */
export function addDisabledRow(menu, text) {
    const item = new PopupMenu.PopupMenuItem(text);
    item.setSensitive(false);
    menu.addMenuItem(item);
}

/**
 * Flash a message on the primary monitor.
 *
 * GNOME 49 changed OsdWindowManager: show() now takes (icon, label, levels)
 * and showOne() is the call js/ui/windowManager.js itself uses for a text OSD.
 * The signature has moved before, which is why this lives in one function:
 * the next time it moves there is a single call to fix.
 *
 * @param {object} gicon Icon to show beside the message.
 * @param {string} message What to say.
 */
export function showOsd(gicon, message) {
    Main.osdWindowManager.showOne(Main.layoutManager.primaryIndex, gicon, message);
}

/**
 * One health warning.
 *
 * The text wraps rather than ellipsizing. These messages are whole sentences
 * and the menu is barely wider than one line of them, so a single line with a
 * trailing ellipsis shows the reader the least useful half of the warning.
 *
 * A message that carries a link becomes activatable and the link is taken out
 * of the text, which is both the longest part of the message and the part
 * least worth reading in a menu.
 *
 * @param {string} line One line from the daemon's health list.
 * @returns {object} A menu item.
 */
export function warningRow(line) {
    const { text, url } = describeWarning(line);
    const item = new PopupMenu.PopupImageMenuItem(
        text,
        url ? 'web-browser-symbolic' : 'dialog-warning-symbolic',
    );

    item.label.x_expand = true;
    item.label.clutter_text.line_wrap = true;
    item.label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    item.label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

    if (!url) {
        item.setSensitive(false);
        return item;
    }

    item.connectObject('activate', () => openUri(url), item);

    return item;
}

/**
 * Hand a URI to whichever application claims it, the way the Shell does.
 *
 * With a launch context, as js/ui/messageList.js opens a link, so the browser
 * gets startup notification and lands on the current workspace. And caught:
 * GIO throws when nothing handles the scheme, and the login URL is opened from
 * inside sync(), where an exception would abandon the rest of the menu.
 *
 * @param {string} uri An http or https URI, already checked by the caller.
 */
export function openUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(
            uri,
            global.create_app_launch_context(0, -1),
        );
    } catch (error) {
        console.warn(`[quickts] could not open a browser: ${error.message ?? error}`);
    }
}
