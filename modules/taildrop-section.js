// Taildrop's two halves: the "Send files" submenu, and the files other
// people have sent here waiting to be saved.
//
// Split out of modules/panel.js. Plain classes rather than GObjects: each
// builds its submenu into the toggle's menu and the toggle drives it. They
// share a file because they share Taildrop's wording and its OSD.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { formatSize } from './inbox.js';
import { hasEligibleTarget, isListedTarget, sendTargets } from './taildrop.js';
import { ActionMenuItem, showOsd } from './menu-items.js';

/** The "Send files" submenu, and every send, whichever row started it. */
export class SendSection {
    /**
     * @param {object} parentMenu The toggle's menu, to add the submenu to.
     * @param {object} deps What the section needs from the toggle.
     * @param {object} deps.model The store.
     * @param {{_: Function, _n: Function}} deps.i18n gettext and ngettext.
     * @param {object} deps.gicon Icon for the sent confirmation.
     * @param {Function} deps.chooseFiles Opens the portal's file chooser.
     */
    constructor(parentMenu, { model, i18n, gicon, chooseFiles }) {
        const { _ } = i18n;

        this._model = model;
        this._i18n = i18n;
        this._gicon = gicon;
        this._chooseFiles = chooseFiles;

        // Bumped whenever the list is asked for, and on destroy; see the note
        // on generations in modules/panel.js.
        this._generation = 0;

        this.item = new PopupMenu.PopupSubMenuMenuItem(_('Send files'), true);
        this.item.visible = false;
        parentMenu.addMenuItem(this.item);
    }

    /** Invalidate a listing still in flight. */
    destroy() {
        this._generation += 1;
    }

    /**
     * Rebuild the Taildrop list.
     *
     * The eligible targets come from the daemon rather than from the peer
     * list, so this needs a request; it is issued when the menu opens
     * rather than on every state change, because nobody can act on a list
     * they cannot see and asking on each netmap update would be a request
     * per peer that blinks.
     *
     * @param {object} _state A snapshot. Unused: the targets are matched
     *   against the model's own nodes once the request returns.
     * @returns {Promise<void>} Done.
     */
    async menuOpened(_state) {
        const { _ } = this._i18n;

        const generation = ++this._generation;
        const targets = sendTargets(
            this._model.state.nodes,
            await this._model.fileTargets(),
        );

        // A later listing, or a disable, has overtaken this one while the
        // request was in flight.
        if (generation !== this._generation) return;

        this.item.menu.removeAll();
        this.item.visible = hasEligibleTarget(targets);
        if (!this.item.visible) return;

        for (const { node, eligible, reason } of targets) {
            const item = new PopupMenu.PopupImageMenuItem(
                eligible ? node.name : `${node.name} — ${_(reason)}`,
                node.icon,
            );

            if (!eligible) {
                item.setSensitive(false);
            } else {
                item.connectObject('activate', () => void this.send(node), this);
            }

            this.item.menu.addMenuItem(item);
        }
    }

    /**
     * Choose files and send them.
     *
     * @param {object} node The node to send to.
     * @returns {Promise<void>} Done.
     */
    async send(node) {
        const { _, _n } = this._i18n;

        // Only to a peer the daemon itself names as a target, whichever
        // row started this. A peer's own TaildropTarget can say available
        // while the daemon, which decides, does not list it — and asking
        // first means nobody picks files for a send that cannot happen.
        if (!isListedTarget(await this._model.fileTargets(), node.id)) {
            Main.notify(
                _('Cannot send to %s').replace('%s', node.name),
                _('Tailscale does not list it as able to receive files right now.'),
            );
            return;
        }

        let uris;
        try {
            uris = await this._chooseFiles({
                title: _('Send to %s').replace('%s', node.name),
            });
        } catch (error) {
            // The portal rejects when xdg-desktop-portal is not installed
            // or not running. Unhandled, this was an unhandled rejection
            // and a click that did nothing and said nothing.
            console.warn(`[quickts] could not open a file chooser: ${error}`);
            Main.notifyError(
                _('Could not open a file chooser'),
                _('The desktop portal is not available.'),
            );
            return;
        }

        if (!uris || uris.length === 0) return;

        const { sent, failed } = await this._model.sendFiles(node.id, uris);

        if (sent > 0)
            showOsd(
                this._gicon,
                _n('Sent %d file to %s', 'Sent %d files to %s', sent)
                    .replace('%d', String(sent))
                    .replace('%s', node.name),
            );

        // Main.notify, not Main.notifyError: notifyError also copies its
        // text to the journal, and a node name and file names are
        // exactly what SECURITY.md promises stay out of it.
        if (failed.length > 0)
            Main.notify(
                _('Could not send to %s').replace('%s', node.name),
                failed.join(', '),
            );
    }
}

/**
 * Taildrop's other half. The daemon holds an incoming file until something
 * asks for it, so without this the extension can send files and is blind to
 * the ones arriving.
 */
export class InboxSection {
    /**
     * @param {object} parentMenu The toggle's menu, to add the submenu to.
     * @param {object} deps What the section needs from the toggle.
     * @param {object} deps.model The store.
     * @param {{_: Function, _n: Function}} deps.i18n gettext and ngettext.
     * @param {object} deps.gicon Icon for the saved confirmation.
     */
    constructor(parentMenu, { model, i18n, gicon }) {
        const { _ } = i18n;

        this._model = model;
        this._i18n = i18n;
        this._gicon = gicon;

        // Bumped whenever the list is asked for, and on destroy; see the note
        // on generations in modules/panel.js.
        this._generation = 0;

        this.item = new PopupMenu.PopupSubMenuMenuItem(_('Received files'), true);
        this.item.icon.icon_name = 'document-save-symbolic';
        this.item.visible = false;
        parentMenu.addMenuItem(this.item);
    }

    /** Invalidate a listing or a save still in flight. */
    destroy() {
        this._generation += 1;
    }

    /**
     * List the files waiting to be saved.
     *
     * Fetched when the menu opens rather than on every state change: the
     * daemon holds them either way, and a request per netmap blink would
     * be noise.
     *
     * @param {object} _state A snapshot. Unused: the daemon is asked.
     * @returns {Promise<void>} Done.
     */
    async menuOpened(_state) {
        const { _n } = this._i18n;

        const generation = ++this._generation;
        const files = await this._model.waitingFiles();
        if (generation !== this._generation) return;

        this.item.menu.removeAll();
        this.item.visible = files.length > 0;
        if (!this.item.visible) return;

        this.item.label.text = _n(
            '%d received file',
            '%d received files',
            files.length,
        ).replace('%d', String(files.length));

        for (const file of files)
            this.item.menu.addMenuItem(
                new ActionMenuItem(
                    `${file.name}  ·  ${formatSize(file.size)}`,
                    'document-save-symbolic',
                    row => void this._saveFile(file, row),
                ),
            );
    }

    /**
     * Save one waiting file, reporting on its own row.
     *
     * Stays open, like Ping: the answer is a path, and a path is worth
     * reading rather than flashing past in an OSD.
     *
     * @param {object} file A waiting file.
     * @param {object} row The row that was activated.
     * @returns {Promise<void>} Done.
     */
    async _saveFile(file, row) {
        const { _ } = this._i18n;

        const generation = this._generation;
        row.label.text = _('Saving %s…').replace('%s', file.name);
        row.setSensitive(false);

        const { path, error } = await this._model.saveFile(file.name);
        if (generation !== this._generation) return;

        if (error) {
            row.setSensitive(true);
            row.label.text = _(error);
            return;
        }

        row.label.text = _('Saved to %s').replace('%s', path);
        showOsd(this._gicon, _('Saved %s').replace('%s', file.name));
    }
}
