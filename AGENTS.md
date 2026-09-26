# Working on QuickTS

QuickTS is a GNOME Shell extension: Tailscale in Quick Settings — toggle the
tailnet, pick an exit node, switch profiles, ping nodes and send or receive
Taildrop files. README.md is for humans; this file holds the rules an agent
working in this repository must not break.

## What gets published

- A GitHub Release per tag: the installable
  `quickts@napalm255.github.io.shell-extension.zip`, built by `just build`
  and attached by `.github/workflows/release.yml`, gated on `just ci`
  passing first. A tag whose version disagrees with `metadata.json`'s
  `version-name` or `package.json`'s `version` is refused.
- The documentation site at `https://ghost-assembly.com/quickts/` (the old
  `ghost-assembly.github.io` URL 301s there), served from this repository's
  `docs/` folder on `main` through GitHub Pages.
- Nothing is uploaded to extensions.gnome.org from CI — that needs the
  account password and goes through human review either way.
- The one-liner — "Tailscale in Quick Settings: toggle the tailnet, pick an
  exit node, switch profiles, ping nodes and send or receive Taildrop
  files." — must stay identical in README.md's opening line,
  `metadata.json`'s `description`, the Ghost Assembly hub card, the hub's
  profile row, and this repository's GitHub "About" description. See
  **Cross-repo duties**.

## Commands

Table from the shared `justfile` and this repository's own `project.just`.
Run `just ci` before claiming anything done.

| Recipe                                                   | Does                                                                                                                                                        | Needs                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `just setup`                                             | `mise install`, `npm ci`, Playwright's browsers, checks for `gjs`, `glib-compile-schemas`, `gnome-shell`, `gnome-extensions`, `rsync`, `zip`, `unzip`, `jq` | —                                            |
| `just fmt`                                               | `prettier --write` + `eslint --fix`                                                                                                                         | —                                            |
| `just lint`                                              | `template-check`, eslint, prettier `--check`, `glib-compile-schemas --strict --dry-run`, shellcheck                                                         | —                                            |
| `just template-check`                                    | Diffs the shared template files against `template.sha256`; `--write` regenerates it                                                                         | —                                            |
| `just test`                                              | The Vitest unit suite                                                                                                                                       | —                                            |
| `just test-docs`                                         | The docs site in Chromium and Firefox (Playwright + axe)                                                                                                    | —                                            |
| `just coverage`                                          | The unit suite with a coverage report                                                                                                                       | —                                            |
| `just security`                                          | osv-scanner, gitleaks, trivy, actionlint, zizmor                                                                                                            | —                                            |
| `just build`                                             | The installable zip                                                                                                                                         | —                                            |
| `just ci`                                                | `lint test test-docs security build` — what CI runs, and the required status check                                                                          | —                                            |
| `just test-live`                                         | Builds, then `scripts/headless-check.sh`, `scripts/pack-check.sh`, and `live-extra` (`project.just`)                                                        | A real headless `gnome-shell`; not run in CI |
| `just localapi-check`                                    | `scripts/localapi-check.sh`: runs `modules/io.js` under plain `gjs` against this machine's `tailscaled`                                                     | A reachable `tailscaled`; not run in CI      |
| `just pack-check`                                        | Compares the built zip against `gnome-extensions pack`'s output                                                                                             | —                                            |
| `just run`                                               | `gnome-shell --devkit --wayland` in a window                                                                                                                | `mutter-devkit`, a real Shell session        |
| `just install` / `enable` / `disable` / `prefs` / `logs` | Install into `~/.local/share/gnome-shell/extensions`, toggle it, open preferences, follow its log                                                           | A real GNOME Shell session                   |
| `just docs`                                              | Serves `docs/` on `localhost:8000`                                                                                                                          | —                                            |
| `just clean`                                             | Removes build and test output                                                                                                                               | —                                            |

`just test-live`'s `live-extra` (defined in `project.just`) is
`localapi-check`, so a live daemon check runs as part of `test-live` too.

## Hard constraints

- **The uuid is fixed.** `quickts@napalm255.github.io`, read out of
  `metadata.json` by the `justfile`'s `_uuid` and never written down a
  second time. The site domain may change (see **What gets published**);
  this never does. The keybinding it registers is prefixed the same way:
  `quickts-open-menu`, because Mutter keeps one table of keybinding names
  for the whole Shell and refuses a name already claimed by another
  extension.
- **Be the Tailscale operator.** `sudo tailscale set --operator=$USER` is
  not optional: without it the daemon answers every write with a `403`,
  and LocalAPI gives QuickTS no other way to act on the tailnet — the menu
  can only say so and offer the command.
- **The LocalAPI contract.** `modules/localapi.js` builds every request
  (path, body, what gets percent-encoded) as a pure decision; `modules/io.js`
  is the only file that carries one out, over Soup, against
  `tailscaled`'s Unix socket — never a subprocess of the `tailscale` CLI.
  `just localapi-check` runs `io.js` under plain `gjs` against the real
  daemon and is the one check that catches Tailscale changing its JSON; it
  exits 1 if `tailscaled` is not reachable, and is run again from
  `just test-live` through project.just's `live-extra`.
- **A received file's name is validated, and a save is exclusive.**
  `modules/inbox.js`'s `isSafeFileName` refuses a name containing `/` or a
  NUL byte, or starting with `.` — the sender chose it, not QuickTS.
  `modules/io.js`'s `saveFile` then creates each candidate name with
  `Gio.FileCreateFlags.NONE` (`O_CREAT|O_EXCL`), which fails on anything
  already there, including a symlink — so nothing planted in the download
  directory is ever followed or overwritten.
- **Every translatable string is a literal.** `tests/i18n.test.js`
  (`tests/support/i18n.js`'s `nonLiteralGettextCalls`) fails if any `_()`
  call's message, or either of `_n()`'s two arguments, is a variable,
  property access or template rather than a string literal — invisible to
  `xgettext -k_ -k_n:1,2` exactly the same way a translator would never
  see it.
- **No JavaScript on the docs pages.** `docs/index.html` ships no
  `<script>`; `just test-docs` fails the build if one appears.
- **The shared template files are byte-locked.** Everything in
  `template.list` — here, the full 29-path list every Ghost Assembly
  extension can carry — is identical, byte for byte, across every
  repository that shares it, and is checked by `just template-check`. Do
  not hand-edit one; see **Template files**.

## Tests

Write the failing test first (RED → GREEN). Layers:

- **Vitest** (`just test`) — every module under `modules/`, `extension.js`
  and `prefs.js` run exactly as shipped. `prefs.js` (Adw/Gtk widget
  construction) and `modules/io.js` (Soup/Gio plumbing, checked instead
  against the real daemon) are excluded from coverage — identically in
  `vitest.config.js` and `sonar-project.properties`. Stubs for `gi://` and
  `resource:///` imports live in `tests/stubs/`; a fake daemon and a small
  fake Shell world are in `tests/support/`.
- **`just localapi-check`** (`scripts/localapi-check.js`, under plain
  `gjs`) — exercises `modules/io.js` against this machine's `tailscaled`.
  No stub can prove anything about the daemon's real JSON; this can.
- **`just test-live`** (not in CI — needs a real headless `gnome-shell`) —
  `scripts/headless-check.sh` enables, disables and re-enables the real
  extension and fails on a JavaScript error or a lifetime warning, then
  `scripts/pack-check.sh` diffs the built zip against
  `gnome-extensions pack`, then `live-extra` (`localapi-check`).
- **`just test-docs`** (Playwright, Chromium and Firefox) — the docs
  site's rules: axe in both color schemes, no JavaScript, no request to
  another origin, no sideways scroll at 360px.

## Conventions

- Conventional Commits, imperative subject, no trailing period.
- `main` is protected: no direct pushes, no force-pushes, no merge
  commits — every PR lands through a squash merge, and the `ci` status
  check must pass first.
- Third-party GitHub Actions pinned by commit SHA, never a tag.
- American English throughout: prose, comments, identifiers, commit
  messages.
- "Quick Settings" (capitalized, it is GNOME's product name) in prose,
  `metadata.json`'s description, the gschema's summaries and descriptions,
  and the label/detail text `modules/settings.js` hands to `prefs.js` —
  code identifiers (`show-offline-nodes`, and the like) unchanged.
- Nothing personal anywhere in code, tests, fixtures or docs.
- Committed docs: `README.md`, `AGENTS.md` (this file), `CLAUDE.md`
  (exactly `@AGENTS.md`, so an agent reading either finds the same rules),
  `SECURITY.md`, and the site under `docs/`. Nothing else is the source of
  truth for a rule stated here.

## Cross-repo duties

This repository is one of several under Ghost Assembly. Keep these in sync
with the one-liner above whenever it changes:

- The QuickTS card on the Ghost Assembly hub site, and its `site.spec.js`
  check.
- The QuickTS row on the maintainer's profile.
- The GitHub repository's About description and homepage URL.
- The shared template files in `template.list`: a deliberate change to one
  of them is made in every extension repository together, then
  `just template-check --write` regenerates `template.sha256` in each.

The site domain is `https://ghost-assembly.com/`; the old
`ghost-assembly.github.io` URLs 301 there. Replace only that literal host
if you find it — the extension uuid (`@napalm255.github.io`) is a
different string and must not change.

## Template files

`template.list` here is the full 29-path list shared, byte for byte, across
every Ghost Assembly GNOME Shell extension — unlike some `quick*` repos,
QuickTS carries every entry rather than a project-specific subset.
`just template-check` verifies them against `template.sha256`.

Project-specific files that are _not_ in `template.list`, and so are free
to edit here without touching another repository, include `project.just`
(the `localapi-check` and `live-extra` recipes), `docs/project.css` (this
project's additions to the shared docs stylesheet), `tests/docs.config.js`
(this site's title, URL and section list) and `scripts/headless-check.sh`,
`scripts/localapi-check.sh` / `.js` (this project's own live checks; the
generic frame they build on is not itself in `template.list`).

`tests/stubs/` holds thirteen fakes for GI namespaces and Shell classes.
Ten are template-locked (`gi-glib.js`, `gi-gobject.js`, `gi-meta.js`,
`gi-pango.js`, `gi-shell.js`, `gi-st.js`, `shell-extension.js`,
`shell-main.js`, `shell-popupmenu.js`, `shell-quicksettings.js`) and must
not be hand-edited here. The other three — `gi-clutter.js`, `gi-gio.js`,
`shell-boxpointer.js` — are QuickTS's own and can be changed freely; so is
`tests/support/daemon.js`, `tests/support/i18n.js`, `tests/support/panel.js`
and `tests/support/world.js` (`tests/support/actors.js` is template-locked).

## Settings keys

`modules/settings.js` is the single source of truth: `KEYS` (the schema
key names), `SHORTCUT_KEYS` (the one accelerator key), and `SETTINGS` (each
key's gschema type plus the untranslated label and detail text `prefs.js`
builds every row from). It imports nothing, so `tests/settings.test.js`
checks it on plain Node against the gschema.

Adding, renaming or removing a setting means updating all three together,
in this order, or the cross-check test fails:

1. `schemas/org.gnome.shell.extensions.quickts.gschema.xml` — the type,
   default, summary and description (and `<range>` for `max-menu-height`,
   currently 0–2000).
2. `modules/settings.js` — the key constant, its `SETTINGS` entry, and any
   place in `modules/panel.js` or `prefs.js` that reads it through `KEYS`
   or `SHORTCUT_KEYS`.
3. `prefs.js` — only if the widget it needs is not already covered by
   `describe()`'s label/detail lookup (`Adw.SpinRow` needs its own
   `Gtk.Adjustment` bounds, kept equal to the gschema's `<range>`).

`AdvertiseRoutes` (the advertised-subnets row in preferences) is
deliberately **not** a settings key: it reads and writes the daemon's own
preference directly (`modules/routes.js`, `modules/localapi.js`'s
`prefsRequest`/`patchPrefsRequest`), because mirroring it into a schema key
would be a second source of truth that drifts the first time anyone runs
`tailscale set`.
