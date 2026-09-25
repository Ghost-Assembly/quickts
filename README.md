# QuickTS

Tailscale in the GNOME quick settings menu.

Toggle the tailnet, pick an exit node, switch between profiles, copy a node's
address and send a file over Taildrop, without leaving the panel.

**[Documentation →](https://ghost-assembly.github.io/quickts/)** — architecture,
testing, packaging and releasing.

## Requires

- GNOME Shell 50
- Tailscale 1.82 or later — the first release whose `/status` says which
  peers can receive a file. Developed and checked against 1.102.
- Your user set as the Tailscale operator:

```bash
sudo tailscale set --operator=$USER
```

Without that, the daemon refuses the socket and QuickTS says so in the menu
rather than showing a tailnet that is silently disconnected.

## Install

```bash
curl -LO https://github.com/Ghost-Assembly/quickts/releases/latest/download/quickts@napalm255.github.io.shell-extension.zip
gnome-extensions install --force quickts@napalm255.github.io.shell-extension.zip
gnome-extensions enable quickts@napalm255.github.io
```

From a clone:

```bash
just setup
just install
just enable
```

## Develop

```bash
just              # list every recipe
just test         # unit suite
just test-docs    # the docs site, in Chromium and Firefox
just lint         # eslint, prettier, gschema, shellcheck
just ci           # what CI runs: lint, tests, docs, security, build
just test-live    # headless Shell, bundle and LocalAPI checks; needs a real
                  # gnome-shell and a running tailscaled (it may be stopped,
                  # but the daemon must answer)
just docs         # serve the documentation site
```

The suite runs on plain Node. Every decision QuickTS makes lives in a pure
module under `modules/`, and the files that touch GNOME or libsoup are kept
deliberately free of branching: `modules/io.js` for the daemon, and
`modules/panel.js` with the menu sections it builds (`exit-node-section.js`,
`device-section.js`, `taildrop-section.js`, on top of `menu-items.js` and
`navigable-section.js`) — see the
[architecture notes](https://ghost-assembly.github.io/quickts/#architecture).

## Releasing

Set the version in `metadata.json` (`version-name`) and `package.json`, commit,
then tag and push. The release workflow refuses a tag that disagrees with
either file.

## License

GPL-3.0-or-later.
