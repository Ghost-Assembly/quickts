# QuickTS

<!-- quick-template:badges:start -->

[![CI](https://github.com/Ghost-Assembly/quickts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Ghost-Assembly/quickts/actions/workflows/ci.yml)
[![Security](https://github.com/Ghost-Assembly/quickts/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/Ghost-Assembly/quickts/actions/workflows/security.yml)
[![Docs](https://img.shields.io/website?url=https%3A%2F%2Fghost-assembly.com%2Fquickts%2F&label=docs)](https://ghost-assembly.com/quickts/)
[![Release](https://img.shields.io/github/v/release/Ghost-Assembly/quickts)](https://github.com/Ghost-Assembly/quickts/releases/latest)
[![License](https://img.shields.io/github/license/Ghost-Assembly/quickts)](https://github.com/Ghost-Assembly/quickts/blob/main/LICENSE)
[![GNOME](https://img.shields.io/badge/GNOME-50-blue)](https://ghost-assembly.com/quickts/#install)
[![Security issues](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickts%26metricKeys%3Dsoftware_quality_security_issues&query=%24.component.measures%5B0%5D.value&label=Security+issues)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickts)
[![Reliability issues](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickts%26metricKeys%3Dsoftware_quality_reliability_issues&query=%24.component.measures%5B0%5D.value&label=Reliability+issues)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickts)
[![Maintainability issues](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickts%26metricKeys%3Dsoftware_quality_maintainability_issues&query=%24.component.measures%5B0%5D.value&label=Maintainability+issues)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickts)
[![Duplication](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickts%26metricKeys%3Dduplicated_lines_density&query=%24.component.measures%5B0%5D.value&label=Duplication)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickts)
[![Coverage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fsonarcloud.io%2Fapi%2Fmeasures%2Fcomponent%3Fcomponent%3DGhost-Assembly_quickts%26metricKeys%3Dcoverage&query=%24.component.measures%5B0%5D.value&label=Coverage)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickts)
[![Sonar policy](https://github.com/Ghost-Assembly/quickts/actions/workflows/sonar.yml/badge.svg?branch=main)](https://sonarcloud.io/dashboard?id=Ghost-Assembly_quickts)
<!-- quick-template:badges:end -->

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

Without it the daemon refuses every change with a `403`. QuickTS says so in
the menu and offers the command, rather than leaving a switch that silently
flips back.

## Install

<!-- quick-template:install:start -->

Requires GNOME Shell 50. Requires Tailscale 1.82 or later and your user configured as the Tailscale operator. The live LocalAPI check requires a responding tailscaled daemon.

### From a release

Download the latest release ZIP and install it for your user. xh is a download tool; you can also download the ZIP from GitHub in a browser. Installing compiles the settings schema.

```sh
xh --download GET https://github.com/Ghost-Assembly/quickts/releases/latest/download/quickts@napalm255.github.io.shell-extension.zip
gnome-extensions install --force quickts@napalm255.github.io.shell-extension.zip
```

Log out and back in so GNOME discovers the extension, then enable it:

```sh
gnome-extensions enable quickts@napalm255.github.io
```

### From a clone

Install mise and activate it in your shell. Clone the repository, install its pinned tools, and build and install the same ZIP used for releases:

```sh
git clone https://github.com/Ghost-Assembly/quickts.git
cd quickts
mise install
mise exec -- just setup
mise exec -- just install
```

Log out and back in, then run just enable. Run just prefs to open preferences. After updating a loaded extension, start a new session to load its new code; opening preferences does not reload GNOME Shell.
<!-- quick-template:install:end -->

## Uninstall

<!-- quick-template:uninstall:start -->

Disable and uninstall the extension for your user. These commands preserve saved settings and other user data.

```sh
gnome-extensions disable quickts@napalm255.github.io
gnome-extensions uninstall quickts@napalm255.github.io
```

From a clone, just uninstall performs the same steps. Disabling with just disable leaves the extension installed.
<!-- quick-template:uninstall:end -->

## Testing

<!-- quick-template:testing:start -->

just test runs the JavaScript suite with Vitest, the shared tooling tests, and any project-specific offline suites. just coverage reports runtime JavaScript and Python tooling coverage, including untested files. Test stubs and generated reports are not runtime source.

just test-docs runs Playwright and axe in Chromium and Firefox: dark and light accessibility checks, keyboard navigation, mobile layout, reduced motion, links, metadata, local assets, and no page JavaScript. Automated accessibility checks still require human review of reading and focus order.

just test-live checks the package and runs isolated GNOME lifecycle checks. It is a separate local check, not proof of compatibility from a hosted runner. Verify each declared GNOME version and complete the project's manual checks before releasing.
<!-- quick-template:testing:end -->

### Project checks

The offline suite uses recording GNOME stubs and a fake daemon. just localapi-check exercises modules/io.js under GJS against a real responding tailscaled; just test-live also runs it. Fixtures are synthetic because real daemon responses contain account information, addresses, and node keys. Verify exit nodes, account switching, and Taildrop with real peers before release.

## Packaging

<!-- quick-template:packaging:start -->

```sh
just build
just pack-check
```

The output is quickts@napalm255.github.io.shell-extension.zip at the repository root, with metadata.json at the archive root. Python's standard library packages the explicit runtimeFiles allowlist in quick-project.json, using stable file order and timestamps.

just pack-check compares both filenames and file contents with GNOME's official packer and validates shipped icons. Docs, tests, dependencies, credentials, downloaded binaries, and development artifacts stay outside the ZIP. Update the runtime allowlist when adding a runtime file.
<!-- quick-template:packaging:end -->

## Releasing

<!-- quick-template:releasing:start -->

Run just ci, just test-live, and the project manual checklist. Set metadata.json version-name and package.json version to the same new version. The GNOME Extensions website assigns the numeric metadata.json version during submission. Update the npm lockfile, regenerate the docs, and commit the reviewed changes to main through a passing pull request.

Create and push a v-prefixed tag for that version. The release workflow verifies the version, main ancestry, and successful required checks for the tagged commit, then attaches its tested ZIP to a GitHub release. It does not upload to extensions.gnome.org; that submission and its review remain manual.
<!-- quick-template:releasing:end -->

## Development

<!-- quick-template:development:start -->

mise.toml pins runtime and CLI versions; justfile owns commands; npm owns development dependencies and the lockfile. GNOME libraries come from the host. On image-based Fedora, use the host's available tools or a toolbox/distrobox for missing system packages; do not layer packages onto the OS.

```sh
just setup        # install pinned tools, dependencies, and browsers
just fmt          # format source and configuration
just lint         # verify template, generated docs, source, and schemas
just test         # JavaScript, Python, and project offline tests
just coverage     # report JavaScript and Python coverage without source exclusions
just test-docs    # Chromium and Firefox documentation checks
just security     # dependencies, secrets, and workflow checks
just build        # build the runtime-only extension ZIP
just pack-check   # compare files and contents with GNOME's packer
just ci           # complete local verification and packaging
just test-live    # isolated GNOME lifecycle and project integration checks
just docs         # serve the static site at localhost:8000
just template-check  # verify the pinned canonical template
just template-status # report a newer approved template revision
```

GitHub requires local verification, security analysis, and completed Sonar analysis. The shared Sonar policy requires zero security, reliability, and maintainability issues and zero duplicated lines. PR checks cover changed code; main checks cover the entire project. Missing configuration fails instead of silently skipping analysis. Pages publishes the tested docs only after the required checks pass on main.

Common tooling and these instructions are generated from a pinned canonical template. Change that source and synchronize its approved revision; do not edit generated sections or locally bless drift. Extension-specific behavior belongs in project configuration and project.just.
<!-- quick-template:development:end -->

## License

GPL-3.0-or-later.
