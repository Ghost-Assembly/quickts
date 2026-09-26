import { describe, expect, it, vi } from 'vitest';

import { REASON } from '../modules/errors.js';
import { isOn } from '../modules/health.js';
import { Panel } from '../modules/panel.js';
import { KEYS, SHORTCUT_KEYS } from '../modules/settings.js';
import { BACKEND } from '../modules/state.js';
import { rawPeer, rawPeerMap, SUFFIX } from './fixtures/peers.js';
import { launchContexts, launchFailure, launchedUris } from './stubs/gi-gio.js';
import { clipboard, themeContext } from './stubs/gi-st.js';
import * as Main from './stubs/shell-main.js';
import { descendants, liveHandlers } from './support/actors.js';
import { createSettings } from './support/world.js';
import {
    deviceActionRows,
    labelsOf,
    laters,
    rowsNamed,
    runLaters,
    settle,
    setup,
    toggleOf,
    useShellStubs,
} from './support/panel.js';

useShellStubs();

describe('placement', () => {
    // The supported API, which puts the tile where the Shell wants it relative
    // to brightness and background apps. Upstream reaches into _indicators and
    // inserts at index 0, which is upstream issue #41.
    it('uses addExternalIndicator', () => {
        const { panel } = setup();
        panel.enable();

        expect(Main.externalIndicators).toHaveLength(1);
        expect(toggleOf()).toBeTruthy();
    });
});

describe('the tile', () => {
    it('is checked while the tailnet is up', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf().checked).toBe(true);
    });

    // WantRunning stays true across a logout, so a toggle driven by the
    // preference alone sits there showing "on" against a dead backend.
    it('is unchecked when the backend needs a login', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.BackendState = BACKEND.NEEDS_LOGIN;
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf().checked).toBe(false);
        expect(toggleOf().subtitle).toBe('Not logged in');
    });

    it('names the exit node in its subtitle', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.prefs.ExitNodeID = 'nSOMEID1CNTRL';
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf().subtitle).toBe('via laptop');
    });

    it('reports an unreachable daemon in its subtitle', async () => {
        const { panel, model, daemon } = setup();
        // Every request, not just one: a read that succeeded after it would
        // rightly clear the error.
        daemon.failures.set('/localapi/v0/', {
            name: 'TransportError',
            reason: REASON.PERMISSION_DENIED,
        });
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf().subtitle).toContain('tailscale set --operator=');
    });

    it('brings the tailnet down when clicked while up', async () => {
        const { panel, model, daemon } = setup();
        panel.enable();
        await model.start();
        await settle();

        toggleOf().click();
        await settle();

        expect(daemon.patches.at(-1)).toMatchObject({ WantRunning: false });
    });

    // St flips `checked` on click in toggle mode, before the daemon has said
    // anything. A PATCH that then fails with the error already on screen
    // changes no field, so nothing re-syncs and the tile shows a state the
    // daemon does not have.
    it('does not flip on a click the daemon refuses', async () => {
        const { panel, model, daemon } = setup();
        panel.enable();
        await model.start();
        await settle();
        daemon.failures.set('/localapi/v0/prefs', {
            name: 'TransportError',
            reason: REASON.HTTP,
        });

        toggleOf().click();
        await settle();
        const afterFirst = toggleOf().checked;
        toggleOf().click();
        await settle();

        // The second refusal changes nothing in the state, so only the click
        // itself could have moved the tile — and it must not have.
        expect(model.state.running).toBe(true);
        expect(toggleOf().checked).toBe(afterFirst);
        expect(toggleOf().checked).toBe(isOn(model.state));
    });

    // Waiting on the backend is not the same as off. A click has to be able
    // to stop a tailnet that is still coming up.
    it.each([BACKEND.STARTING, BACKEND.NEEDS_MACHINE_AUTH])(
        'turns off when clicked while %s',
        async backendState => {
            const { panel, model, daemon } = setup();
            daemon.responses.status.BackendState = backendState;
            panel.enable();
            await model.start();
            await settle();

            expect(toggleOf().checked).toBe(true);

            toggleOf().click();
            await settle();

            expect(daemon.patches.at(-1)).toMatchObject({ WantRunning: false });
        },
    );

    it('says it is waiting for approval rather than off', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.BackendState = BACKEND.NEEDS_MACHINE_AUTH;
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf().subtitle).toBe('Waiting for approval');
    });

    // Flipping WantRunning against a backend waiting for a login does nothing
    // a person would notice; starting the login is what they were asking for.
    it('starts a login when clicked while logged out', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.BackendState = BACKEND.NEEDS_LOGIN;
        panel.enable();
        await model.start();
        await settle();
        daemon.reset();

        toggleOf().click();
        await settle();

        expect(daemon.paths).toContain('/localapi/v0/login-interactive');
    });
});

describe('problems and warnings', () => {
    // Informational, so they collapse. The count sits on the disclosure and
    // the text inside it, rather than several permanent rows above the
    // controls the menu exists for.
    it('collapses health warnings into a disclosure', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.Health = ['Some peers are advertising routes'];
        panel.enable();
        await model.start();
        await settle();

        const warnings = toggleOf()._warnings;

        expect(warnings.visible).toBe(true);
        expect(warnings.label.text).toBe('1 warning');
        expect(warnings.menu.items.map(item => item.text)).toEqual([
            'Some peers are advertising routes',
        ]);
        expect(toggleOf()._problems.items).toHaveLength(0);
    });

    // Long messages are whole sentences in a menu barely wider than one line
    // of them, so an ellipsis shows the reader the least useful half.
    it('wraps a warning instead of ellipsizing it', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.Health = [
            'SELinux is enabled; Tailscale SSH may not work. See https://tailscale.com/s/ssh-selinux',
        ];
        panel.enable();
        await model.start();
        await settle();

        const row = toggleOf()._warnings.menu.items.at(0);

        expect(row.label.clutter_text.line_wrap).toBe(true);
        expect(row.label.clutter_text.ellipsize).toBe(0);
    });

    it('takes the link out of the text and opens it when activated', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.Health = [
            'SELinux is enabled; Tailscale SSH may not work. See https://tailscale.com/s/ssh-selinux',
        ];
        panel.enable();
        await model.start();
        await settle();

        const row = toggleOf()._warnings.menu.items.at(0);

        expect(row.text).toBe('SELinux is enabled; Tailscale SSH may not work.');
        expect(row.sensitive).toBe(true);

        row.activate();

        expect(launchedUris).toEqual(['https://tailscale.com/s/ssh-selinux']);
    });

    it('leaves a warning with no link inert', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.Health = [
            'Some peers are advertising routes but --accept-routes is false',
        ];
        panel.enable();
        await model.start();
        await settle();

        const row = toggleOf()._warnings.menu.items.at(0);

        expect(row.text).toBe(
            'Some peers are advertising routes but --accept-routes is false',
        );
        expect(row.sensitive).toBe(false);

        row.activate();

        expect(launchedUris).toEqual([]);
    });

    it('pluralizes the count', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.Health = ['one', 'two'];
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf()._warnings.label.text).toBe('2 warnings');
    });

    it('hides the disclosure when there is nothing wrong', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf()._warnings.visible).toBe(false);
    });

    // The list is capped, so without this the count on the label would
    // disagree with what is listed underneath it.
    it('accounts for warnings it did not list', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.Health = ['a', 'b', 'c', 'd', 'e'];
        panel.enable();
        await model.start();
        await settle();

        const warnings = toggleOf()._warnings;

        expect(warnings.label.text).toBe('5 warnings');
        expect(warnings.menu.items.at(-1).text).toBe('2 more');
    });

    it('leaves nothing behind when the warnings clear', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.Health = ['transient'];
        panel.enable();
        await model.start();
        await settle();

        daemon.responses.status.Health = [];
        await model.refresh();
        await settle();

        expect(toggleOf()._warnings.visible).toBe(false);
        expect(toggleOf()._warnings.menu.items).toEqual([]);
    });

    // Deliberately NOT collapsed: an actionable problem and a login are things
    // to do, and burying them is the opposite of what a disclosure is for.
    it('keeps actionable problems out of the disclosure', async () => {
        const { panel, model, daemon } = setup();
        // Every request, not just one: a read that succeeded after it would
        // rightly clear the error.
        daemon.failures.set('/localapi/v0/', {
            name: 'TransportError',
            reason: REASON.PERMISSION_DENIED,
        });
        daemon.responses.status.Health = ['a warning'];
        panel.enable();
        await model.start();
        await settle();

        expect(
            toggleOf()._problems.items.some(item =>
                item.text?.includes('tailscale set --operator='),
            ),
        ).toBe(true);
    });

    it('keeps the login row out of the disclosure', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.BackendState = BACKEND.NEEDS_LOGIN;
        daemon.responses.status.Health = ['a warning'];
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf()._problems.items.map(item => item.text)).toContain('Log in…');
    });

    it('offers a login row when the backend needs one', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.BackendState = BACKEND.NEEDS_LOGIN;
        panel.enable();
        await model.start();
        await settle();
        daemon.reset();

        rowsNamed(toggleOf(), 'Log in…').at(0).activate();
        await settle();

        expect(daemon.paths).toContain('/localapi/v0/login-interactive');
    });

    // The fix a person cannot otherwise discover: upstream logs the 403 to the
    // journal and draws an empty menu.
    it('copies the operator command from an actionable problem', async () => {
        const { panel, model, daemon } = setup();
        // Every request, not just one: a read that succeeded after it would
        // rightly clear the error.
        daemon.failures.set('/localapi/v0/', {
            name: 'TransportError',
            reason: REASON.PERMISSION_DENIED,
        });
        panel.enable();
        await model.start();
        await settle();

        const row = descendants(toggleOf().menu).find(item =>
            item.text?.includes('tailscale set --operator='),
        );
        row.activate();

        expect(clipboard.CLIPBOARD).toBe('sudo tailscale set --operator=$USER');
    });
});

describe('the settings switches', () => {
    it('reflect the preferences', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.prefs.ShieldsUp = true;
        panel.enable();
        await model.start();
        await settle();

        const shields = rowsNamed(toggleOf(), 'Block incoming').at(0);

        expect(shields.state).toBe(true);
    });

    it('apply a change', async () => {
        const { panel, model, daemon } = setup();
        panel.enable();
        await model.start();
        await settle();

        rowsNamed(toggleOf(), 'Accept routes').at(0).toggle();
        await settle();

        expect(daemon.patches.at(-1)).toMatchObject({ RouteAll: true });
    });

    // Built once rather than rebuilt, so toggling one does not destroy the
    // actor the click is still traveling through.
    it('survive being toggled and re-synced', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        const before = rowsNamed(toggleOf(), 'Accept routes').at(0);
        before.toggle();
        await settle();

        expect(rowsNamed(toggleOf(), 'Accept routes').at(0)).toBe(before);
        expect(before._wasDestroyed).toBe(false);
    });
});

describe('running as an exit node', () => {
    it('reflects both default routes being advertised', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.prefs.AdvertiseRoutes = ['0.0.0.0/0', '::/0'];
        panel.enable();
        await model.start();
        await settle();

        expect(rowsNamed(toggleOf(), 'Run as exit node').at(0).state).toBe(true);
    });

    it('is off when only one default route is advertised', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.prefs.AdvertiseRoutes = ['0.0.0.0/0'];
        panel.enable();
        await model.start();
        await settle();

        expect(rowsNamed(toggleOf(), 'Run as exit node').at(0).state).toBe(false);
    });

    it('advertises both default routes when turned on', async () => {
        const { panel, model, daemon } = setup();
        panel.enable();
        await model.start();
        await settle();

        rowsNamed(toggleOf(), 'Run as exit node').at(0).activate();
        await settle();

        expect(daemon.patches.at(-1).AdvertiseRoutes.sort()).toEqual([
            '0.0.0.0/0',
            '::/0',
        ]);
    });

    // Turning it off must not silently withdraw a subnet this machine routes.
    it('keeps the subnet routes when turned off', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.prefs.AdvertiseRoutes = [
            '0.0.0.0/0',
            '::/0',
            '192.168.1.0/24',
        ];
        panel.enable();
        await model.start();
        await settle();

        rowsNamed(toggleOf(), 'Run as exit node').at(0).activate();
        await settle();

        expect(daemon.patches.at(-1).AdvertiseRoutes).toEqual(['192.168.1.0/24']);
    });
});

describe('profiles', () => {
    it('are hidden when there is only one', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf()._profiles.visible).toBe(false);
    });

    it('are listed when there is more than one', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.profiles = [
            { ID: '1', Name: 'work', NetworkProfile: { DisplayName: 'WorkNet' } },
            { ID: '2', Name: 'home', NetworkProfile: { DomainName: 'home.example' } },
        ];
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf()._profiles.visible).toBe(true);
        expect(toggleOf()._profiles.menu.items.map(item => item.text)).toEqual([
            'work',
            'home',
        ]);
    });

    it('switch when activated', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.profiles = [
            { ID: '1', Name: 'work' },
            { ID: '2', Name: 'home' },
        ];
        panel.enable();
        await model.start();
        await settle();
        daemon.reset();

        toggleOf()._profiles.menu.items.at(1).activate();
        await settle();

        expect(daemon.paths).toContain('/localapi/v0/profiles/2');
    });
});

describe('menu height', () => {
    // The mechanism the Shell already has: PopupSubMenu._needsScrollbar reads
    // max-height off the top menu's theme node. Upstream hardcodes a height
    // and overwrites _needsScrollbar instead, which is upstream issue #11.
    it('sets a max-height the theme node reports back', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        toggleOf().menu.open();

        expect(toggleOf().menu.actor.get_theme_node().get_max_height()).toBeGreaterThan(
            0,
        );
    });

    it('accounts for the scale factor', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        toggleOf().menu.open();
        const atOne = toggleOf().menu.actor.get_theme_node().get_max_height();

        themeContext.scale_factor = 2;
        toggleOf().menu.close();
        toggleOf().menu.open();

        expect(toggleOf().menu.actor.get_theme_node().get_max_height()).toBeLessThan(
            atOne,
        );
    });

    it('honors the configured ceiling', async () => {
        const settings = createSettings({ [KEYS.MAX_MENU_HEIGHT]: 300 });
        const { panel, model } = setup({ settings });
        panel.enable();
        await model.start();
        await settle();

        toggleOf().menu.open();

        expect(toggleOf().menu.actor.get_theme_node().get_max_height()).toBe(300);
    });

    it('tells the model when the menu opens and closes', async () => {
        const { panel, model } = setup();
        const setMenuOpen = vi.spyOn(model, 'setMenuOpen');
        panel.enable();
        await model.start();
        await settle();

        toggleOf().menu.open();
        toggleOf().menu.close();

        expect(setMenuOpen).toHaveBeenCalledWith(true);
        expect(setMenuOpen).toHaveBeenCalledWith(false);
    });

    // _onOpenStateChanged always cancels a pending remeasure before starting
    // another, so this can only happen if _remeasureOnceLaidOut is ever asked
    // for twice without that — the next call site to forget it, or two opens
    // racing each other before _cancelRemeasure runs between them. The bug:
    // the allocation handler read `this._allocationId` at fire time rather
    // than the id it was actually given, so a second request overwrote the
    // field before the first fired, and the first's own disconnect call then
    // disconnected the SECOND handler instead of itself — leaving the first
    // connected to 'notify::allocation' forever.
    it('does not leak a handler when a remeasure is requested twice before it fires', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        const before = liveHandlers.size;

        toggleOf()._remeasureOnceLaidOut();
        toggleOf()._remeasureOnceLaidOut();
        toggleOf().menu.actor.emit('notify::allocation');
        runLaters();

        expect(liveHandlers.size).toBe(before);
    });
});

describe('the keybinding', () => {
    it('is registered once per enable', () => {
        const { panel } = setup();
        panel.enable();

        expect(Main.addCalls).toEqual([SHORTCUT_KEYS.OPEN_MENU]);
    });

    it('opens the menu', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        Main.press(SHORTCUT_KEYS.OPEN_MENU);

        expect(Main.quickSettingsToggles).toHaveLength(1);
        expect(toggleOf().menu.isOpen).toBe(true);
    });

    // Opening quick settings and reading where the tile's menu sits in the
    // same breath reads a position the Shell has not laid out yet. The height
    // is measured again once the menu has been allocated.
    it('measures the height again once the menu has been laid out', async () => {
        const settings = createSettings();
        const { panel, model } = setup({ settings });
        panel.enable();
        await model.start();
        await settle();

        Main.press(SHORTCUT_KEYS.OPEN_MENU);
        const before = toggleOf().menu.actor.get_theme_node().get_max_height();

        // Laid out lower down than it was when first read.
        toggleOf().menu.actor.transformedTop = 600;
        toggleOf().menu.actor.emit('notify::allocation');
        runLaters();

        expect(toggleOf().menu.actor.get_theme_node().get_max_height()).toBeLessThan(
            before,
        );
    });

    // The same guard js/ui/panel.js applies: the tile is not there to open
    // during the lock screen or the greeter.
    it('does nothing while the panel is not interactive', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();
        Main.panel.statusArea.quickSettings.reactive = false;

        Main.press(SHORTCUT_KEYS.OPEN_MENU);

        expect(Main.quickSettingsToggles).toHaveLength(0);
    });

    // Mutter returns NONE when a keybinding of the same name is already
    // registered — not for an accelerator clash, which it never checks. Recording
    // a key that was never registered makes disable() remove it and the Shell
    // warns.
    it('is not recorded when Mutter refuses it', () => {
        const { panel } = setup();
        Main.refuse.add(SHORTCUT_KEYS.OPEN_MENU);

        panel.enable();
        panel.disable();

        expect(Main.removeCalls).toEqual([]);
    });
});

// Every activation closes the top menu unless the row declines to chain up.
// Which rows do which is a design decision, so it is pinned here rather than
// left to whichever item class happened to be used.
describe('async handlers outliving their rows', () => {
    // The guard here used to read `row.destroyed`, which no ClutterActor has:
    // it was always undefined, so the write went ahead into a disposed actor
    // and produced GJS criticals. Only the stub made it look fine.
    it('does not write a ping result into a rebuilt row', async () => {
        const { panel, model, daemon } = setup();
        panel.enable();
        await model.start();
        await settle();

        let release;
        const held = new Promise(resolve => {
            release = resolve;
        });
        const realRequest = daemon.client.request;
        daemon.client.request = async descriptor => {
            if (descriptor.path.startsWith('/localapi/v0/ping')) {
                await held;
                return { Err: '', LatencySeconds: 0.001, Endpoint: 'x:1' };
            }
            return realRequest(descriptor);
        };

        const row = deviceActionRows().find(item => item.text === 'Ping');
        row.activate();
        await settle();

        // A netmap update rebuilds the section and destroys that row.
        daemon.responses.status.Peer = rawPeerMap(rawPeer(), rawPeer({ ID: 'nNEW' }));
        await model.refresh({ peers: true });
        await settle();

        expect(row._wasDestroyed).toBe(true);

        release();
        await settle();

        // The stale row keeps whatever it said; nothing wrote into it.
        expect(row.text).toBe('Pinging…');
    });

    it('does not rebuild the Taildrop list after the panel is gone', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.fileTargets = [{ Node: { StableID: 'nSOMEID1CNTRL' } }];
        panel.enable();
        await model.start();
        await settle();

        const taildrop = toggleOf()._taildrop;
        toggleOf().menu.open();
        panel.disable();

        await expect(settle()).resolves.toBeUndefined();
        expect(taildrop._wasDestroyed).toBe(true);
    });
});

describe('one section rebuilding under another', () => {
    /**
     * Hold every request whose path starts with `prefix` until released.
     *
     * @returns {() => void} Releases them.
     */
    const hold = (daemon, prefix) => {
        let release;
        const held = new Promise(resolve => {
            release = resolve;
        });
        const realRequest = daemon.client.request;
        daemon.client.request = async descriptor => {
            if (descriptor.path.startsWith(prefix)) {
                const answer = await realRequest(descriptor);
                await held;
                return answer;
            }
            return realRequest(descriptor);
        };
        return () => release();
    };

    const rebuildDevices = async (daemon, model) => {
        daemon.responses.status.Peer = rawPeerMap(
            rawPeer({ TaildropTarget: 1 }),
            rawPeer({ ID: 'nNEW', DNSName: `newcomer.${SUFFIX}.` }),
        );
        await model.refresh({ peers: true });
        await settle();
    };

    // One counter shared by every section meant a netmap blink threw away a
    // Taildrop listing that had nothing to do with it.
    it('keeps a Taildrop listing when the devices rebuild', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.Peer = rawPeerMap(rawPeer({ TaildropTarget: 1 }));
        daemon.responses.fileTargets = [{ Node: { StableID: 'nSOMEID1CNTRL' } }];
        panel.enable();
        await model.start();
        await settle();

        const release = hold(daemon, '/localapi/v0/file-targets');
        toggleOf().menu.open();
        await settle();
        await rebuildDevices(daemon, model);
        release();
        await settle();

        expect(toggleOf()._taildrop.visible).toBe(true);
    });

    it('keeps the suggestion when the devices rebuild', async () => {
        const { panel, model, daemon } = setup();
        panel.enable();
        await model.start();
        await settle();

        const release = hold(daemon, '/localapi/v0/suggest-exit-node');
        toggleOf().menu.open();
        await settle();
        await rebuildDevices(daemon, model);
        release();
        await settle();

        expect(labelsOf(toggleOf()._exitNode.menu.items)).toContain(
            'Suggested: gateway',
        );
    });

    // The save finished; a row left saying "Saving…" forever says otherwise.
    it('finishes a save when the devices rebuild during it', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.files = [{ Name: 'report.pdf', Size: 2048 }];
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        let release;
        const held = new Promise(resolve => {
            release = resolve;
        });
        const realSave = daemon.client.saveFile;
        daemon.client.saveFile = async (...args) => {
            await held;
            return realSave(...args);
        };

        const row = toggleOf()._inbox.menu.items.at(0);
        row.activate();
        await settle();
        await rebuildDevices(daemon, model);
        release();
        await settle();

        expect(row.text).toContain('Saved to');
    });
});

describe('more races against a disable', () => {
    it('does not rebuild the inbox after the panel is gone', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.files = [{ Name: 'a.txt', Size: 4 }];
        panel.enable();
        await model.start();
        await settle();

        const inbox = toggleOf()._inbox;
        toggleOf().menu.open();
        panel.disable();
        await settle();

        expect(inbox._wasDestroyed).toBe(true);
    });

    // copyText guards an empty string so an OSD can never claim to have copied
    // nothing. A peer with no name and no suffix produces exactly that.
    it('copies nothing, and says nothing, for a nameless device', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.MagicDNSSuffix = '';
        daemon.responses.status.Peer = rawPeerMap(
            rawPeer({
                DNSName: '',
                HostName: '',
                ID: 'nX',
                TailscaleIPs: ['100.64.0.5'],
            }),
        );
        panel.enable();
        await model.start();
        await settle();

        const rows = deviceActionRows('nX');
        const copyName = rows.find(item => item.text === 'Copy DNS name');

        // With no name there is no DNS name row at all, and the address row
        // still works.
        expect(copyName).toBeUndefined();

        rows.find(item => item.text === 'Copy address').activate();

        expect(clipboard.CLIPBOARD).toBe('100.64.0.5');
    });
});

describe('what closes the menu', () => {
    const openMenu = () => {
        toggleOf().menu.open();
        return toggleOf().menu;
    };

    it('stays open while navigating into a device', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();
        const menu = openMenu();

        toggleOf()._devices.menu.items.at(0).activate();

        expect(menu.isOpen).toBe(true);
    });

    // The result lands on this row a moment later; a closing menu takes it off
    // screen before it can be read.
    it('stays open while pinging', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();
        const menu = openMenu();

        deviceActionRows()
            .find(item => item.text === 'Ping')
            .activate();
        await settle();

        expect(menu.isOpen).toBe(true);
    });

    it('stays open while going back to the device list', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();
        const menu = openMenu();

        deviceActionRows()
            .find(item => item.text === 'All devices')
            .activate();

        expect(menu.isOpen).toBe(true);
    });

    // Flipping two preferences should not mean two trips through the panel.
    it('stays open when a settings switch is flipped', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();
        const menu = openMenu();

        rowsNamed(toggleOf(), 'Accept routes').at(0).activate();
        await settle();

        expect(menu.isOpen).toBe(true);
    });

    it('applies the change when a switch is activated by click', async () => {
        const { panel, model, daemon } = setup();
        panel.enable();
        await model.start();
        await settle();

        rowsNamed(toggleOf(), 'Accept routes').at(0).activate();
        await settle();

        expect(daemon.patches.at(-1)).toMatchObject({ RouteAll: true });
    });

    // These finish the job, so dismissing the panel is right.
    it.each([['Copy address'], ['Copy DNS name']])('closes after %s', async label => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();
        const menu = openMenu();

        deviceActionRows()
            .find(item => item.text === label)
            .activate();

        expect(menu.isOpen).toBe(false);
    });

    it('closes after choosing an exit node', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();
        const menu = openMenu();

        toggleOf()._exitNode.menu.items.at(0).activate();
        await settle();

        expect(menu.isOpen).toBe(false);
    });
});

describe('the rest of the subtitle vocabulary', () => {
    it.each([
        ['InUseOtherUser', BACKEND.IN_USE_OTHER_USER, 'In use by another user'],
        ['Starting', BACKEND.STARTING, 'Connecting…'],
    ])('says the right thing for %s', async (_name, backendState, expected) => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.BackendState = backendState;
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf().subtitle).toBe(expected);
    });

    // A peer that answered but did not say how it was reached.
    it('reports a ping with no route as just the latency', async () => {
        const { panel, model, daemon } = setup();
        panel.enable();
        await model.start();
        await settle();
        daemon.responses.ping = {
            Err: '',
            LatencySeconds: 0.005,
            Endpoint: '',
            DERPRegionCode: '',
        };

        const row = deviceActionRows().find(item => item.text === 'Ping');
        row.activate();
        await settle();

        expect(row.text).toBe('5 ms');
    });

    // copyText guards an empty string so an OSD never claims to have copied
    // nothing.
    it('does not raise an OSD for a device with no address', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.Peer = rawPeerMap(rawPeer({ TailscaleIPs: [] }));
        panel.enable();
        await model.start();
        await settle();

        deviceActionRows();

        expect(Main.osdMessages).toEqual([]);
        expect(clipboard.CLIPBOARD).toBeNull();
    });
});

describe('the defaults when nothing is injected', () => {
    // extension.js always supplies these, but the fallbacks exist so the class
    // can be constructed in isolation — and a fallback nothing ever runs is a
    // fallback nobody knows is broken.
    it('works without gettext, ngettext or a file chooser', async () => {
        const { daemon, model } = setup();
        const bare = new Panel({
            model,
            settings: createSettings(),
            iconPath: '/nonexistent/quickts/icons/quickts-symbolic.svg',
        });

        daemon.responses.status.Health = ['one', 'two'];
        bare.enable();
        await model.start();
        await settle();

        // The identity gettext leaves the source strings, and the fallback
        // ngettext still picks the plural form.
        expect(toggleOf()._warnings.label.text).toBe('2 warnings');
        expect(await toggleOf()._sendSection._chooseFiles({})).toEqual([]);

        bare.disable();
    });

    it('picks the singular through the fallback ngettext', async () => {
        const { daemon, model } = setup();
        const bare = new Panel({
            model,
            settings: createSettings(),
            iconPath: '/nonexistent/quickts/icons/quickts-symbolic.svg',
        });

        daemon.responses.status.Health = ['only one'];
        bare.enable();
        await model.start();
        await settle();

        expect(toggleOf()._warnings.label.text).toBe('1 warning');

        bare.disable();
    });
});

describe('every settings switch', () => {
    it.each([
        ['Accept routes', 'RouteAll', true],
        ['Accept DNS', 'CorpDNS', false],
        ['Allow LAN access', 'ExitNodeAllowLANAccess', true],
        ['Block incoming', 'ShieldsUp', true],
        ['Tailscale SSH', 'RunSSH', false],
    ])('%s patches %s', async (label, pref, expected) => {
        const { panel, model, daemon } = setup();
        daemon.responses.prefs.CorpDNS = true;
        daemon.responses.prefs.RunSSH = true;
        panel.enable();
        await model.start();
        await settle();

        rowsNamed(toggleOf(), label).at(0).activate();
        await settle();

        expect(daemon.patches.at(-1)).toMatchObject({ [pref]: expected });
    });
});

describe('teardown', () => {
    it('releases the keybinding', () => {
        const { panel } = setup();
        panel.enable();
        panel.disable();

        expect(Main.removeCalls).toEqual([SHORTCUT_KEYS.OPEN_MENU]);
    });

    it('unsubscribes from the model', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();

        expect(model.subscriberCount).toBe(1);

        panel.disable();

        expect(model.subscriberCount).toBe(0);
    });

    it('disconnects from the settings', () => {
        const { panel, settings } = setup();
        panel.enable();

        expect(settings.connected.size).toBeGreaterThan(0);

        panel.disable();

        expect(settings.connected.size).toBe(0);
    });

    // The property the review guidelines require and upstream does not have:
    // every signal connected by the extension is disconnected in disable().
    it('leaves no signal handler connected', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();

        panel.disable();

        expect(liveHandlers.size).toBe(0);
    });

    it('destroys its actors', () => {
        const { panel } = setup();
        panel.enable();
        const toggle = toggleOf();
        const indicator = Main.externalIndicators.at(-1).indicator;

        panel.disable();

        expect(toggle._wasDestroyed).toBe(true);
        expect(indicator._wasDestroyed).toBe(true);
    });

    // The Shell parents the toggle's menu into the quick settings overlay and
    // never destroys it, so the extension must, or every lock leaks one —
    // along with the toggle, model and transport its handlers still reach.
    it('destroys the tile menu the Shell leaves behind', () => {
        const { panel } = setup();
        panel.enable();
        const menu = toggleOf().menu;

        panel.disable();

        expect(menu._wasDestroyed).toBe(true);
    });

    it('leaves no layout handler or later behind', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        Main.press(SHORTCUT_KEYS.OPEN_MENU);
        toggleOf().menu.actor.emit('notify::allocation');
        panel.disable();

        expect(laters.size).toBe(0);
        expect(liveHandlers.size).toBe(0);
    });

    // The shape of the bug headless-check.sh exists to catch: a second enable
    // must be as clean as the first.
    it('survives enable, disable and enable again', async () => {
        const { panel, model } = setup();

        panel.enable();
        await model.start();
        panel.disable();
        panel.enable();
        await settle();

        expect(Main.addCalls).toEqual([
            SHORTCUT_KEYS.OPEN_MENU,
            SHORTCUT_KEYS.OPEN_MENU,
        ]);
        expect(Main.externalIndicators).toHaveLength(2);

        panel.disable();

        expect(liveHandlers.size).toBe(0);
    });

    it('tolerates disable without enable', () => {
        const { panel } = setup();

        expect(() => panel.disable()).not.toThrow();
    });

    it('tolerates being disabled twice', () => {
        const { panel } = setup();
        panel.enable();
        panel.disable();

        expect(() => panel.disable()).not.toThrow();
    });
});

describe('login', () => {
    const loggedOut = daemon => {
        daemon.responses.status.BackendState = BACKEND.NEEDS_LOGIN;
        daemon.responses.status.AuthURL = 'https://login.tailscale.com/a/abc123';
    };

    it('opens the auth URL once a login is asked for', async () => {
        const { panel, model, daemon } = setup();
        loggedOut(daemon);
        panel.enable();
        await model.start();
        await settle();

        rowsNamed(toggleOf(), 'Log in…').at(0).activate();
        await settle();

        expect(launchedUris).toEqual(['https://login.tailscale.com/a/abc123']);
    });

    // The URL is in the state whenever the daemon is waiting for a login.
    // Opening a browser on that alone would hijack the session of anyone who
    // simply happens to be logged out when the Shell starts.
    it('does not open a browser unasked', async () => {
        const { panel, model, daemon } = setup();
        loggedOut(daemon);
        panel.enable();
        await model.start();
        await settle();

        expect(launchedUris).toEqual([]);
    });

    // Left set, the flag outlives a failed attempt, and the next AuthURL to
    // turn up for any reason at all — the daemon starting its own reauth hours
    // later — opens a browser nobody asked for.
    it('does not stay armed after a login that got nowhere', async () => {
        const { panel, model, daemon } = setup();
        loggedOut(daemon);
        daemon.responses.status.AuthURL = '';
        panel.enable();
        await model.start();
        await settle();

        daemon.failures.set('/localapi/v0/login-interactive', {
            name: 'TransportError',
            reason: REASON.PERMISSION_DENIED,
        });

        rowsNamed(toggleOf(), 'Log in…').at(0).activate();
        await settle();

        // The daemon recovers and later reports a URL of its own accord.
        daemon.failures.clear();
        daemon.responses.status.AuthURL = 'https://login.tailscale.com/a/later';
        await model.refresh();
        await settle();

        expect(launchedUris).toEqual([]);
    });

    // The URL comes from whatever control server the profile points at.
    it('refuses a login URL that is not http', async () => {
        const { panel, model, daemon } = setup();
        loggedOut(daemon);
        daemon.responses.status.AuthURL = 'file:///etc/passwd';
        panel.enable();
        await model.start();
        await settle();

        rowsNamed(toggleOf(), 'Log in…').at(0).activate();
        await settle();

        expect(launchedUris).toEqual([]);
    });

    // As js/ui/messageList.js launches a link: a launch context, so the
    // browser that opens gets startup notification and the right workspace.
    it('passes a launch context', async () => {
        const { panel, model, daemon } = setup();
        loggedOut(daemon);
        panel.enable();
        await model.start();
        await settle();

        rowsNamed(toggleOf(), 'Log in…').at(0).activate();
        await settle();

        expect(launchContexts).toEqual([{ timestamp: 0, workspace: -1 }]);
    });

    // GIO throws when nothing handles https. That must not abort the sync it
    // happens inside, which would leave the rest of the menu stale.
    it('finishes the sync when no browser can be launched', async () => {
        const { panel, model, daemon } = setup();
        loggedOut(daemon);
        daemon.responses.status.AuthURL = '';
        panel.enable();
        await model.start();
        await settle();

        // The URL arrives with the read that follows the login, inside the
        // sync that also has the new warning to draw.
        launchFailure.next = new Error(
            'No application is registered as handling this file',
        );
        const realRequest = daemon.client.request;
        daemon.client.request = async descriptor => {
            if (descriptor.path.startsWith('/localapi/v0/login-interactive')) {
                daemon.responses.status.AuthURL = 'https://login.tailscale.com/a/abc';
                daemon.responses.status.Health = ['a warning'];
            }
            return realRequest(descriptor);
        };

        rowsNamed(toggleOf(), 'Log in…').at(0).activate();
        await settle();

        expect(toggleOf()._warnings.visible).toBe(true);
    });

    it('opens it only once', async () => {
        const { panel, model, daemon } = setup();
        loggedOut(daemon);
        panel.enable();
        await model.start();
        await settle();

        rowsNamed(toggleOf(), 'Log in…').at(0).activate();
        await settle();
        await model.refresh();
        await settle();

        expect(launchedUris).toHaveLength(1);
    });
});
