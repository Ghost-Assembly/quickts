import { describe, expect, it, vi } from 'vitest';

import { REASON } from '../modules/errors.js';
import { rawPeer, rawPeerMap, SUFFIX } from './fixtures/peers.js';
import * as Main from './stubs/shell-main.js';
import { settle, setup, toggleOf, useShellStubs } from './support/panel.js';

useShellStubs();

describe('received files', () => {
    const withFiles = daemon => {
        daemon.responses.files = [
            { Name: 'report.pdf', Size: 2048 },
            { Name: 'notes.txt', Size: 12 },
        ];
    };

    it('is hidden when nothing is waiting', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        expect(toggleOf()._inbox.visible).toBe(false);
    });

    it('lists what is waiting, with sizes', async () => {
        const { panel, model, daemon } = setup();
        withFiles(daemon);
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        expect(toggleOf()._inbox.visible).toBe(true);
        expect(toggleOf()._inbox.label.text).toBe('2 received files');
        expect(toggleOf()._inbox.menu.items.at(0).text).toBe('report.pdf  ·  2.0 kB');
    });

    it('saves a file and reports where it went', async () => {
        const { panel, model, daemon } = setup();
        withFiles(daemon);
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        const row = toggleOf()._inbox.menu.items.at(0);
        row.activate();
        await settle();

        expect(daemon.saved.at(-1).name).toBe('report.pdf');
        expect(row.text).toContain('Saved to');
        expect(Main.osdMessages).toHaveLength(1);
    });

    // In that order: deleting first loses the file if the write fails.
    it('forgets the file only after saving it', async () => {
        const { panel, model, daemon } = setup();
        withFiles(daemon);
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        toggleOf()._inbox.menu.items.at(0).activate();
        await settle();

        expect(daemon.deleted.at(-1)).toContain('report.pdf');
        expect(daemon.saved).toHaveLength(1);
    });

    it('does not forget a file it could not save', async () => {
        const { panel, model, daemon } = setup();
        withFiles(daemon);
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        daemon.failures.set('/localapi/v0/files/report.pdf', {
            name: 'TransportError',
            reason: REASON.HTTP,
        });

        const row = toggleOf()._inbox.menu.items.at(0);
        row.activate();
        await settle();

        expect(daemon.deleted).toEqual([]);
        expect(row.sensitive).toBe(true);
        expect(row.text).toMatch(/\S/);
    });
});

describe('the file chooser failing', () => {
    // The portal rejects when xdg-desktop-portal is not installed or running.
    // Unhandled, that was an unhandled rejection and a click that did nothing
    // and said nothing.
    it('reports a portal that will not open', async () => {
        const { panel, model, daemon } = setup({
            chooseFiles: () => Promise.reject(new Error('ServiceUnknown')),
        });
        daemon.responses.fileTargets = [{ Node: { StableID: 'nSOMEID1CNTRL' } }];
        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        toggleOf()._taildrop.menu.items.at(0).activate();
        await settle();

        expect(Main.notifications.at(-1).kind).toBe('error');
    });
});

describe('taildrop', () => {
    const withTarget = daemon => {
        daemon.responses.status.Peer = rawPeerMap(rawPeer({ TaildropTarget: 1 }));
        daemon.responses.fileTargets = [{ Node: { StableID: 'nSOMEID1CNTRL' } }];
    };

    it('is hidden when nothing can receive', async () => {
        const { panel, model } = setup();
        panel.enable();
        await model.start();
        await settle();

        toggleOf().menu.open();
        await settle();

        expect(toggleOf()._taildrop.visible).toBe(false);
    });

    it('lists a node that can receive', async () => {
        const { panel, model, daemon } = setup();
        withTarget(daemon);
        panel.enable();
        await model.start();
        await settle();

        toggleOf().menu.open();
        await settle();

        expect(toggleOf()._taildrop.visible).toBe(true);
        expect(toggleOf()._taildrop.menu.items.at(0).text).toBe('laptop');
    });

    // Grayed out with the daemon's own reason, rather than silently dropped —
    // which is what makes the difference between "that machine is asleep" and
    // "this extension is broken".
    it('shows an ineligible node with its reason', async () => {
        const { panel, model, daemon } = setup();
        withTarget(daemon);
        daemon.responses.status.Peer = rawPeerMap(
            rawPeer({ TaildropTarget: 1 }),
            rawPeer({ ID: 'nOFF', DNSName: `sleeper.${SUFFIX}.`, TaildropTarget: 5 }),
        );
        panel.enable();
        await model.start();
        await settle();

        toggleOf().menu.open();
        await settle();

        const row = toggleOf()._taildrop.menu.items.find(item =>
            item.text.startsWith('sleeper'),
        );

        expect(row.text).toContain('Offline');
        expect(row.sensitive).toBe(false);
    });

    it('asks for files and sends them', async () => {
        const { panel, model, daemon, chosen } = setup();
        withTarget(daemon);
        chosen.uris = ['file:///home/someone/notes.txt'];
        const putFile = vi.fn().mockResolvedValue(undefined);
        daemon.client.putFile = putFile;

        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        toggleOf()._taildrop.menu.items.at(0).activate();
        await settle();

        expect(chosen.calls).toHaveLength(1);
        expect(putFile).toHaveBeenCalledTimes(1);
        expect(putFile.mock.calls[0][0].path).toBe(
            '/localapi/v0/file-put/nSOMEID1CNTRL/notes.txt',
        );
        expect(Main.osdMessages).toHaveLength(1);
    });

    it('does nothing when the dialog is dismissed', async () => {
        const { panel, model, daemon, chosen } = setup();
        withTarget(daemon);
        chosen.uris = [];
        const putFile = vi.fn();
        daemon.client.putFile = putFile;

        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        toggleOf()._taildrop.menu.items.at(0).activate();
        await settle();

        expect(putFile).not.toHaveBeenCalled();
        expect(Main.osdMessages).toHaveLength(0);
    });

    // A count is not "%d file" with an s bolted on.
    it('pluralizes what it sent', async () => {
        const { panel, model, daemon, chosen } = setup();
        withTarget(daemon);
        chosen.uris = ['file:///a/one.txt', 'file:///a/two.txt'];
        daemon.client.putFile = vi.fn().mockResolvedValue(undefined);

        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        toggleOf()._taildrop.menu.items.at(0).activate();
        await settle();

        expect(Main.osdMessages.at(-1).label).toBe('Sent 2 files to laptop');
    });

    // Node names and file names identify people. Main.notifyError copies both
    // to the journal; SECURITY.md promises neither goes there.
    it('keeps the names it could not send out of the journal', async () => {
        const { panel, model, daemon, chosen } = setup();
        withTarget(daemon);
        chosen.uris = ['file:///a/secret-plans.txt'];
        daemon.client.putFile = vi.fn().mockRejectedValue(new Error('refused'));

        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        toggleOf()._taildrop.menu.items.at(0).activate();
        await settle();

        const logged = console.warn.mock.calls.flat().join('\n');
        expect(logged).not.toContain('secret-plans');
        expect(logged).not.toContain('laptop');
        expect(Main.notifications.at(-1).details).toContain('secret-plans.txt');
    });

    it('reports the files it could not send', async () => {
        const { panel, model, daemon, chosen } = setup();
        withTarget(daemon);
        chosen.uris = ['file:///a/one.txt', 'file:///a/two.txt'];
        daemon.client.putFile = vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('peer refused'));

        panel.enable();
        await model.start();
        await settle();
        toggleOf().menu.open();
        await settle();

        toggleOf()._taildrop.menu.items.at(0).activate();
        await settle();

        expect(Main.notifications.at(-1).message).toBe('Could not send to laptop');
        expect(Main.notifications.at(-1).details).toContain('two.txt');
    });

    // A disable while the request is in flight destroys the submenu; the
    // response must not then be written into a menu that no longer exists.
    it('survives being disabled while listing targets', async () => {
        const { panel, model, daemon } = setup();
        withTarget(daemon);
        panel.enable();
        await model.start();
        await settle();

        toggleOf().menu.open();
        panel.disable();

        await expect(settle()).resolves.toBeUndefined();
    });
});
