import { describe, expect, it } from 'vitest';

import { KEYS } from '../modules/settings.js';
import { rawPeer, rawPeerMap, SUFFIX } from './fixtures/peers.js';
import * as Main from './stubs/shell-main.js';
import { createSettings } from './support/world.js';
import { labelsOf, settle, setup, toggleOf, useShellStubs } from './support/panel.js';

useShellStubs();

describe('the exit node picker', () => {
    const withGateway = () => ({
        status: {
            BackendState: 'Running',
            AuthURL: '',
            Health: [],
            MagicDNSSuffix: SUFFIX,
            CurrentTailnet: { Name: 'example@example.com' },
            Self: { HostName: 'desktop', TailscaleIPs: ['100.64.0.9'] },
            Peer: rawPeerMap(
                rawPeer({
                    ID: 'nGATE',
                    DNSName: `gateway.${SUFFIX}.`,
                    ExitNodeOption: true,
                }),
                rawPeer(),
            ),
        },
    });

    it('offers only nodes that can be exit nodes', async () => {
        const { panel, model } = setup({ seed: withGateway() });
        panel.enable();
        await model.start();
        await settle();

        const labels = toggleOf()._exitNode.menu.items.map(item => item.text);

        expect(labels).toContain('gateway');
        expect(labels).not.toContain('laptop');
    });

    // Tailscale's automatic exit node sets ExitNodeID to "auto:any", which
    // matches no peer. Keying the UI on the derived name would tick "None"
    // and hide the indicator while an exit node was in use.
    it('does not tick None when an automatic exit node is in use', async () => {
        const { panel, model, daemon } = setup({ seed: withGateway() });
        daemon.responses.prefs.ExitNodeID = 'auto:any';
        panel.enable();
        await model.start();
        await settle();

        const none = toggleOf()._exitNode.menu.items.find(item => item.text === 'None');

        expect(none.icon).toBe('');
        expect(toggleOf()._exitNode.label.text).toBe('Exit node: automatic');
        expect(toggleOf().subtitle).toBe('via an exit node');
    });

    it('shows the indicator for an automatic exit node', async () => {
        const { panel, model, daemon } = setup({ seed: withGateway() });
        daemon.responses.prefs.ExitNodeID = 'auto:any';
        panel.enable();
        await model.start();
        await settle();

        const indicator = Main.externalIndicators.at(-1).indicator;

        expect(indicator._exit.visible).toBe(true);
    });

    it('selects an exit node', async () => {
        const { panel, model, daemon } = setup({ seed: withGateway() });
        panel.enable();
        await model.start();
        await settle();

        toggleOf()
            ._exitNode.menu.items.find(item => item.text === 'gateway')
            .activate();
        await settle();

        expect(daemon.patches.at(-1)).toMatchObject({ ExitNodeID: 'nGATE' });
    });

    // The same row both sets and unsets, so no separate "stop" control is
    // needed and there is no state in which one is shown and the other is not.
    it('clears the exit node by selecting it again', async () => {
        const seed = withGateway();
        const { panel, model, daemon } = setup({ seed });
        daemon.responses.prefs.ExitNodeID = 'nGATE';
        panel.enable();
        await model.start();
        await settle();

        toggleOf()
            ._exitNode.menu.items.find(item => item.text === 'gateway')
            .activate();
        await settle();

        expect(daemon.patches.at(-1)).toMatchObject({ ExitNodeID: '' });
    });

    describe('Mullvad', () => {
        const mullvadPeer = (id, name, country, code, city) =>
            rawPeer({
                ID: id,
                DNSName: `${name}.${SUFFIX}.`,
                ExitNodeOption: true,
                Tags: ['tag:mullvad-exit-node'],
                Location: { Country: country, CountryCode: code, City: city },
            });

        const withMullvad = () => ({
            status: {
                BackendState: 'Running',
                AuthURL: '',
                Health: [],
                MagicDNSSuffix: SUFFIX,
                CurrentTailnet: { Name: 'example@example.com' },
                Self: { HostName: 'desktop', TailscaleIPs: ['100.64.0.9'] },
                Peer: rawPeerMap(
                    rawPeer({
                        ID: 'nGATE',
                        DNSName: `gateway.${SUFFIX}.`,
                        ExitNodeOption: true,
                    }),
                    mullvadPeer('nSE1', 'se-sto-wg-001', 'Sweden', 'se', 'Stockholm'),
                    mullvadPeer('nSE2', 'se-got-wg-002', 'Sweden', 'se', 'Gothenburg'),
                    mullvadPeer(
                        'nUS1',
                        'us-nyc-wg-001',
                        'United States',
                        'us',
                        'New York',
                    ),
                ),
            },
        });

        const exitRows = () => labelsOf(toggleOf()._exitNode.menu.items);

        it('groups countries into rows rather than nested submenus', async () => {
            const { panel, model } = setup({ seed: withMullvad() });
            panel.enable();
            await model.start();
            await settle();

            expect(exitRows()).toEqual([
                'None',
                'gateway',
                '🇸🇪  Sweden',
                '🇺🇸  United States',
            ]);

            // A nested submenu is what closed the menu it sat in; there must
            // not be one here.
            expect(
                toggleOf()._exitNode.menu.items.every(item => item.menu === undefined),
            ).toBe(true);
        });

        it('opens a country in place', async () => {
            const { panel, model } = setup({ seed: withMullvad() });
            panel.enable();
            await model.start();
            await settle();

            toggleOf()
                ._exitNode.menu.items.find(item => item.text?.includes('Sweden'))
                .activate();

            expect(exitRows()).toEqual(['All exit nodes', 'Gothenburg', 'Stockholm']);
            expect(toggleOf()._exitNode.label.text).toBe('Sweden');
        });

        it('goes back to the exit node list', async () => {
            const { panel, model } = setup({ seed: withMullvad() });
            panel.enable();
            await model.start();
            await settle();

            toggleOf()
                ._exitNode.menu.items.find(item => item.text?.includes('Sweden'))
                .activate();
            toggleOf()
                ._exitNode.menu.items.find(item => item.text === 'All exit nodes')
                .activate();

            expect(exitRows()).toContain('gateway');
        });

        it('selects a Mullvad node from inside its country', async () => {
            const { panel, model, daemon } = setup({ seed: withMullvad() });
            panel.enable();
            await model.start();
            await settle();

            toggleOf()
                ._exitNode.menu.items.find(item => item.text?.includes('Sweden'))
                .activate();
            toggleOf()
                ._exitNode.menu.items.find(item => item.text === 'Stockholm')
                .activate();
            await settle();

            expect(daemon.patches.at(-1)).toMatchObject({ ExitNodeID: 'nSE1' });
        });

        it('hides them all when the preference says so', async () => {
            const settings = createSettings({ [KEYS.SHOW_MULLVAD]: false });
            const { panel, model } = setup({ seed: withMullvad(), settings });
            panel.enable();
            await model.start();
            await settle();

            expect(exitRows()).toEqual(['None', 'gateway']);
        });
    });

    it('offers None', async () => {
        const { panel, model, daemon } = setup({ seed: withGateway() });
        daemon.responses.prefs.ExitNodeID = 'nGATE';
        panel.enable();
        await model.start();
        await settle();

        toggleOf()._exitNode.menu.items.at(0).activate();
        await settle();

        expect(daemon.patches.at(-1)).toMatchObject({ ExitNodeID: '' });
    });
});

describe('the suggested exit node', () => {
    it('is offered while none is chosen', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        expect(labelsOf(toggleOf()._exitNode.menu.items)).toContain(
            'Suggested: gateway',
        );
    });

    it('selects it when activated', async () => {
        const { panel, model, daemon } = setup();
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        toggleOf()
            ._exitNode.menu.items.find(item => item.text === 'Suggested: gateway')
            .activate();
        await settle();

        expect(daemon.patches.at(-1)).toMatchObject({ ExitNodeID: 'nGATE' });
    });

    // Once one is in use a suggestion is noise, and asking for it is a request
    // whose answer nothing would show.
    it('is not asked for when an exit node is already chosen', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.prefs.ExitNodeID = 'nSOMEID1CNTRL';
        panel.enable();
        await model.start();
        await settle();
        daemon.reset();

        toggleOf().menu.open();
        await settle();

        expect(daemon.pathsMatching('suggest-exit-node')).toEqual([]);
    });

    it('forgets a suggestion the daemon has withdrawn', async () => {
        const { panel, model, daemon } = setup();
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();
        toggleOf().menu.close();

        daemon.responses.suggestion = { ID: '', Name: '' };
        toggleOf().menu.open();
        await settle();

        expect(
            labelsOf(toggleOf()._exitNode.menu.items).some(text =>
                text.startsWith('Suggested'),
            ),
        ).toBe(false);
    });

    it('says nothing when the daemon has no opinion', async () => {
        const { panel, model, daemon } = setup();
        daemon.responses.suggestion = { ID: '', Name: '' };
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        expect(
            labelsOf(toggleOf()._exitNode.menu.items).some(text =>
                text.startsWith('Suggested'),
            ),
        ).toBe(false);
    });
});
