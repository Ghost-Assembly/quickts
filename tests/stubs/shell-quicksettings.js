// resource:///org/gnome/shell/ui/quickSettings.js, as far as modules/panel.js uses it.

import { FakeActor } from '../support/actors.js';
import { MenuBase } from './shell-popupmenu.js';

/** The menu a QuickMenuToggle owns, with the header the real one provides. */
class QuickToggleMenu extends MenuBase {
    _init(props = {}) {
        super._init(props);
        // The root of the chain: _getTopMenu() stops here.
        this._ownerItem = null;
        this.header = { icon: null, title: '', subtitle: '' };
        this.headerSuffixes = [];
    }

    setHeader(icon, title, subtitle = '') {
        this.header = { icon, title, subtitle };
    }

    addHeaderSuffix(actor) {
        this.headerSuffixes.push(actor);
    }
}

class QuickMenuToggle extends FakeActor {
    _init(props = {}) {
        super._init(props);
        this.menu = new QuickToggleMenu();
        this.checked = Boolean(props.checked);
        // Deliberately NOT destroyed with the toggle. The real QuickSettingsItem
        // never destroys its menu — Shell 50.3's quickSettings.js has no
        // destroy call at all, and QuickSettingsMenu._completeAddItem parents
        // the menu's actor into its own overlay — so an extension that does
        // not destroy it leaks one menu per disable.
    }

    /**
     * Fire the toggle as a click would.
     *
     * St.Button flips `checked` itself before 'clicked' only in toggle mode,
     * which is what lets a tile's checked state drift from the daemon's when
     * nothing then re-syncs it.
     */
    click() {
        if (!this.reactive) return;
        if (this.toggleMode) this.checked = !this.checked;
        this.emit('clicked', this);
    }
}

class SystemIndicator extends FakeActor {
    _init(props = {}) {
        super._init(props);
        this.quickSettingsItems = [];
        this.indicators = [];
    }

    _addIndicator() {
        const icon = new FakeActor();
        this.indicators.push(icon);
        this.add_child(icon);
        return icon;
    }
}

export { QuickMenuToggle, QuickToggleMenu, SystemIndicator };
