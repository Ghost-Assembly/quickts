import { describe, expect, it, vi } from 'vitest';

import { REASON } from '../modules/errors.js';
import { KEYS } from '../modules/settings.js';
import { rawPeer, rawPeerMap, SUFFIX } from './fixtures/peers.js';
import { clipboard } from './stubs/gi-st.js';
import * as Main from './stubs/shell-main.js';
import { createSettings } from './support/world.js';
import {
    deviceActionRows,
    labelsOf,
    rowsNamed,
    settle,
    setup,
    toggleOf,
    useShellStubs,
} from './support/panel.js';

useShellStubs();

describe('devices', () => {
    it('lists the peers', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        expect(rowsNamed(toggleOf(), 'laptop')).not.toHaveLength(0);
    });

    /**
     * Navigate into the first device and return the rows now showing.
     *
     * The Devices submenu swaps its own contents rather than opening a nested
     * one, because GNOME closes the open submenu when another opens — see
     * _showDevice in modules/panel.js.
     */
    const deviceActions = (name = 'laptop') => {
        toggleOf()
            ._devices.menu.items.find(item => item.text === name)
            .activate();

        return toggleOf()._devices.menu.items;
    };

    it('lists devices before any is chosen', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf()._devices.menu.items.map(item => item.text)).toEqual([
            'laptop',
        ]);
        expect(toggleOf()._devices.label.text).toBe('Devices');
    });

    it('offers actions for a device', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        expect(labelsOf(deviceActions())).toEqual([
            'All devices',
            'Ping',
            'Copy address',
            'Copy DNS name',
            'Send files…',
        ]);
        expect(toggleOf()._devices.label.text).toBe('laptop');
    });

    it('goes back to the list', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        deviceActions()
            .find(item => item.text === 'All devices')
            .activate();

        expect(toggleOf()._devices.menu.items.map(item => item.text)).toEqual([
            'laptop',
        ]);
        expect(toggleOf()._devices.label.text).toBe('Devices');
    });

    // Reopening should land on the list, not wherever the last visit wandered.
    it('returns to the list when the menu is closed', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        deviceActions();
        toggleOf().menu.open();
        toggleOf().menu.close();

        expect(toggleOf()._devices.menu.items.map(item => item.text)).toEqual([
            'laptop',
        ]);
    });

    // A device that goes away while its actions are on screen must not leave
    // the submenu showing nothing.
    it('falls back to the list when the device disappears', async () => {
        const { panel, model, daemon } = setup();
        panel.enable();
        await model.start();
        await settle();
        deviceActions();

        daemon.responses.status.Peer = rawPeerMap(
            rawPeer({ ID: 'nOTHER', DNSName: `other.${SUFFIX}.` }),
        );
        await model.refresh({ peers: true });
        await settle();

        expect(toggleOf()._devices.label.text).toBe('Devices');
        expect(toggleOf()._devices.menu.items.map(item => item.text)).toEqual([
            'other',
        ]);
    });

    it('copies the address', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        deviceActions()
            .find(item => item.text === 'Copy address')
            .activate();

        expect(clipboard.CLIPBOARD).toBe('100.64.0.1');
        expect(clipboard.PRIMARY).toBe('100.64.0.1');
        expect(Main.osdMessages).toHaveLength(1);
    });

    it('copies the DNS name', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        deviceActions()
            .find(item => item.text === 'Copy DNS name')
            .activate();

        expect(clipboard.CLIPBOARD).toBe(`laptop.${SUFFIX}`);
    });

    it('does not offer Send files to a device that cannot receive', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.Peer = rawPeerMap(rawPeer({ TaildropTarget: 5 }));
        panel.enable();
        await model.start();
        await settle();

        expect(deviceActions().map(item => item.text)).not.toContain('Send files…');
    });

    describe('ping', () => {
        it('reports latency and a direct route on the row', async () => {
            const { panel, model, daemon } = setup();
            panel.enable();
            await model.start();
            await settle();
            daemon.responses.ping = {
                Err: '',
                LatencySeconds: 0.000757188,
                Endpoint: '172.18.255.30:53068',
                DERPRegionCode: '',
            };

            const row = deviceActions().find(item => item.text === 'Ping');
            row.activate();
            await settle();

            expect(row.text).toBe('0.76 ms, direct');
        });

        it('names the relay when the path is not direct', async () => {
            const { panel, model, daemon } = setup();
            panel.enable();
            await model.start();
            await settle();
            daemon.responses.ping = {
                Err: '',
                LatencySeconds: 0.042,
                Endpoint: '',
                DERPRegionCode: 'lhr',
            };

            const row = deviceActions().find(item => item.text === 'Ping');
            row.activate();
            await settle();

            expect(row.text).toBe('42 ms, relayed via lhr');
        });

        // The daemon reports a failed ping as a 200 with Err set, so a caller
        // that only checks the status code sees every ping succeed.
        it('reports the daemon its own error', async () => {
            const { panel, model, daemon } = setup();
            panel.enable();
            await model.start();
            await settle();
            daemon.responses.ping = { Err: 'no matching peer' };

            const row = deviceActions().find(item => item.text === 'Ping');
            row.activate();
            await settle();

            expect(row.text).toBe('no matching peer');
        });

        it('says so when nothing came back', async () => {
            const { panel, model, daemon } = setup();
            panel.enable();
            await model.start();
            await settle();
            daemon.responses.ping = { Err: '', LatencySeconds: 0 };

            const row = deviceActions().find(item => item.text === 'Ping');
            row.activate();
            await settle();

            expect(row.text).toBe('No reply');
        });

        // A netmap update while a result is on screen used to rebuild the
        // section and take the result with it, along with the open submenu.
        it('survives an unrelated state change', async () => {
            const { panel, model, daemon } = setup();
            panel.enable();
            await model.start();
            await settle();
            daemon.responses.ping = { Err: '', LatencySeconds: 0.001, Endpoint: 'x:1' };

            const row = deviceActions().find(item => item.text === 'Ping');
            row.activate();
            await settle();

            await model.setShieldsUp(true);
            await settle();

            expect(toggleOf()._devices.menu.items).toContain(row);
            expect(row.text).toBe('1 ms, direct');
        });

        it('does not mark the daemon unreachable when a peer will not answer', async () => {
            const { panel, model, daemon } = setup();
            panel.enable();
            await model.start();
            await settle();
            daemon.failures.set('/localapi/v0/ping', {
                name: 'TransportError',
                reason: REASON.HTTP,
            });

            deviceActions()
                .find(item => item.text === 'Ping')
                .activate();
            await settle();

            expect(model.state.reachable).toBe(true);
        });
    });

    // The long-press shortcut that used to live on this row is gone. Every
    // action it hid is now one visible click away, and a gesture competing
    // with the row's own click handling was the other unproven risk here.
    it('carries no gesture on a device row', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        expect(toggleOf()._devices.menu.items.at(0).actions).toEqual([]);
    });

    it('hides offline devices when the preference says so', async () => {
        const settings = createSettings({ [KEYS.SHOW_OFFLINE_NODES]: false });
        const { panel, model, daemon } = setup({ settings });
        daemon.responses.status.Peer = rawPeerMap(rawPeer({ Online: false }));
        panel.enable();
        await model.start();
        await settle();

        expect(rowsNamed(toggleOf(), 'No devices')).toHaveLength(1);
    });

    it('rebuilds when the preference changes', async () => {
        const settings = createSettings();
        const { panel, model, daemon } = setup({ settings });
        daemon.responses.status.Peer = rawPeerMap(rawPeer({ Online: false }));
        panel.enable();
        await model.start();
        await settle();

        expect(rowsNamed(toggleOf(), 'laptop')).not.toHaveLength(0);

        settings.set_boolean(KEYS.SHOW_OFFLINE_NODES, false);

        expect(rowsNamed(toggleOf(), 'laptop')).toHaveLength(0);
    });

    it('says so when a peer has no address to act on', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.status.Peer = rawPeerMap(rawPeer({ TailscaleIPs: null }));
        panel.enable();
        await model.start();
        await settle();

        expect(labelsOf(deviceActions())).toEqual(['All devices', 'No address']);
    });
});

describe('sending from a device', () => {
    it('sends the files chosen for that device', async () => {
        const { panel, model, daemon, chosen } = setup();
        daemon.responses.fileTargets = [{ Node: { StableID: 'nSOMEID1CNTRL' } }];
        chosen.uris = ['file:///notes.txt'];
        const putFile = vi.fn().mockResolvedValue(undefined);
        daemon.client.putFile = putFile;
        panel.enable();
        await model.start();
        await settle();

        deviceActionRows()
            .find(item => item.text === 'Send files…')
            .activate();
        await settle();

        expect(putFile.mock.calls[0][0].path).toContain('/file-put/nSOMEID1CNTRL/');
    });

    // A peer's own TaildropTarget can say available while the daemon, which
    // decides, does not list it. Nothing is sent to a peer the daemon has not
    // named as a target, whichever row the send started from.
    it('sends nothing to a device the daemon does not list', async () => {
        const { panel, model, daemon, chosen } = setup();
        daemon.responses.fileTargets = [];
        chosen.uris = ['file:///notes.txt'];
        const putFile = vi.fn().mockResolvedValue(undefined);
        daemon.client.putFile = putFile;
        panel.enable();
        await model.start();
        await settle();

        deviceActionRows()
            .find(item => item.text === 'Send files…')
            .activate();
        await settle();

        expect(chosen.calls).toEqual([]);
        expect(putFile).not.toHaveBeenCalled();
        expect(Main.notifications.at(-1).message).toBe('Cannot send to laptop');
    });
});
