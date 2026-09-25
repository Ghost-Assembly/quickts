#!/usr/bin/env bash
# Run modules/io.js against the tailscaled on this machine, under plain gjs.
#
# No gnome-shell, no compositor, no Wayland — modules/io.js imports nothing from
# resource:///, which is the reason it is a separate file from modules/panel.js.
# A stub of libsoup can only prove that the stub behaves; this proves the daemon
# still answers with the shape modules/state.js expects, which is the one thing
# no unit test can check.
#
# Needs a running tailscaled and so is local-only, via `just test-live`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v gjs >/dev/null || {
    echo "FAIL: gjs not found — dnf install gjs" >&2
    exit 1
}

# --json, because plain `tailscale status` exits 1 for a daemon that is
# reachable and merely stopped — and a stopped daemon is a state this check
# has to cover, not refuse.
if ! tailscale status --json >/dev/null 2>&1; then
    echo "FAIL: tailscaled is not reachable; start it, or set yourself operator with" >&2
    echo "      sudo tailscale set --operator=\$USER" >&2
    exit 1
fi

exec gjs -m "$REPO_ROOT/scripts/localapi-check.js"
