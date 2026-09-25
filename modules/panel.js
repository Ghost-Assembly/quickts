// The actor tree: the quick settings tile, its menu, and the keybinding.
//
// This is the one file that touches St, Clutter and the Shell's own modules,
// and it deliberately holds no decisions. What to show comes from
// modules/health.js, how to group it from modules/peers.js and
// modules/mullvad.js, how tall to make it from modules/layout.js. What is left
// here is construction and teardown.
//
// Teardown is the part worth reading. Every subscription, signal and
// keybinding is recorded in a named field or a flat array and released in
// disable(), because the review guidelines require it and because anything
// left connected keeps the whole extension alive across a lock.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {
    SUMMARY,
    healthLines,
    isOn,
    isUp,
    needsLogin,
    problemOf,
    summaryOf,
} from './health.js';
import { maxHeightStyle, menuMaxHeight } from './layout.js';
import { KEYS, SHORTCUT_KEYS } from './settings.js';
import { ROUTE } from './ping.js';
import { advertisesExitNode } from './routes.js';
import {
    canReceive,
    hasEligibleTarget,
    isListedTarget,
    sendTargets,
} from './taildrop.js';
import { formatSize } from './inbox.js';
import {
    ActionMenuItem,
    StayOpenSwitchMenuItem,
    addDisabledRow,
    addRow,
    copyText,
    openUri,
    showOsd,
    warningRow,
} from './menu-items.js';
import { NavigableSection } from './navigable-section.js';
import { ExitNodeSection } from './exit-node-section.js';

/** The tile's own icon, next to the clock. */
const QuickTSIndicator = GObject.registerClass(
    class QuickTSIndicator extends QuickSettings.SystemIndicator {
        _init(gicon) {
            super._init();

            this._up = this._addIndicator();
            this._up.gicon = gicon;

            // A second icon, shown only while traffic is leaving through a
            // peer. Routing all your traffic through another machine is worth
            // an indicator of its own.
            this._exit = this._addIndicator();
            this._exit.icon_name = 'network-vpn-symbolic';

            this.sync(null);
        }

        /**
         * @param {object|null} state A snapshot, or null before the first read.
         */
        sync(state) {
            const up = Boolean(state && isUp(state));
            this._up.visible = up;
            this._exit.visible = up && Boolean(state.exitNodeId);
        }
    },
);

/** The tile itself, and everything in its menu. */
const QuickTSToggle = GObject.registerClass(
    class QuickTSToggle extends QuickSettings.QuickMenuToggle {
        _init({ gicon, model, settings, chooseFiles, i18n }) {
            // Not toggleMode. In toggle mode St flips `checked` on click,
            // before the daemon has said anything, and a refused change that
            // leaves the state as it was produces no update to flip it back.
            // `checked` is only ever set from the state, in sync().
            super._init({ title: 'Tailscale', gicon, toggleMode: false });

            // gettext and ngettext, passed down rather than held in module
            // variables that a constructor assigns as a side effect.
            this._i18n = i18n;
            const { _ } = i18n;

            this._gicon = gicon;
            this._model = model;
            this._settings = settings;
            this._chooseFiles = chooseFiles;

            // Set only when the user asks to log in. The auth URL is present
            // in the state whenever the daemon is waiting for one, and opening
            // a browser because of that alone would hijack the session of
            // anyone who happens to be logged out.
            this._loginRequested = false;

            // One counter per section, bumped whenever that section is
            // rebuilt. An async handler captures its section's counter and
            // compares before touching a row, because the row it was given
            // may since have been destroyed by removeAll(). Per section, not
            // shared: a netmap blink rebuilding the devices has no business
            // discarding a Taildrop listing or leaving a save reading
            // "Saving…" after it finished.
            //
            // (`row.destroyed` is not a substitute. ClutterActor installs no
            // such property, so a guard reading it is always false.)
            this._devicesGeneration = 0;
            this._taildropGeneration = 0;
            this._inboxGeneration = 0;

            // A one-shot re-measure of the menu height; see
            // _remeasureOnceLaidOut().
            this._allocationId = 0;
            this._laterId = 0;

            // What each section module needs from the toggle, passed
            // explicitly rather than reached for.
            this._deps = { model, settings, i18n, gicon, chooseFiles };

            this.menu.setHeader(gicon, _('Tailscale'), '');

            this._buildSections();

            // Clicking the tile brings the tailnet up or down.
            this.connectObject('clicked', () => this._onClicked(), this);

            this.menu.connectObject(
                'open-state-changed',
                (_menu, open) => this._onOpenStateChanged(open),
                this,
            );
        }

        /** Build the sections once; their contents are refilled on each change. */
        _buildSections() {
            const { _ } = this._i18n;

            // Anything the user can act on, above everything else: an
            // unreachable daemon, a login that is waiting to happen.
            this._problems = new PopupMenu.PopupMenuSection();
            this.menu.addMenuItem(this._problems);

            // Health warnings are informational — the daemon reports things
            // like an SELinux caveat or peers advertising unaccepted routes,
            // which are worth surfacing but are not worth several permanent
            // rows above the controls. They collapse into a count that expands.
            this._warnings = new PopupMenu.PopupSubMenuMenuItem(_('Warnings'), true);
            this._warnings.icon.icon_name = 'dialog-warning-symbolic';
            this._warnings.visible = false;
            this.menu.addMenuItem(this._warnings);

            this._exitNodeSection = new ExitNodeSection(this.menu, this._deps);
            this._exitNode = this._exitNodeSection.item;

            this._devices = new PopupMenu.PopupSubMenuMenuItem(_('Devices'), true);
            this.menu.addMenuItem(this._devices);
            this._deviceSection = new NavigableSection(this._devices, {
                title: () => _('Devices'),
                back: _('All devices'),
                resolve: (id, state) =>
                    this._visibleNodes(state).find(node => node.id === id) ?? null,
                detailTitle: node => node.name,
                renderList: (menu, state, open) =>
                    this._renderDevices(menu, state, open),
                renderDetail: (menu, node, state) =>
                    this._renderDeviceActions(menu, node, state),
            });

            this._taildrop = new PopupMenu.PopupSubMenuMenuItem(_('Send files'), true);
            this._taildrop.visible = false;
            this.menu.addMenuItem(this._taildrop);

            // Taildrop's other half. The daemon holds an incoming file until
            // something asks for it, so without this the extension can send
            // files and is blind to the ones arriving.
            this._inbox = new PopupMenu.PopupSubMenuMenuItem(_('Received files'), true);
            this._inbox.icon.icon_name = 'document-save-symbolic';
            this._inbox.visible = false;
            this.menu.addMenuItem(this._inbox);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._options = new PopupMenu.PopupSubMenuMenuItem(_('Settings'), true);
            this.menu.addMenuItem(this._options);
            this._buildOptions();

            this._profiles = new PopupMenu.PopupSubMenuMenuItem(_('Profiles'), true);
            this.menu.addMenuItem(this._profiles);
        }

        /**
         * The preference switches.
         *
         * Built once rather than rebuilt, so that toggling one does not
         * destroy the actor the click is still traveling through.
         */
        _buildOptions() {
            const { _ } = this._i18n;

            this._switches = [
                [
                    state => state.acceptRoutes,
                    _('Accept routes'),
                    value => this._model.setAcceptRoutes(value),
                ],
                [
                    state => state.acceptDNS,
                    _('Accept DNS'),
                    value => this._model.setAcceptDNS(value),
                ],
                [
                    state => state.allowLanAccess,
                    _('Allow LAN access'),
                    value => this._model.setAllowLanAccess(value),
                ],
                [
                    state => state.shieldsUp,
                    _('Block incoming'),
                    value => this._model.setShieldsUp(value),
                ],
                [
                    state => state.ssh,
                    _('Tailscale SSH'),
                    value => this._model.setSsh(value),
                ],
                [
                    // Not a preference of its own: it is both default routes
                    // being present in AdvertiseRoutes.
                    state => advertisesExitNode(state.advertiseRoutes),
                    _('Run as exit node'),
                    value => this._model.setRunExitNode(value),
                ],
            ].map(([read, label, apply]) => {
                const item = new StayOpenSwitchMenuItem(label, false);

                // The switch reports what the user asked for; the daemon's
                // answer comes back through the model and is what finally
                // sets the state. A refused change therefore reverts.
                item.connectObject(
                    'toggled',
                    (_item, value) => void apply(value),
                    this,
                );
                this._options.menu.addMenuItem(item);

                return { read, item };
            });
        }

        /**
         * Bring the menu up to date.
         *
         * `fields` says what actually moved. Rebuilding a section destroys its
         * rows, which closes any submenu the user has open and discards a ping
         * result they are still reading — so a section is only rebuilt when
         * its own inputs changed. The first sync passes nothing and rebuilds
         * everything.
         *
         * @param {object} state A snapshot.
         * @param {string[]|null} [fields] Changed field names, or null for all.
         */
        sync(state, fields = null) {
            const { _ } = this._i18n;

            const moved = name => fields === null || fields.includes(name);

            this.checked = isOn(state);
            this.subtitle = subtitleFor(state, this._i18n);
            this.menu.setHeader(this._gicon, _('Tailscale'), this.subtitle);

            this._maybeOpenAuthUrl(state);

            if (moved('reachable') || moved('errorReason') || moved('backendState'))
                this._syncProblems(state);

            if (moved('health')) this._syncWarnings(state);

            if (moved('nodes') || moved('exitNodeId'))
                this._exitNodeSection.sync(state);
            if (moved('nodes') || moved('magicDNSSuffix')) this._syncDevices(state);

            this._syncOptions(state);

            if (moved('profiles') || moved('currentProfileId'))
                this._syncProfiles(state);
        }

        /**
         * Open the login page, once, if one was asked for.
         *
         * @param {object} state A snapshot.
         */
        _maybeOpenAuthUrl(state) {
            if (!this._loginRequested || !state.authUrl) return;

            this._loginRequested = false;

            // The URL comes from whatever control server the profile points
            // at, so the scheme is checked before it is handed to whichever
            // desktop handler claims it. modules/warnings.js restricts its
            // links the same way.
            if (!/^https?:\/\//i.test(state.authUrl)) {
                console.warn('[quickts] refusing to open a non-http login URL');
                return;
            }

            openUri(state.authUrl);
        }

        /** @param {object} state A snapshot. */
        _syncProblems(state) {
            const { _ } = this._i18n;

            this._problems.removeAll();

            const problem = problemOf(state);
            if (problem) {
                const item = new PopupMenu.PopupImageMenuItem(
                    _(problem.message),
                    problem.actionable
                        ? 'dialog-warning-symbolic'
                        : 'network-offline-symbolic',
                );
                // A problem that names a command puts it on the clipboard when
                // activated, so it can be pasted into a terminal rather than
                // retyped from a menu. One that names none has nothing to do.
                if (problem.command)
                    item.connectObject(
                        'activate',
                        () => copyText(problem.command, this._gicon, this._i18n),
                        this,
                    );
                else item.setSensitive(false);

                this._problems.addMenuItem(item);
            }

            if (needsLogin(state)) {
                addRow(
                    this._problems,
                    _('Log in…'),
                    'avatar-default-symbolic',
                    () => this._startLogin(),
                    this,
                );
            }
        }

        /**
         * Fill the collapsed warnings section.
         *
         * @param {object} state A snapshot.
         */
        _syncWarnings(state) {
            const { _n } = this._i18n;

            this._warnings.menu.removeAll();

            const { lines, hidden } = healthLines(state);
            const total = lines.length + hidden;

            this._warnings.visible = total > 0;
            if (total === 0) return;

            this._warnings.label.text = _n('%d warning', '%d warnings', total).replace(
                '%d',
                String(total),
            );

            for (const line of lines) this._warnings.menu.addMenuItem(warningRow(line));

            // healthLines caps the list; say so rather than dropping the rest
            // silently, which would leave the count in the label disagreeing
            // with what is actually shown underneath it.
            if (hidden > 0)
                addDisabledRow(
                    this._warnings.menu,
                    _n('%d more', '%d more', hidden).replace('%d', String(hidden)),
                );
        }

        /** @param {object} state A snapshot. */
        _syncDevices(state) {
            this._devicesGeneration += 1;
            this._deviceSection.render(state);
        }

        /**
         * The device list.
         *
         * @param {object} menu The submenu to fill.
         * @param {object} state A snapshot.
         * @param {Function} open Drill into a device.
         */
        _renderDevices(menu, state, open) {
            const { _ } = this._i18n;

            const nodes = this._visibleNodes(state);

            if (nodes.length === 0) {
                addDisabledRow(menu, _('No devices'));
                return;
            }

            for (const node of nodes)
                menu.addMenuItem(
                    new ActionMenuItem(node.name, node.icon, () => open(node.id)),
                );
        }

        /**
         * The devices the preferences say to list.
         *
         * @param {object} state A snapshot.
         * @returns {object[]} Nodes.
         */
        _visibleNodes(state) {
            const showOffline = this._settings.get_boolean(KEYS.SHOW_OFFLINE_NODES);

            return state.nodes.filter(node => showOffline || node.online);
        }

        /**
         * What can be done to one device.
         *
         * @param {object} menu The submenu to fill.
         * @param {object} node A normalized node.
         * @param {object} state A snapshot.
         */
        _renderDeviceActions(menu, node, state) {
            const { _ } = this._i18n;

            const address = node.ips.at(0) ?? '';
            const fqdn =
                node.name && state.magicDNSSuffix
                    ? `${node.name}.${state.magicDNSSuffix}`
                    : node.name;

            if (address === '') {
                addDisabledRow(menu, _('No address'));
                return;
            }

            // Stays open: the answer arrives on this row a moment later, and a
            // closing menu takes it off screen before it can be read.
            menu.addMenuItem(
                new ActionMenuItem(
                    _('Ping'),
                    'network-transmit-receive-symbolic',
                    row => void this._pingDevice(node, row),
                ),
            );

            addRow(
                menu,
                _('Copy address'),
                'edit-copy-symbolic',
                () => copyText(address, this._gicon, this._i18n),
                this,
            );

            if (fqdn && fqdn !== node.name) {
                addRow(
                    menu,
                    _('Copy DNS name'),
                    'edit-copy-symbolic',
                    () => copyText(fqdn, this._gicon, this._i18n),
                    this,
                );
            }

            if (canReceive(node)) {
                addRow(
                    menu,
                    _('Send files…'),
                    'document-send-symbolic',
                    () => void this._sendFiles(node),
                    this,
                );
            }
        }

        /**
         * Ping a device and report the result on the row that asked.
         *
         * The answer replaces the row's own label rather than raising an OSD.
         * A latency is a thing to compare and re-read, and an OSD is gone in a
         * second and takes the menu's focus with it.
         *
         * @param {object} node A normalized node.
         * @param {object} row The menu item that was activated.
         * @returns {Promise<void>} Done.
         */
        async _pingDevice(node, row) {
            const { _ } = this._i18n;

            row.label.text = _('Pinging…');
            row.setSensitive(false);

            const generation = this._devicesGeneration;
            const result = await this._model.ping(node.ips.at(0) ?? '');

            // The section may have been rebuilt, or the extension disabled,
            // while the daemon waited for the peer to answer — in which case
            // this row has been destroyed and writing to it is a GJS critical.
            if (generation !== this._devicesGeneration) return;

            row.setSensitive(true);
            // Never _(''): gettext answers the empty string with the
            // catalog's header.
            if (result.ok) row.label.text = formatPing(result, this._i18n);
            else if (result.error) row.label.text = _(result.error);
            else row.label.text = _('No reply');
        }

        /**
         * Rebuild the Taildrop list.
         *
         * The eligible targets come from the daemon rather than from the peer
         * list, so this needs a request; it is issued when the menu opens
         * rather than on every state change, because nobody can act on a list
         * they cannot see and asking on each netmap update would be a request
         * per peer that blinks.
         *
         * @returns {Promise<void>} Done.
         */
        async _syncTaildrop() {
            const { _ } = this._i18n;

            const generation = ++this._taildropGeneration;
            const targets = sendTargets(
                this._model.state.nodes,
                await this._model.fileTargets(),
            );

            // A later listing, or a disable, has overtaken this one while the
            // request was in flight.
            if (generation !== this._taildropGeneration) return;

            this._taildrop.menu.removeAll();
            this._taildrop.visible = hasEligibleTarget(targets);
            if (!this._taildrop.visible) return;

            for (const { node, eligible, reason } of targets) {
                const item = new PopupMenu.PopupImageMenuItem(
                    eligible ? node.name : `${node.name} — ${_(reason)}`,
                    node.icon,
                );

                if (!eligible) {
                    item.setSensitive(false);
                } else {
                    item.connectObject(
                        'activate',
                        () => void this._sendFiles(node),
                        this,
                    );
                }

                this._taildrop.menu.addMenuItem(item);
            }
        }

        /**
         * List the files waiting to be saved.
         *
         * Fetched when the menu opens rather than on every state change: the
         * daemon holds them either way, and a request per netmap blink would
         * be noise.
         *
         * @returns {Promise<void>} Done.
         */
        async _syncInbox() {
            const { _n } = this._i18n;

            const generation = ++this._inboxGeneration;
            const files = await this._model.waitingFiles();
            if (generation !== this._inboxGeneration) return;

            this._inbox.menu.removeAll();
            this._inbox.visible = files.length > 0;
            if (!this._inbox.visible) return;

            this._inbox.label.text = _n(
                '%d received file',
                '%d received files',
                files.length,
            ).replace('%d', String(files.length));

            for (const file of files)
                this._inbox.menu.addMenuItem(
                    new ActionMenuItem(
                        `${file.name}  ·  ${formatSize(file.size)}`,
                        'document-save-symbolic',
                        row => void this._saveFile(file, row),
                    ),
                );
        }

        /**
         * Save one waiting file, reporting on its own row.
         *
         * Stays open, like Ping: the answer is a path, and a path is worth
         * reading rather than flashing past in an OSD.
         *
         * @param {object} file A waiting file.
         * @param {object} row The row that was activated.
         * @returns {Promise<void>} Done.
         */
        async _saveFile(file, row) {
            const { _ } = this._i18n;

            const generation = this._inboxGeneration;
            row.label.text = _('Saving %s…').replace('%s', file.name);
            row.setSensitive(false);

            const { path, error } = await this._model.saveFile(file.name);
            if (generation !== this._inboxGeneration) return;

            if (error) {
                row.setSensitive(true);
                row.label.text = _(error);
                return;
            }

            row.label.text = _('Saved to %s').replace('%s', path);
            showOsd(this._gicon, _('Saved %s').replace('%s', file.name));
        }

        /**
         * Choose files and send them.
         *
         * @param {object} node The node to send to.
         * @returns {Promise<void>} Done.
         */
        async _sendFiles(node) {
            const { _, _n } = this._i18n;

            // Only to a peer the daemon itself names as a target, whichever
            // row started this. A peer's own TaildropTarget can say available
            // while the daemon, which decides, does not list it — and asking
            // first means nobody picks files for a send that cannot happen.
            if (!isListedTarget(await this._model.fileTargets(), node.id)) {
                Main.notify(
                    _('Cannot send to %s').replace('%s', node.name),
                    _('Tailscale does not list it as able to receive files right now.'),
                );
                return;
            }

            let uris;
            try {
                uris = await this._chooseFiles({
                    title: _('Send to %s').replace('%s', node.name),
                });
            } catch (error) {
                // The portal rejects when xdg-desktop-portal is not installed
                // or not running. Unhandled, this was an unhandled rejection
                // and a click that did nothing and said nothing.
                console.warn(`[quickts] could not open a file chooser: ${error}`);
                Main.notifyError(
                    _('Could not open a file chooser'),
                    _('The desktop portal is not available.'),
                );
                return;
            }

            if (!uris || uris.length === 0) return;

            const { sent, failed } = await this._model.sendFiles(node.id, uris);

            if (sent > 0)
                showOsd(
                    this._gicon,
                    _n('Sent %d file to %s', 'Sent %d files to %s', sent)
                        .replace('%d', String(sent))
                        .replace('%s', node.name),
                );

            // Main.notify, not Main.notifyError: notifyError also copies its
            // text to the journal, and a node name and file names are
            // exactly what SECURITY.md promises stay out of it.
            if (failed.length > 0)
                Main.notify(
                    _('Could not send to %s').replace('%s', node.name),
                    failed.join(', '),
                );
        }

        /** @param {object} state A snapshot. */
        _syncOptions(state) {
            for (const { read, item } of this._switches)
                item.setToggleState(read(state));
        }

        /** @param {object} state A snapshot. */
        _syncProfiles(state) {
            this._profiles.menu.removeAll();

            // A single profile is the common case and a submenu offering only
            // the profile you are already using is noise.
            this._profiles.visible = state.profiles.length > 1;
            if (!this._profiles.visible) return;

            for (const profile of state.profiles) {
                addRow(
                    this._profiles.menu,
                    profile.name || profile.tailnet || profile.id,
                    profile.id === state.currentProfileId
                        ? 'object-select-symbolic'
                        : '',
                    () => void this._model.switchProfile(profile.id),
                    this,
                );
            }
        }

        /** Bring the tailnet up or down. */
        _onClicked() {
            const state = this._model.state;

            // With the backend waiting for a login, flipping WantRunning does
            // nothing a person would notice. Starting the login is what they
            // were asking for.
            if (needsLogin(state)) {
                void this._startLogin();
                return;
            }

            // Decided by the preference, not by whether the tailnet is up: a
            // tailnet that is starting, or waiting for an admin to approve
            // this machine, is on and not yet up, and a click has to be able
            // to turn it off.
            void this._model.setRunning(!state.running);
        }

        /** Ask the daemon for a login URL, and remember that we want it. */
        async _startLogin() {
            this._loginRequested = true;

            // The URL may already be known, in which case there is nothing to
            // wait for.
            this._maybeOpenAuthUrl(this._model.state);

            await this._model.login();

            // Cleared if the login got nowhere — a 403 for a non-operator, a
            // daemon that went away. Left set, the flag outlives the attempt
            // and the next AuthURL to appear for any reason at all, hours
            // later, opens a browser nobody asked for.
            if (!this._model.state.reachable) this._loginRequested = false;
        }

        /**
         * @param {boolean} open Whether the menu is now open.
         */
        _onOpenStateChanged(open) {
            this._model.setMenuOpen(open);
            this._cancelRemeasure();

            if (!open) {
                // Reopening should land on the lists, not wherever the last
                // visit wandered to.
                const wandered = [this._deviceSection, this._exitNodeSection]
                    .map(section => section.reset())
                    .some(Boolean);
                if (wandered) this.sync(this._model.state);
                return;
            }

            this._applyMaxHeight();
            this._remeasureOnceLaidOut();
            void this._syncTaildrop();
            void this._syncInbox();
            void this._exitNodeSection.menuOpened(this._model.state);
        }

        /**
         * Clamp the menu to the room below it.
         *
         * The Shell already implements the scrolling; js/ui/popupMenu.js says
         * the scrollbar "will only take effect if a CSS max-height is set on
         * the top menu", and PopupSubMenu._needsScrollbar reads exactly that
         * from the theme node. So this sets the max-height and touches nothing
         * private.
         */
        _applyMaxHeight() {
            const monitor = Main.layoutManager.primaryIndex;
            const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor);
            const [, top] = this.menu.actor.get_transformed_position();

            this.menu.actor.style = maxHeightStyle(
                menuMaxHeight({
                    workAreaY: workArea.y,
                    workAreaHeight: workArea.height,
                    top,
                    margins:
                        (this.menu.actor.margin_top ?? 0) +
                        (this.menu.actor.margin_bottom ?? 0),
                    scaleFactor: St.ThemeContext.get_for_stage(global.stage)
                        .scale_factor,
                    capPx: this._settings.get_int(KEYS.MAX_MENU_HEIGHT),
                }),
            );
        }

        /**
         * Measure the height again once the menu has actually been laid out.
         *
         * Opened from the keybinding, quick settings and this menu open in
         * the same breath, and the position read in _applyMaxHeight is from
         * before the Shell has allocated either — on the first open of a
         * session it is 0, and the menu is allowed to run off the bottom of
         * the screen. The first allocation after opening carries the real
         * position. The style is set from a BEFORE_REDRAW later rather than
         * from the allocation notification itself, so it does not change
         * layout in the middle of a layout pass; St ignores a style that has
         * not changed, so when the first reading was right this costs
         * nothing.
         */
        _remeasureOnceLaidOut() {
            const actor = this.menu.actor;

            this._allocationId = actor.connect('notify::allocation', () => {
                actor.disconnect(this._allocationId);
                this._allocationId = 0;

                this._laterId = global.compositor
                    .get_laters()
                    .add(Meta.LaterType.BEFORE_REDRAW, () => {
                        this._laterId = 0;
                        this._applyMaxHeight();
                        return false;
                    });
            });
        }

        /** Drop a re-measure that has not happened yet. */
        _cancelRemeasure() {
            if (this._allocationId) this.menu.actor.disconnect(this._allocationId);
            this._allocationId = 0;

            if (this._laterId) global.compositor.get_laters().remove(this._laterId);
            this._laterId = 0;
        }

        destroy() {
            // Invalidates any async handler still waiting — a ping, a Taildrop
            // listing — so it cannot write into the rows about to be torn down.
            this._devicesGeneration += 1;
            this._taildropGeneration += 1;
            this._inboxGeneration += 1;
            this._exitNodeSection.destroy();

            this._cancelRemeasure();

            // The rows carry handlers of their own — every activate, every
            // toggled, every long-press gesture — and disconnectObject on the
            // menu does not reach them, because they are connected on the rows.
            // removeAll() destroys each row, and destroying an actor drops its
            // handlers, which is what actually empties the set. Without this,
            // a disable leaves one handler per visible row connected.
            this.menu.removeAll();

            this.menu.disconnectObject(this);
            this.disconnectObject(this);

            // The Shell parents this menu into the quick settings overlay and
            // never destroys it (Shell 50.3 quickSettings.js has no destroy
            // call), so without this every disable — every screen lock —
            // would leave the menu behind, and with it the overlay's
            // open-state-changed closure that still reaches this toggle, the
            // model and the transport.
            this.menu.destroy();
            super.destroy();
        }
    },
);

/** Owns the indicator, the toggle and the keybinding for one enable. */
export class Panel {
    /**
     * @param {object} options Options.
     * @param {object} options.model The store.
     * @param {object} options.settings This extension's GSettings.
     * @param {string} options.iconPath Absolute path to the tile icon.
     * @param {(message: string) => string} [options.gettext] Translation function.
     * @param {(singular: string, plural: string, count: number) => string} [options.ngettext]
     *   Plural-aware translation. Plural forms are not "%d warning" with an s
     *   bolted on: several languages have more than two, and some have none.
     * @param {Function} [options.chooseFiles] Opens the portal's file chooser.
     */
    constructor({ model, settings, iconPath, gettext, ngettext, chooseFiles }) {
        this._model = model;
        this._settings = settings;
        this._iconPath = iconPath;
        this._chooseFiles = chooseFiles ?? (() => Promise.resolve([]));
        this._disposers = [];
        this._bindings = [];

        this._i18n = Object.freeze({
            _: gettext ?? (message => message),
            _n:
                ngettext ??
                ((singular, plural, count) => (count === 1 ? singular : plural)),
        });
    }

    /** Build the tile and register the keybinding. */
    enable() {
        const gicon = Gio.icon_new_for_string(this._iconPath);

        this._indicator = new QuickTSIndicator(gicon);
        this._toggle = new QuickTSToggle({
            gicon,
            model: this._model,
            settings: this._settings,
            chooseFiles: this._chooseFiles,
            i18n: this._i18n,
        });

        this._indicator.quickSettingsItems.push(this._toggle);

        // The supported placement API, which puts the tile where the Shell
        // wants it relative to brightness and background apps, rather than
        // reaching into the private _indicators list.
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

        this._disposers.push(
            this._model.subscribe((state, fields) => {
                this._indicator.sync(state);
                this._toggle.sync(state, fields);
            }),
        );

        // Rebuild when a preference that changes what is listed moves.
        for (const key of [KEYS.SHOW_OFFLINE_NODES, KEYS.SHOW_MULLVAD]) {
            const id = this._settings.connect(`changed::${key}`, () =>
                this._toggle.sync(this._model.state),
            );
            this._disposers.push(() => this._settings.disconnect(id));
        }

        this._bindKeybinding();

        this._indicator.sync(this._model.state);
        this._toggle.sync(this._model.state);
    }

    /** Register the shortcut that opens the menu. */
    _bindKeybinding() {
        // addKeybinding returns NONE when Mutter refuses the binding, which it
        // does when a keybinding of the same NAME is already registered —
        // Mutter's names are global across the Shell, hence the quickts-
        // prefix on the key. It does not check whether the accelerator
        // collides with another. Recording a key that was never registered
        // makes disable() call removeKeybinding on it, and the Shell warns.
        const action = Main.wm.addKeybinding(
            SHORTCUT_KEYS.OPEN_MENU,
            this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._openMenu(),
        );

        if (action === Meta.KeyBindingAction.NONE) {
            console.warn(`[quickts] could not bind ${SHORTCUT_KEYS.OPEN_MENU}`);
            return;
        }

        this._bindings.push(SHORTCUT_KEYS.OPEN_MENU);
    }

    /** Open quick settings with this tile's menu expanded. */
    _openMenu() {
        const quickSettings = Main.panel.statusArea.quickSettings;

        // The same guard js/ui/panel.js applies before toggling: the tile is
        // not there to open during the lock screen or the login greeter.
        if (!quickSettings?.mapped || !quickSettings.reactive) return;

        if (!quickSettings.menu.isOpen) Main.panel.toggleQuickSettings();

        this._toggle.menu.open(BoxPointer.PopupAnimation.FULL);
    }

    /** Release everything. */
    disable() {
        for (const key of this._bindings) Main.wm.removeKeybinding(key);
        this._bindings = [];

        for (const dispose of this._disposers) dispose();
        this._disposers = [];

        this._toggle?.destroy();
        this._toggle = null;

        this._indicator?.destroy();
        this._indicator = null;
    }
}

/**
 * The subtitle text for a state.
 *
 * modules/health.js decides what the subtitle is about; the wording is chosen
 * here, where gettext is available and a translator can see whole sentences
 * rather than fragments.
 *
 * @param {object} state A snapshot.
 * @param {{_: Function, _n: Function}} i18n gettext and ngettext.
 * @returns {string} A subtitle.
 */
function subtitleFor(state, { _, _n }) {
    const { kind, value } = summaryOf(state);

    switch (kind) {
        case SUMMARY.ERROR:
            return _(problemOf(state)?.message ?? 'Not connected');
        case SUMMARY.NEEDS_LOGIN:
            return _('Not logged in');
        case SUMMARY.IN_USE:
            return _('In use by another user');
        case SUMMARY.STARTING:
            return _('Connecting…');
        case SUMMARY.NEEDS_APPROVAL:
            return _('Waiting for approval');
        case SUMMARY.OFF:
            return _('Off');
        case SUMMARY.EXIT_NODE:
            // An automatic exit node has an id but no name to show.
            return value
                ? _('via %s').replace('%s', String(value))
                : _('via an exit node');
        case SUMMARY.WARNINGS:
            return _n('%d warning', '%d warnings', value).replace('%d', String(value));
        default:
            return String(value ?? '');
    }
}

/**
 * A ping result, as a row label.
 *
 * The route matters as much as the number on a tailnet: the same peer at the
 * same latency is a different situation depending on whether the packets went
 * straight there or through one of Tailscale's relays.
 *
 * Each case is one whole template, so a translator sees the sentence rather
 * than fragments glued together with a comma this code chose.
 *
 * @param {object} result From modules/ping.js.
 * @param {{_: Function}} i18n gettext.
 * @returns {string} A label.
 */
function formatPing(result, { _ }) {
    const latency = String(result.latencyMs);

    if (result.route === ROUTE.DIRECT) return _('%s ms, direct').replace('%s', latency);
    if (result.route === ROUTE.RELAY && result.relay)
        return _('%s ms, relayed via %s')
            .replace('%s', latency)
            .replace('%s', result.relay);
    if (result.route === ROUTE.RELAY) return _('%s ms, relayed').replace('%s', latency);

    return _('%s ms').replace('%s', latency);
}
