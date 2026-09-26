// resource:///org/gnome/shell/ui/popupMenu.js, as far as the extension uses it.
//
// The menu classes keep real child bookkeeping, so the unit suite can count the
// rows the extension built and fire the ones it cares about, rather than
// asserting against a mock's call log.

import { FakeActor } from '../support/actors.js';

const Ornament = Object.freeze({ NONE: 0, DOT: 1, CHECK: 2, HIDDEN: 3, NO_DOT: 4 });

class PopupBaseMenuItem extends FakeActor {
    _init(props = {}) {
        super._init(props);
        this.sensitive = props.reactive !== false;
        this.label_actor = null;
        this.ornament = Ornament.NONE;
    }

    setOrnament(ornament) {
        this.ornament = ornament;
    }

    setSensitive(sensitive) {
        this.sensitive = sensitive;
    }

    /** Fire the item as a click would. */
    activate() {
        this.emit('activate', this);
    }
}

/** A label with the clutter_text the real St.Label exposes. */
function makeLabel(text) {
    const label = new FakeActor({ text });
    label.clutter_text = {
        line_wrap: false,
        line_wrap_mode: null,
        ellipsize: null,
        use_markup: false,
    };
    return label;
}

/**
 * An item with the St.Label the real classes expose as `this.label` and set
 * label_actor to.
 *
 * Shared rather than repeated per subclass: the real popupMenu.js gives every
 * labeled item the same handle, and a stub that built one of them differently —
 * a submenu label with no clutter_text, say — is a difference between rows
 * that exists only in the test suite.
 */
class LabeledMenuItem extends PopupBaseMenuItem {
    /**
     * @param {string} text Initial label text.
     */
    _initLabel(text) {
        this.label = makeLabel(text);
        this.label_actor = this.label;
        this.add_child(this.label);
    }

    get text() {
        return this.label.text;
    }

    set text(value) {
        this.label.text = value;
    }
}

class PopupMenuItem extends LabeledMenuItem {
    _init(text, props = {}) {
        super._init(props);
        this._initLabel(text);
    }
}

class PopupImageMenuItem extends LabeledMenuItem {
    _init(text, icon, props = {}) {
        super._init(props);
        this._initLabel(text);
        this.icon = icon;
    }

    setIcon(icon) {
        this.icon = icon;
    }
}

class PopupSwitchMenuItem extends LabeledMenuItem {
    _init(text, active, props = {}) {
        super._init(props);
        this._initLabel(text);
        this.state = Boolean(active);
    }

    setToggleState(state) {
        this.state = Boolean(state);
    }

    /** Fire the switch as a click would, flipping it first. */
    toggle() {
        this.state = !this.state;
        this.emit('toggled', this.state);
    }
}

/** As the real one: an optional label, shown as a section heading. */
class PopupSeparatorMenuItem extends PopupBaseMenuItem {
    _init(text = '') {
        super._init();
        this.text = text;
    }
}

/** The shared behavior of anything that holds menu items. */
class MenuBase extends FakeActor {
    _init(props = {}) {
        super._init(props);
        this.items = [];
        this.isOpen = false;
        this.actor = new FakeActor();
    }

    addMenuItem(item) {
        this.items.push(item);
        this.add_child(item);
        item._parentMenu = this;

        // The real PopupMenuBase connects to 'activate' with
        // ConnectFlags.AFTER and calls itemActivated(), which closes the top
        // menu. Every activation closes the whole menu unless the item
        // overrides activate() and declines to chain up. Modeling it here is
        // what lets a test notice a row that should have stayed open.
        item.connect('activate', () => this._getTopMenu().close());
    }

    /** The menu at the root of the chain, as the real _getTopMenu does. */
    _getTopMenu() {
        return this._ownerItem?._parentMenu?._getTopMenu() ?? this;
    }

    removeAll() {
        for (const item of this.items) item.destroy();
        this.items = [];
        this.remove_all_children();
    }

    isEmpty() {
        return this.items.length === 0;
    }

    open() {
        this.isOpen = true;
        this.emit('open-state-changed', true);
    }

    close() {
        this.isOpen = false;
        this.emit('open-state-changed', false);
    }

    toggle() {
        return this.isOpen ? this.close() : this.open();
    }

    destroy() {
        this.removeAll();
        super.destroy();
    }
}

class PopupMenuSection extends MenuBase {}

class PopupSubMenuMenuItem extends LabeledMenuItem {
    _init(text, wantIcon = false, props = {}) {
        super._init(props);

        // The real class exposes the St.Label as `this.label` and sets
        // label_actor to it (js/ui/popupMenu.js:1320). Extensions relabel a
        // submenu through it, so the stub offers the same handle rather than a
        // plain string.
        this._initLabel(text);

        if (wantIcon) {
            this.icon = new FakeActor();
            this.add_child(this.icon);
        }

        this.menu = new PopupMenuSection();
        this.menu._ownerItem = this;
        this.add_child(this.menu);
    }
}

/** A top-level menu, as a PanelMenu.Button or an extension builds one. */
class PopupMenu extends MenuBase {
    _init(sourceActor, arrowAlignment, arrowSide) {
        super._init();
        this.sourceActor = sourceActor;
        this.arrowAlignment = arrowAlignment;
        this.arrowSide = arrowSide;
    }
}

export {
    Ornament,
    PopupMenu,
    MenuBase,
    PopupBaseMenuItem,
    PopupImageMenuItem,
    PopupMenuItem,
    PopupMenuSection,
    PopupSeparatorMenuItem,
    PopupSubMenuMenuItem,
    PopupSwitchMenuItem,
};
