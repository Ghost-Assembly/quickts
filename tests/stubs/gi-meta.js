// Meta, as far as modules/panel.js uses it.

export default {
    KeyBindingFlags: { NONE: 0, IGNORE_AUTOREPEAT: 2 },

    // NONE is what addKeybinding returns when a keybinding of the same NAME
    // is already registered (mutter src/core/prefs.c). Accelerator collisions
    // are not detected at all. Recording a key that was never registered
    // makes disable() call removeKeybinding on it and the Shell warns.
    KeyBindingAction: { NONE: 0 },

    LaterType: { BEFORE_REDRAW: 1, IDLE: 2 },
};
