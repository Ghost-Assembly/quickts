// What every panel and section test shares: a panel over a fake daemon, the
// handles a test pokes it through, and the stub resets around each test.

import { afterEach, beforeEach, vi } from 'vitest';

import { Panel } from '../../modules/panel.js';
import { TailscaleModel } from '../../modules/model.js';
import { resetSt } from '../stubs/gi-st.js';
import { resetGio } from '../stubs/gi-gio.js';
import * as Main from '../stubs/shell-main.js';
import { descendants, resetActors } from './actors.js';
import { createClock, createDaemon, createScheduler } from './daemon.js';
import { createSettings } from './world.js';

/** Build a panel over a fake daemon, ready to enable. */
export function setup({ seed, settings = createSettings(), chooseFiles } = {}) {
    const daemon = createDaemon(seed);
    const clock = createClock();
    const { scheduler } = createScheduler(daemon.token, clock);
    const model = new TailscaleModel({
        client: daemon.client,
        scheduler,
        token: daemon.token,
        now: clock.now,
    });
    const chosen = { calls: [], uris: [] };
    const panel = new Panel({
        model,
        settings,
        iconPath: '/nonexistent/quickts/icons/quickts-symbolic.svg',
        gettext: message => message,
        chooseFiles:
            chooseFiles ??
            (options => {
                chosen.calls.push(options);
                return Promise.resolve(chosen.uris);
            }),
    });

    return { daemon, model, panel, settings, clock, chosen };
}

/** The toggle a test wants to poke. */
export const toggleOf = () =>
    Main.externalIndicators.at(-1).indicator.quickSettingsItems.at(0);

/** Navigate into the first device and return the rows now showing. */
export const deviceActionRows = (name = 'laptop') => {
    const devices = Main.externalIndicators
        .at(-1)
        .indicator.quickSettingsItems.at(0)._devices;
    devices.menu.items.find(item => item.text === name)?.activate();

    return devices.menu.items;
};

/** The text of the rows that have any — separators do not. */
export const labelsOf = items =>
    items.map(item => item.text).filter(text => text !== undefined);

/**
 * Every menu item anywhere under the toggle, by its text.
 *
 * Filtered on having a label of its own, because a row and the St.Label
 * inside it both carry the text — counting both would double every match.
 */
export const rowsNamed = (toggle, text) =>
    descendants(toggle.menu).filter(
        item => item.label !== undefined && item.text === text,
    );

export const settle = async (turns = 12) => {
    for (let i = 0; i < turns; i += 1)
        await new Promise(resolve => setTimeout(resolve, 0));
};

/**
 * Mutter's laters, as far as modules/panel.js uses them. Nothing runs on its
 * own; a test fires them with runLaters(), as the next frame would.
 */
export const laters = new Map();
let nextLater = 1;
export const runLaters = () => {
    for (const [id, callback] of [...laters]) {
        laters.delete(id);
        callback();
    }
};

/**
 * Reset the Shell stubs around every test in the calling file, and stand in
 * for the Shell's `global`.
 */
export function useShellStubs() {
    beforeEach(() => {
        Main.reset();
        resetActors();
        resetSt();
        resetGio();
        laters.clear();
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        // The Shell's `global`, which Node spells globalThis. Only the two calls
        // modules/panel.js makes.
        globalThis.create_app_launch_context = (timestamp, workspace) => ({
            timestamp,
            workspace,
        });
        globalThis.compositor = {
            get_laters: () => ({
                add(_type, callback) {
                    const id = nextLater++;
                    laters.set(id, callback);
                    return id;
                },
                remove(id) {
                    laters.delete(id);
                },
            }),
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete globalThis.create_app_launch_context;
        delete globalThis.compositor;
    });
}
