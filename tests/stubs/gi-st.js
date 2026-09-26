// St, as far as the extension uses it.

import { FakeActor } from '../support/actors.js';

/** What was put on the clipboard, by clipboard type. */
export const clipboard = { CLIPBOARD: null, PRIMARY: null };

/** The scale factor the theme context reports. A test may change it. */
export const themeContext = { scale_factor: 1 };

/** Reset between tests. */
export function resetSt() {
    clipboard.CLIPBOARD = null;
    clipboard.PRIMARY = null;
    themeContext.scale_factor = 1;
}

class Widget extends FakeActor {}
class BoxLayout extends Widget {}
class Icon extends Widget {}

/** A label with the clutter_text the real St.Label exposes. */
class Label extends Widget {
    _init(props = {}) {
        super._init({ text: '', ...props });
        this.clutter_text = { ellipsize: null, use_markup: false };
    }
}

class Button extends Widget {
    _init(props = {}) {
        super._init(props);
        if (props.child) this.add_child(props.child);
    }

    /** Fire the button as a click would, unless it is insensitive. */
    click() {
        if (this.reactive) this.emit('clicked', 0);
    }
}

/** An entry whose clutter_text is an actor, so key and text signals work. */
class Entry extends Widget {
    _init(props = {}) {
        super._init(props);
        this.clutter_text = new FakeActor({ text: '' });
    }

    get_text() {
        return this.clutter_text.text;
    }

    /** Type into the entry, as a person would. */
    set_text(text) {
        this.clutter_text.text = text;
        this.clutter_text.emit('text-changed');
    }

    /** Press one key, as Clutter would deliver it to the entry's text. */
    press(symbol) {
        this.clutter_text.emit('key-press-event', { get_key_symbol: () => symbol });
    }
}

class ScrollView extends Widget {
    _init(props = {}) {
        super._init(props);
        if (props.child) this.add_child(props.child);
    }
}

export default {
    Widget,
    BoxLayout,
    Icon,
    Label,
    Button,
    Entry,
    ScrollView,

    ClipboardType: { CLIPBOARD: 'CLIPBOARD', PRIMARY: 'PRIMARY' },

    Clipboard: {
        get_default: () => ({
            set_text(type, text) {
                clipboard[type === 'PRIMARY' ? 'PRIMARY' : 'CLIPBOARD'] = text;
            },
        }),
    },

    ThemeContext: {
        get_for_stage: () => themeContext,
    },

    // St's own values: ALWAYS, AUTOMATIC, NEVER, EXTERNAL.
    PolicyType: { ALWAYS: 0, AUTOMATIC: 1, NEVER: 2, EXTERNAL: 3 },
    DirectionType: { TAB_FORWARD: 0, TAB_BACKWARD: 1 },
    Align: { START: 0, MIDDLE: 1, END: 2 },
    Side: { TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3 },
};
