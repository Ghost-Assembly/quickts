# QuickTS's own recipes, imported by the shared justfile.

# Check modules/io.js against the tailscaled running on this machine
localapi-check:
    ./scripts/localapi-check.sh

# Needs a real tailscaled, so like the rest of test-live it never runs in CI.
# Run by test-live after the shared checks: probe the live daemon
live-extra: localapi-check
