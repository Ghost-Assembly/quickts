// resource:///org/gnome/shell/ui/main.js, as far as the extension uses it.
//
// A module singleton, mirroring the real Main. reset() must be called from
// beforeEach or state leaks between tests.

import { FakeActor } from '../support/actors.js';

// ---- Keybindings --------------------------------------------------------

/**
 * Keybindings Mutter accepted, by name: {settings, flags, mode, handler}.
 * Also reachable as `wm.bindings`.
 */
export const registered = new Map();

/** Every addKeybinding call by name, accepted or not, in order. */
export const addCalls = [];

/** Every removeKeybinding call by name, in order. */
export const removeCalls = [];

/**
 * Names Mutter should refuse, standing in for a name another extension has
 * already registered. meta_prefs_add_keybinding refuses a NAME that is already
 * registered — by anything in the Shell — and never checks whether the
 * accelerator collides, so two names sharing an accelerator are both accepted.
 */
export const refuse = new Set();

/** As the real WindowManager: Mutter's answer, never an exception. */
export const wm = {
    bindings: registered,

    /**
     * @param {string} name Schema key naming the binding.
     * @param {object} settings Settings holding it.
     * @param {number} flags Meta.KeyBindingFlags.
     * @param {number} mode Shell.ActionMode.
     * @param {Function} handler Called when the shortcut fires.
     * @returns {number} A non-zero action, or 0 (Meta.KeyBindingAction.NONE)
     *   when Mutter refuses the name: listed in `refuse`, or already bound.
     */
    addKeybinding(name, settings, flags, mode, handler) {
        addCalls.push(name);
        if (refuse.has(name) || registered.has(name)) return 0;

        registered.set(name, { settings, flags, mode, handler });
        return addCalls.length;
    },

    /**
     * @param {string} name Schema key naming the binding.
     */
    removeKeybinding(name) {
        removeCalls.push(name);
        registered.delete(name);
    },
};

/**
 * Fire a registered keybinding, as a keypress would. Throws for a name that is
 * not registered, so a test cannot pass by pressing a shortcut nobody bound.
 *
 * @param {string} name Schema key naming the binding.
 */
export function press(name) {
    const binding = registered.get(name);
    if (!binding) throw new Error(`no keybinding registered for ${name}`);

    binding.handler();
}

// ---- Panel and Quick Settings ---------------------------------------------

/** Indicators handed to addExternalIndicator, as {indicator, colSpan}. */
export const externalIndicators = [];

/** Top bar items handed to addToStatusArea, by role. */
export const statusItems = new Map();

/** Menus handed to the panel's menu manager. */
export const managedMenus = [];

/** Times the Quick Settings menu was toggled. */
export const quickSettingsToggles = [];

/**
 * The Quick Settings area. A FakeActor rather than a plain object so that
 * addExternalIndicator's argument is parented the way the Shell parents it,
 * and destroy() reaches it.
 */
export const quickSettings = new FakeActor();
quickSettings.menu = new FakeActor();
quickSettings.addExternalIndicator = (indicator, colSpan = 1) => {
    externalIndicators.push({ indicator, colSpan });
};

function resetQuickSettings() {
    quickSettings.mapped = true;
    quickSettings.reactive = true;
    quickSettings.menu.isOpen = false;
}
resetQuickSettings();

export const panel = {
    statusArea: { quickSettings },

    // As the real Panel: one item per role, the role is freed when the item
    // is destroyed, and the item's menu — a dummy one too — goes to the menu
    // manager.
    addToStatusArea(role, indicator, position, box) {
        if (statusItems.has(role))
            throw new Error(
                `Extension point conflict: there is already a status indicator for role ${role}`,
            );
        statusItems.set(role, { indicator, position, box });
        indicator.connect('destroy', () => statusItems.delete(role));
        if (indicator.menu) panel.menuManager.addMenu(indicator.menu);
        return indicator;
    },

    menuManager: {
        addMenu(menu) {
            if (!managedMenus.includes(menu)) managedMenus.push(menu);
        },
        removeMenu(menu) {
            const index = managedMenus.indexOf(menu);
            if (index !== -1) managedMenus.splice(index, 1);
        },
    },

    toggleQuickSettings() {
        quickSettingsToggles.push(Date.now());
        quickSettings.menu.isOpen = !quickSettings.menu.isOpen;
    },
};

/** Actors added to the UI group. */
export const uiGroupChildren = [];

export const uiGroup = {
    add_child(actor) {
        uiGroupChildren.push(actor);
    },
};

// ---- Layout -------------------------------------------------------------

const defaultMonitors = () => [{ index: 0, x: 0, y: 0, width: 1920, height: 1080 }];

/** One 1920x1080 monitor with a 32px top bar. A test may replace `monitors`. */
export const layoutManager = {
    primaryIndex: 0,
    monitors: defaultMonitors(),
    getWorkAreaForMonitor: () => ({ x: 0, y: 32, width: 1920, height: 1048 }),
};

/** Windows passed to activateWindow, in order. */
export const activated = [];

/**
 * @param {object} window Window to focus.
 */
export function activateWindow(window) {
    activated.push(window);
}

// ---- Session mode ---------------------------------------------------------

/** The session mode. lock() flips it and emits 'updated' as the Shell does. */
export const sessionMode = new FakeActor();
sessionMode.isLocked = false;

/**
 * @param {boolean} locked Whether the screen is now locked.
 */
export function lock(locked) {
    sessionMode.isLocked = locked;
    sessionMode.emit('updated');
}

// ---- Messages -----------------------------------------------------------

/** OSD messages shown, in order. */
export const osdMessages = [];

/** Notifications raised, in order, as {kind, message, details}. */
export const notifications = [];

export const osdWindowManager = {
    showOne(monitorIndex, icon, label) {
        osdMessages.push({ monitorIndex, icon, label });
    },
};

/**
 * @param {string} message The notification's title.
 * @param {string} [details] Its body.
 */
export function notify(message, details) {
    notifications.push({ kind: 'notify', message, details });
}

// Logs as the real one does (js/ui/main.js: "Also print to stderr so it's
// logged somewhere"), so a test can see what reaches the journal.
export function notifyError(message, details) {
    if (details) console.warn(`error: ${message}: ${details}`);
    else console.warn(`error: ${message}`);

    notifications.push({ kind: 'error', message, details });
}

// ---- Reset ----------------------------------------------------------------

/** Clear all recorded state. Call from beforeEach. */
export function reset() {
    registered.clear();
    addCalls.length = 0;
    removeCalls.length = 0;
    refuse.clear();

    externalIndicators.length = 0;
    statusItems.clear();
    managedMenus.length = 0;
    quickSettingsToggles.length = 0;
    uiGroupChildren.length = 0;
    resetQuickSettings();

    layoutManager.primaryIndex = 0;
    layoutManager.monitors = defaultMonitors();
    activated.length = 0;

    sessionMode.isLocked = false;
    for (const id of [...sessionMode.handlers.keys()]) sessionMode.disconnect(id);

    osdMessages.length = 0;
    notifications.length = 0;
}
