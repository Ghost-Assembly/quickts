// The device submenu: every peer, and what can be done to one — ping it,
// copy its address or DNS name, send it files.
//
// Split out of modules/panel.js. A plain class rather than a GObject: it
// builds its submenu into the toggle's menu and the toggle drives it.

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { PING_ISSUE, ROUTE } from './ping.js';
import { KEYS } from './settings.js';
import { canReceive } from './taildrop.js';
import {
    ActionMenuItem,
    addDisabledRow,
    addRow,
    copyText,
    problemMessage,
} from './menu-items.js';
import { NavigableSection } from './navigable-section.js';

/** The device submenu. */
export class DeviceSection {
    /**
     * @param {object} parentMenu The toggle's menu, to add the submenu to.
     * @param {object} deps What the section needs from the toggle.
     * @param {object} deps.model The store.
     * @param {object} deps.settings This extension's GSettings.
     * @param {{_: Function, _n: Function}} deps.i18n gettext and ngettext.
     * @param {object} deps.gicon Icon for the copy confirmation.
     * @param {(node: object) => Promise<void>} deps.sendFiles Starts a send
     *   to a node, from its "Send files…" row.
     */
    constructor(parentMenu, { model, settings, i18n, gicon, sendFiles }) {
        const { _ } = i18n;

        this._model = model;
        this._settings = settings;
        this._i18n = i18n;
        this._gicon = gicon;
        this._sendFiles = sendFiles;

        // Bumped whenever the list is rebuilt, and on destroy; see the note
        // on generations in modules/panel.js.
        this._generation = 0;

        this.item = new PopupMenu.PopupSubMenuMenuItem(_('Devices'), true);
        parentMenu.addMenuItem(this.item);
        this._section = new NavigableSection(this.item, {
            title: () => _('Devices'),
            back: _('All devices'),
            resolve: (id, state) =>
                this._visibleNodes(state).find(node => node.id === id) ?? null,
            detailTitle: node => node.name,
            renderList: (menu, state, open) => this._renderDevices(menu, state, open),
            renderDetail: (menu, node, state) =>
                this._renderDeviceActions(menu, node, state),
        });
    }

    /** @param {object} state A snapshot. */
    sync(state) {
        this._generation += 1;
        this._section.render(state);
    }

    /** @returns {boolean} Whether a device was drilled into. */
    reset() {
        return this._section.reset();
    }

    /** Invalidate a ping still waiting for its answer. */
    destroy() {
        this._generation += 1;
    }

    /**
     * The device list.
     *
     * @param {object} menu The submenu to fill.
     * @param {object} state A snapshot.
     * @param {Function} open Drill into a device.
     */
    _renderDevices(menu, state, open) {
        const { _ } = this._i18n;

        const nodes = this._visibleNodes(state);

        if (nodes.length === 0) {
            addDisabledRow(menu, _('No devices'));
            return;
        }

        for (const node of nodes)
            menu.addMenuItem(
                new ActionMenuItem(node.name, node.icon, () => open(node.id)),
            );
    }

    /**
     * The devices the preferences say to list.
     *
     * @param {object} state A snapshot.
     * @returns {object[]} Nodes.
     */
    _visibleNodes(state) {
        const showOffline = this._settings.get_boolean(KEYS.SHOW_OFFLINE_NODES);

        return state.nodes.filter(node => showOffline || node.online);
    }

    /**
     * What can be done to one device.
     *
     * @param {object} menu The submenu to fill.
     * @param {object} node A normalized node.
     * @param {object} state A snapshot.
     */
    _renderDeviceActions(menu, node, state) {
        const { _ } = this._i18n;

        const address = node.ips.at(0) ?? '';
        const fqdn =
            node.name && state.magicDNSSuffix
                ? `${node.name}.${state.magicDNSSuffix}`
                : node.name;

        if (address === '') {
            addDisabledRow(menu, _('No address'));
            return;
        }

        // Stays open: the answer arrives on this row a moment later, and a
        // closing menu takes it off screen before it can be read.
        menu.addMenuItem(
            new ActionMenuItem(
                _('Ping'),
                'network-transmit-receive-symbolic',
                row => void this._pingDevice(node, row),
            ),
        );

        addRow(
            menu,
            _('Copy address'),
            'edit-copy-symbolic',
            () => copyText(address, this._gicon, this._i18n),
            this,
        );

        if (fqdn && fqdn !== node.name) {
            addRow(
                menu,
                _('Copy DNS name'),
                'edit-copy-symbolic',
                () => copyText(fqdn, this._gicon, this._i18n),
                this,
            );
        }

        if (canReceive(node)) {
            addRow(
                menu,
                _('Send files…'),
                'document-send-symbolic',
                () => void this._sendFiles(node),
                this,
            );
        }
    }

    /**
     * Ping a device and report the result on the row that asked.
     *
     * The answer replaces the row's own label rather than raising an OSD.
     * A latency is a thing to compare and re-read, and an OSD is gone in a
     * second and takes the menu's focus with it.
     *
     * @param {object} node A normalized node.
     * @param {object} row The menu item that was activated.
     * @returns {Promise<void>} Done.
     */
    async _pingDevice(node, row) {
        const { _ } = this._i18n;

        row.label.text = _('Pinging…');
        row.setSensitive(false);

        const generation = this._generation;
        const result = await this._model.ping(node.ips.at(0) ?? '');

        // The section may have been rebuilt, or the extension disabled,
        // while the daemon waited for the peer to answer — in which case
        // this row has been destroyed and writing to it is a GJS critical.
        if (generation !== this._generation) return;

        row.setSensitive(true);
        // Never _(''): gettext answers the empty string with the
        // catalog's header. Keyed off `issue`, from modules/ping.js, rather
        // than passing `error` itself to _(): only PING_ISSUE.TRANSPORT's and
        // PING_ISSUE.NO_REPLY's/NO_RESPONSE's are ever a literal in the
        // source — the daemon's own text (issue === '' while !ok) is data,
        // and must never reach gettext at all.
        if (result.ok) row.label.text = formatPing(result, this._i18n);
        else if (result.issue === PING_ISSUE.TRANSPORT)
            row.label.text = problemMessage(result.error, _);
        else if (result.issue === PING_ISSUE.NO_RESPONSE)
            row.label.text = _('No response');
        else if (result.issue === PING_ISSUE.NO_REPLY) row.label.text = _('No reply');
        else if (result.error) row.label.text = result.error;
        else row.label.text = _('No reply');
    }
}

/**
 * A ping result, as a row label.
 *
 * The route matters as much as the number on a tailnet: the same peer at the
 * same latency is a different situation depending on whether the packets went
 * straight there or through one of Tailscale's relays.
 *
 * Each case is one whole template, so a translator sees the sentence rather
 * than fragments glued together with a comma this code chose.
 *
 * @param {object} result From modules/ping.js.
 * @param {{_: Function}} i18n gettext.
 * @returns {string} A label.
 */
function formatPing(result, { _ }) {
    const latency = String(result.latencyMs);

    if (result.route === ROUTE.DIRECT) return _('%s ms, direct').replace('%s', latency);
    if (result.route === ROUTE.RELAY && result.relay)
        return _('%s ms, relayed via %s')
            .replace('%s', latency)
            .replace('%s', result.relay);
    if (result.route === ROUTE.RELAY) return _('%s ms, relayed').replace('%s', latency);

    return _('%s ms').replace('%s', latency);
}
