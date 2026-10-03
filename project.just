# QuickTS's own recipes, imported by the shared justfile.

# Check modules/io.js against the tailscaled running on this machine
localapi-check:
    ./scripts/localapi-check.sh

# Needs a real tailscaled, so like the rest of test-live it never runs in CI.
# Run by test-live after the shared checks: probe the live daemon
live-extra: localapi-check

# Project-specific offline integration tests
test-extra:
    @true

# Isolated GNOME lifecycle test
live-check:
    bash scripts/headless-check.sh

# Project services stopped before uninstalling
uninstall-extra:
    @true
