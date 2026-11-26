import { afterEach, describe, expect, it, vi } from 'vitest';

import { PopupAnimation } from './stubs/shell-boxpointer.js';

const CONFIG = 'resource:///org/gnome/shell/misc/config.js';

/** Load menu-animation.js as it would be on the given Shell version. */
async function onShell(version) {
    vi.resetModules();
    vi.doMock(CONFIG, () => ({ PACKAGE_VERSION: version }));
    return import('../modules/menu-animation.js');
}

afterEach(() => {
    vi.doUnmock(CONFIG);
    vi.resetModules();
});

describe('menu animation', () => {
    it('passes an options object from GNOME 51', async () => {
        const { ANIMATE, NO_ANIMATE } = await onShell('51.1');
        expect(ANIMATE).toEqual({ animate: true });
        expect(NO_ANIMATE).toEqual({ animate: false });
    });

    it('passes a PopupAnimation before GNOME 51', async () => {
        const { ANIMATE, NO_ANIMATE } = await onShell('50.2');
        expect(ANIMATE).toBe(PopupAnimation.FULL);
        expect(NO_ANIMATE).toBe(PopupAnimation.NONE);
    });
});
