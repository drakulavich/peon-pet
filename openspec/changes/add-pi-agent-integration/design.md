# Design — Pi Agent event integration

## Goal

Let Vlad use Peon Pet reactions from either of his local Pi launchers without
changing how Pi runs or exposing conversation content.

## Architecture

Pi's user-level extension API delivers lifecycle callbacks in the Pi process.
An opt-in installer copies a self-contained TypeScript extension into
`$PI_CODING_AGENT_DIR/extensions/` when configured, otherwise
`~/.pi/agent/extensions/`. Both launchers already use the same Pi installation
and extension directory.

The extension maps Pi's session and agent lifecycle callbacks to a compact
Peon Pet event and sends it through the existing owner-only Unix socket. It
forwards a deterministic Pi-namespaced session ID, current working directory,
event, and timestamp only. Socket absence, timeout, or malformed data is
ignored by the extension. It does not inspect or change prompt, tool, or
response payloads.

The running pet validates Pi events separately from Copilot events, updates
the shared session tracker, and uses the existing event-to-animation map:

| Pi event | Peon Pet behavior |
| --- | --- |
| `session_start` | Track the session and play `waking` |
| `turn_start` | Mark the session active and play `typing` |
| `agent_settled` | Mark the session idle and play `celebrate` |
| `session_shutdown` | Remove only that Pi session from Session dots |

## Installation and removal

`peon-pet pi install` writes only `peon-pet.ts` in the resolved user extension
directory. Installation is idempotent. Existing unrecognized files and
symlinks are preserved and reported as conflicts. `peon-pet pi uninstall`
removes only a recognized Peon Pet extension. Project extensions, settings,
and the cmux shim are untouched.

## Failure handling and security

- The IPC receiver validates event type, timestamp, cwd length, and the Pi
  session namespace before changing pet state.
- The extension uses a bounded local socket request and silently tolerates
  the pet not running so Pi's own behavior is unaffected.
- Prompt text, tool arguments/results, and assistant responses never enter the
  IPC event shape.

## Testing

- Unit tests cover stable Pi IDs, event schema validation, lifecycle mapping,
  session cleanup, installer idempotency, and conflict protection.
- IPC tests verify Pi events are delivered through the same local socket while
  malformed Pi payloads are rejected.
- The Pi CLI launcher test loads the installed extension in a real headless Pi
  invocation with a local fake socket and confirms the callback event reaches
  the pet protocol.
