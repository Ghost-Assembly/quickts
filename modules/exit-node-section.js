// The exit node submenu: None, the daemon's suggestion, the tailnet's own
// candidates and Mullvad's grouped by country, which drill down in place.
//
// Split out of modules/panel.js. A plain class rather than a GObject: it
// builds its submenu into the toggle's menu and the toggle drives it.

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { cityOf, groupByCountry, partitionMullvad } from './mullvad.js';
import { KEYS } from './settings.js';
import { ActionMenuItem, addRow } from './menu-items.js';
import { NavigableSection } from './navigable-section.js';

/** The exit node submenu. */
export class ExitNodeSection {
    /**
     * @param {object} parentMenu The toggle's menu, to add the submenu to.
     * @param {object} deps What the section needs from the toggle.
     * @param {object} deps.model The store.
     * @param {object} deps.settings This extension's GSettings.
     * @param {{_: Function, _n: Function}} deps.i18n gettext and ngettext.
     */
    constructor(parentMenu, { model, settings, i18n }) {
        const { _ } = i18n;

        this._model = model;
        this._settings = settings;
        this._i18n = i18n;

        // Bumped whenever a suggestion is asked for, and on destroy; see the
        // note on generations in modules/panel.js.
        this._generation = 0;

        // The daemon's exit node recommendation, once asked for.
        this._suggestion = null;

        // The snapshot _exitChoices last partitioned, and its result.
        this._exitChoicesFor = null;
        this._exitChoicesValue = null;

        this.item = new PopupMenu.PopupSubMenuMenuItem(_('Exit node'), true);
        parentMenu.addMenuItem(this.item);
        this._section = new NavigableSection(this.item, {
            title: state => exitNodeLabel(state, this._i18n),
            back: _('All exit nodes'),
            resolve: (code, state) =>
                this._exitChoices(state).groups.find(
                    group => group.country.code === code,
                ) ?? null,
            detailTitle: group => group.country.name,
            renderList: (menu, state, open) => this._renderExitNodes(menu, state, open),
            renderDetail: (menu, group) => {
                for (const node of group.nodes)
                    menu.addMenuItem(this._exitNodeItem(node, cityOf(node)));
            },
        });
    }

    /** @param {object} state A snapshot. */
    sync(state) {
        this._section.render(state);
    }

    /**
     * The menu opened: ask for the daemon's suggestion.
     *
     * @param {object} _state A snapshot. Unused: the suggestion reads the
     *   model's own state after the request, which is what it redraws with.
     * @returns {Promise<void>} Done.
     */
    menuOpened(_state) {
        return this._syncSuggestion();
    }

    /** @returns {boolean} Whether a country was drilled into. */
    reset() {
        return this._section.reset();
    }

    /** Invalidate a suggestion still in flight. */
    destroy() {
        this._generation += 1;
    }

    /**
     * The exit node list: None, the tailnet's own candidates, then one row
     * per Mullvad country.
     *
     * @param {object} menu The submenu to fill.
     * @param {object} state A snapshot.
     * @param {Function} open Drill into a country.
     */
    _renderExitNodes(menu, state, open) {
        const { _ } = this._i18n;

        const { regular, groups } = this._exitChoices(state);

        addRow(
            menu,
            _('None'),
            state.exitNodeId ? '' : 'object-select-symbolic',
            () => void this._model.setExitNode(''),
            this,
        );

        // The daemon's own recommendation, offered only while nothing is
        // chosen — once one is in use, a suggestion is just noise.
        if (this._suggestion && !state.exitNodeId) {
            addRow(
                menu,
                _('Suggested: %s').replace('%s', this._suggestion.name),
                'starred-symbolic',
                () => void this._model.setExitNode(this._suggestion.id),
                this,
            );
        }

        for (const node of regular)
            menu.addMenuItem(this._exitNodeItem(node, node.name));

        if (!this._settings.get_boolean(KEYS.SHOW_MULLVAD)) return;

        for (const group of groups) {
            const label = group.country.flag
                ? `${group.country.flag}  ${group.country.name}`
                : group.country.name;

            menu.addMenuItem(
                new ActionMenuItem(
                    label,
                    group.nodes.some(node => node.isExitNode)
                        ? 'object-select-symbolic'
                        : '',
                    () => open(group.country.code),
                ),
            );
        }
    }

    /**
     * The exit node list, split into the tailnet's own candidates and
     * Mullvad's grouped by country.
     *
     * Memoized on the snapshot itself. A snapshot is frozen and replaced
     * wholesale on every change, so identity is a sound cache key — and
     * one render asks for this up to three times (the list, the country
     * rows, and `resolve` when a country is drilled into). On a tailnet
     * with Mullvad that is several thousand nodes filtered, partitioned
     * and grouped once instead of three times.
     *
     * @param {object} state A snapshot.
     * @returns {{regular: object[], groups: Array<object>}} The choices.
     */
    _exitChoices(state) {
        if (this._exitChoicesFor !== state) {
            const { regular, mullvad } = partitionMullvad(
                state.nodes.filter(node => node.canBeExitNode),
            );

            this._exitChoicesFor = state;
            this._exitChoicesValue = { regular, groups: groupByCountry(mullvad) };
        }

        return this._exitChoicesValue;
    }

    /**
     * @param {object} node A normalized node.
     * @param {string} label What to call it.
     * @returns {object} A menu item.
     */
    _exitNodeItem(node, label) {
        const item = new PopupMenu.PopupImageMenuItem(
            label,
            node.isExitNode ? 'object-select-symbolic' : node.icon,
        );

        // Selecting the node in use clears it, so the same row both sets
        // and unsets without needing a separate "stop" control.
        item.connectObject(
            'activate',
            () => void this._model.setExitNode(node.isExitNode ? '' : node.id),
            this,
        );

        return item;
    }

    /**
     * Ask the daemon which exit node it would pick.
     *
     * Only meaningful while none is chosen, so it is skipped when one is.
     *
     * @returns {Promise<void>} Done.
     */
    async _syncSuggestion() {
        const generation = ++this._generation;

        if (this._model.state.exitNodeId) {
            this._suggestion = null;
            return;
        }

        const suggestion = await this._model.suggestedExitNode();
        if (generation !== this._generation) return;

        // Replaced even when empty. Keeping the previous answer when the
        // daemon has withdrawn it offers a node it no longer recommends.
        const had = this._suggestion !== null;
        this._suggestion = suggestion.id ? suggestion : null;
        if (had || this._suggestion) this.sync(this._model.state);
    }
}

/**
 * What to call the exit node section.
 *
 * An exit node chosen automatically has an id of the form "auto:any", which
 * names no peer, so there is a node in use and no name for it.
 *
 * @param {object} state A snapshot.
 * @param {{_: Function}} i18n gettext.
 * @returns {string} A label.
 */
function exitNodeLabel(state, { _ }) {
    if (state.exitNodeName) return _('Exit node: %s').replace('%s', state.exitNodeName);

    return state.exitNodeId ? _('Exit node: automatic') : _('Exit node');
}
