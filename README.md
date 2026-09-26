# QuickTS

Tailscale in Quick Settings: toggle the tailnet, pick an exit node, switch
profiles, ping nodes and send or receive Taildrop files.

Copy a node's address or DNS name, and switch between accounts, all without
leaving the panel.

**[Documentation →](https://ghost-assembly.com/quickts/)** — architecture,
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

A newly installed extension is picked up when the Shell next starts; on
Wayland, log out and back in.

## Development

```bash
just              # list every recipe
just test         # unit suite
just test-docs    # the docs site, in Chromium and Firefox
just lint         # eslint, prettier, gschema, shellcheck
just ci           # what CI runs: lint, test, test-docs, security, build
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
[architecture notes](https://ghost-assembly.com/quickts/#architecture).

## Releasing

Set `version-name` in `metadata.json` and `version` in `package.json`,
commit, then tag and push; the release workflow checks the tag against both
files before building.

```bash
git tag -a v0.1.1 -m 'release v0.1.1'
git push origin v0.1.1
```

## License

GPL-3.0-or-later.
