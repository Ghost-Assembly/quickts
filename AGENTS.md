# Working on QuickTS

QuickTS is a GNOME Shell extension: Tailscale in Quick Settings — toggle the
tailnet, pick an exit node, switch profiles, ping nodes and send or receive
Taildrop files. README.md is for humans; this file holds the rules an agent
working in this repository must not break.

## What gets published

- `just build` produces `quickts@napalm255.github.io.shell-extension.zip`.
  A `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which verifies
  version agreement, main ancestry, and successful CI for the exact commit,
  then publishes that tested artifact without rebuilding it.
- Docs at https://ghost-assembly.com/quickts/ are deployed by the Pages
  workflow from the tested `docs/` artifact after all required checks pass on main.
- GNOME Extension Store submission and review remain manual.
- The one-liner — "Tailscale in Quick Settings: toggle the tailnet, pick an
  exit node, switch profiles, ping nodes and send or receive Taildrop
  files." — must stay identical in README.md's opening line,
  `metadata.json`'s `description`, the Ghost Assembly hub card, the hub's
  profile row, and this repository's GitHub "About" description. See
  **Cross-repo duties**.

## Commands

Tool versions live in `mise.toml`; common commands live in the canonical
`justfile`; project-specific commands and hooks live in `project.just`.
Run `just ci` before claiming a change works.

| Command                                                                | Does                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `just setup`                                                           | Install pinned tools, npm development dependencies, and Chromium/Firefox; check host tools      |
| `just fmt`                                                             | Format JavaScript, Python, configuration, and generated documentation                           |
| `just lint`                                                            | Verify canonical files, generated docs, ESLint, Prettier, Ruff, schemas, and shell scripts      |
| `just template-check`                                                  | Compare managed files with the immutable GitHub revision in `quick-template.lock.json`          |
| `just template-sync SHA`                                               | Synchronize a reviewed canonical revision; then install dependencies and regenerate docs        |
| `just test`                                                            | Run Vitest, Python tooling tests, and project offline integration tests                         |
| `just coverage`                                                        | Measure all runtime JavaScript, including untested files                                        |
| `just test-docs`                                                       | Check docs in Chromium and Firefox, including axe accessibility audits                          |
| `just security`                                                        | Run OSV, source and history secret scans, Trivy, actionlint, and Zizmor                         |
| `just build`                                                           | Build a deterministic runtime-only ZIP with Python's standard library                           |
| `just pack-check`                                                      | Compare every ZIP filename and byte with GNOME's official packer; validate icons                |
| `just test-live`                                                       | Check packaging, then isolated GNOME lifecycle and project integration hooks                    |
| `just run`                                                             | Run GNOME Shell in a development window                                                         |
| `just install` / `enable` / `disable` / `uninstall` / `prefs` / `logs` | Work with the extension in your logged-in session                                               |
| `just docs`                                                            | Serve the static site at localhost:8000                                                         |
| `just ci`                                                              | Run lint, tests, coverage, docs, security, and packaging; GitHub also requires CodeQL and Sonar |
| `just clean`                                                           | Confirm before removing generated build and test output                                         |

Live checks require an installed GNOME Shell and run outside hosted CI.
Complete the manual checklist and test each declared GNOME version before releasing.

Project command: `just localapi-check` probes this machine's `tailscaled`
through the real GJS client. `test-live` requires this daemon check to pass.

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
  (`tests/support/i18n.js`'s `nonLiteralGettextCalls`) reads the source of
  every file under `modules/`, `prefs.js` and `extension.js`, and fails if
  any `_()` call's message, or either of `_n()`'s two arguments, is a
  variable, property access or template rather than a string literal —
  invisible to `xgettext -k_ -k_n:1,2` exactly the same way a translator
  would never see it.
- **No JavaScript on the docs pages.** `docs/index.html` ships no
  `<script>`; `just test-docs` fails the build if one appears.
- Shared tooling comes from the pinned canonical `quick-template` revision.
  Keep local hooks in `project.just` and generated documentation current.

## Tests

Write the failing test first (RED → GREEN). Layers:

- `just test` uses Vitest with recording GNOME stubs; `just coverage`
  measures all runtime JavaScript, including untested files. Native and live
  integration checks remain separate from that coverage report.
- **`just localapi-check`** (`scripts/localapi-check.js`, under plain
  `gjs`) — exercises `modules/io.js` against this machine's `tailscaled`.
  No stub can prove anything about the daemon's real JSON; this can.
- **`just test-live`** (not in CI — needs a real headless `gnome-shell`) —
  `scripts/headless-check.sh` enables, disables and re-enables the real
  extension and fails on a JavaScript error or a lifetime warning, then
  `scripts/build.py --check` diffs the built zip against
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
- Shared tooling comes from the pinned canonical `quick-template` revision.
  Keep local hooks in `project.just` and generated documentation current.

## Template files

`quick-template.lock.json` pins a full commit SHA from
`Ghost-Assembly/quick-template`. `just template-check` compares managed files
with that immutable GitHub archive; a local manifest cannot approve drift.
Change shared tooling in the canonical repository, then run
`just template-sync SHA`, `npm ci --ignore-scripts`, `just docs-generate`, and
`just ci` in this checkout. The weekly freshness check reports newer approved
releases without adopting them automatically.

Project hooks belong in `project.just`, runtime packaging inputs in
`quick-project.json`, documentation identity in `docs/project.json`, and local
styling in `docs/project.css`. Common README and site sections are generated;
keep extension-specific content outside their markers. Lifecycle test scripts
remain specific to the extension.

## Settings keys

`modules/settings.js` is the single source of truth: `KEYS` (the schema
key names), `SHORTCUT_KEYS` (the one accelerator key), `SETTINGS` (each
key's gschema type), and `settingText` (the label and detail `prefs.js`
builds every row from, each a literal `_()` call). It imports nothing, so
`tests/settings.test.js` checks it on plain Node against the gschema.

Adding, renaming or removing a setting means updating all three together,
in this order, or the cross-check test fails:

1. `schemas/org.gnome.shell.extensions.quickts.gschema.xml` — the type,
   default, summary and description (and `<range>` for `max-menu-height`,
   currently 0–2000).
2. `modules/settings.js` — the key constant, its `SETTINGS` entry, its
   `settingText` case, and any place in `modules/panel.js` or `prefs.js`
   that reads it through `KEYS` or `SHORTCUT_KEYS`.
3. `prefs.js` — only if the widget it needs is not already covered by
   `settingText`'s label/detail lookup (`Adw.SpinRow` needs its own
   `Gtk.Adjustment` bounds, kept equal to the gschema's `<range>`).

`AdvertiseRoutes` (the advertised-subnets row in preferences) is
deliberately **not** a settings key: it reads and writes the daemon's own
preference directly (`modules/routes.js`, `modules/localapi.js`'s
`prefsRequest`/`patchPrefsRequest`), because mirroring it into a schema key
would be a second source of truth that drifts the first time anyone runs
`tailscale set`.
