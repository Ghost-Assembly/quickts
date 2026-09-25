# Security policy

## Supported versions

The most recent release. QuickTS targets a single GNOME Shell major version at a
time; older releases are not patched.

## Reporting a vulnerability

Report privately through
[GitHub's advisory form](https://github.com/Ghost-Assembly/quickts/security/advisories/new)
rather than opening an issue.

Please include the GNOME Shell version, the QuickTS version, the Tailscale
version, and the steps to reproduce. You can expect an acknowledgment within a
week.

## Scope

QuickTS talks to the Tailscale daemon over its local Unix socket at
`/run/tailscale/tailscaled.sock`, using the same LocalAPI the `tailscale` CLI
uses. Anything you can do through the menu, you can already do from a terminal
as the tailscale operator; the extension grants no privilege you did not have.

The parts worth scrutinizing:

- **The LocalAPI client** (`modules/io.js`, `modules/localapi.js`). Every request
  path is built in `localapi.js`, where node identifiers and Taildrop filenames
  are percent-encoded before they reach a URL.
- **Sending files** (`modules/taildrop.js`). Files are chosen through the XDG
  desktop portal, so the file dialog runs outside the Shell process, and are
  streamed from disk to a peer the daemon lists in `/file-targets` at the
  moment of sending — whether the send started from the Taildrop list or from
  a device's own row.
- **Receiving files** (`modules/inbox.js`, `modules/io.js`). A received file's
  name is chosen by whoever sent it, so it is checked before it becomes a
  path: a name containing `/` or a NUL byte, or starting with `.` (which
  covers `..`), is refused and the file is left with the daemon. The file is
  written into the XDG download directory (`~/Downloads` if none is set), never
  the home directory itself, and is created exclusively — an existing file,
  or a symlink planted under the same name, is never overwritten or followed;
  the save moves on to `name (1)`, `name (2)` and so on. The body is streamed
  to disk rather than held in gnome-shell's memory.
- **Data from the tailnet is not trusted.** Peer names, tags and health strings
  come from the coordination server and are rendered as text only. They are
  never used to build a command or markup, and only a checked Taildrop name is
  used to build a path.
- **Nothing is logged that identifies a node or a file.** The extension logs
  one line at enable and warnings for misconfiguration or failed requests;
  peer names, addresses, keys and file names stay out of the journal. A failed
  send is reported in a notification, which GNOME does not log, rather than
  through the Shell's error notifier, which does.
