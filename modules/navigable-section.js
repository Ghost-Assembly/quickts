// A submenu that swaps between a list and one entry's detail.
//
// Split out of modules/panel.js: the exit node and device sections both use it.

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { ActionMenuItem } from './menu-items.js';

/**
 * A submenu that shows either a list or the detail of one entry in it.
 *
 * GNOME allows exactly one open submenu per top menu — PopupSubMenu's open
 * handler calls _getTopMenu()._setOpenedSubMenu(), which closes whichever was
 * already open — so "a list you can drill into" cannot be a nested submenu.
 * It has to be navigation inside one submenu, and both the device list and the
 * Mullvad country list are that same shape.
 *
 * Having the shape in one place is not only less code: it means the two cannot
 * drift into behaving differently, which they had already begun to do.
 */
export class NavigableSection {
    /**
     * @param {object} item The PopupSubMenuMenuItem to drive.
     * @param {object} options Behavior.
     * @param {() => string} options.title Label while showing the list.
     * @param {string} options.back Label of the row that returns to the list.
     * @param {(view: string, state: object) => object|null} options.resolve
     *   Find the entry a view names, or null if it has gone.
     * @param {(entry: object) => string} options.detailTitle Label while showing one entry.
     * @param {(menu: object, state: object, open: Function) => void} options.renderList
     *   Fill the menu with the list; call `open(view)` to drill in.
     * @param {(menu: object, entry: object, state: object) => void} options.renderDetail
     *   Fill the menu with one entry's actions.
     */
    constructor(item, options) {
        this._item = item;
        this._options = options;
        this._view = null;
    }

    /** Forget any drill-down, without redrawing. */
    reset() {
        const had = this._view !== null;
        this._view = null;
        return had;
    }

    /**
     * Drill into an entry, or back out with null.
     *
     * @param {string|null} view The entry to show.
     * @param {object} state A snapshot.
     */
    show(view, state) {
        this._view = view;
        this.render(state);

        // render() destroyed the row that was activated, and with it the
        // submenu's idea of what to keep open.
        this._item.menu.open(BoxPointer.PopupAnimation.NONE);
    }

    /**
     * Redraw from the current state.
     *
     * @param {object} state A snapshot.
     */
    render(state) {
        const { title, back, resolve, detailTitle, renderList, renderDetail } =
            this._options;

        this._item.menu.removeAll();

        // An entry that vanished while its detail was on screen takes the view
        // back to the list rather than leaving it on nothing.
        const entry = this._view === null ? null : resolve(this._view, state);
        if (this._view !== null && !entry) this._view = null;

        if (entry) {
            this._item.label.text = detailTitle(entry);
            this._item.menu.addMenuItem(
                new ActionMenuItem(back, 'go-previous-symbolic', () =>
                    this.show(null, state),
                ),
            );
            this._item.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            renderDetail(this._item.menu, entry, state);
            return;
        }

        this._item.label.text = title(state);
        renderList(this._item.menu, state, view => this.show(view, state));
    }
}
