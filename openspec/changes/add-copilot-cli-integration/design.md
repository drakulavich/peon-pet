# Design — Copilot CLI event integration

## Goal

Let Dana, the shell contributor, enable Peon Pet reactions to local Copilot CLI
sessions while preserving existing Claude Code behavior and never altering
Copilot's decisions or content.

## Architecture

Copilot CLI hooks invoke a short-lived Peon Pet command. The command reads one
JSON payload from stdin, validates the hook event and the minimum metadata, then
sends a compact event to the running Peon Pet over a Unix-domain socket. It
returns an empty hook result and exits successfully; it never returns a decision
that could affect Copilot execution.

The running app owns the socket and routes validated events through the existing
session tracker, `EVENT_TO_ANIM` mapping, renderer event channel, and
`SubAgentManager`. The hook command and socket protocol are separate from
`JsonlWatcher`; Copilot IDs are normalized into a stable UUID-shaped namespace
so the existing Claude transcript ID validation and file discovery remain
unchanged.

The socket lives under the Peon Pet application-support directory. Its containing
directory is restricted to the current macOS user and the socket is created with
owner-only permissions. The hook command is dispatched before the app's
single-instance lock path, so it forwards an event and exits rather than
attempting to launch a second pet.

## Event behavior

| Copilot CLI hook | Peon Pet behavior |
| --- | --- |
| `sessionStart` | Track the session and play `waking` |
| `userPromptSubmitted` | Mark the session active and play `typing` |
| `agentStop` | Mark the session active and play `celebrate` |
| `permissionRequest` | Mark the session active and play `alarmed` |
| `postToolUseFailure` | Mark the session active and play `annoyed` |
| `preCompact` | Mark the session active and play `alarmed` |
| `sessionEnd` | Remove the Copilot session from session dots |
| `subagentStart` | Create a Mini-pet for the Sub-agent |
| `subagentStop` | Destroy the matching Mini-pet |

`postToolUse` is intentionally omitted because it fires for every successful
tool, adding noise without a distinct existing animation. Session and Sub-agent
events use hook-provided IDs; Sub-agent IDs are scoped to the parent session.

The event adapter forwards only event name, session ID, working directory,
timestamp, and Sub-agent identity where needed. It discards prompt text, tool
arguments, tool results, response text, and error details before IPC.

## Installation and removal

An explicit `peon-pet copilot install` command writes a dedicated JSON file in
`$COPILOT_HOME/hooks/` when set, otherwise `~/.copilot/hooks/`. The file contains
only Peon Pet's hook entries and launches the installed Peon Pet executable with
the hook-dispatch flag. Re-running install is idempotent. If the target file
already exists and is not recognized as Peon Pet's own file, installation
refuses to overwrite it.

`peon-pet copilot uninstall` removes only that dedicated file. Neither command
edits `settings.json`, `.github/hooks/`, other user-level hook files, or
Copilot's sandbox configuration.

## Failure handling and security

- Invalid JSON, unknown hook names, invalid identifiers, or oversized payloads
  are rejected without forwarding content.
- If the pet is not running or the socket is unavailable, the hook writes a
  concise diagnostic to stderr and exits successfully so Copilot continues
  normally.
- The socket accepts only the small event schema and has an explicit payload
  size limit; it does not evaluate shell text or expose a network listener.
- A Copilot CLI sandbox may deny access to the socket path. Peon Pet will not
  silently change sandbox policy; setup documentation must explain that the
  user may need to grant the hook access or run the session without that
  restriction.

## Testing

- Unit tests cover hook payload validation, identifier normalization, event
  mapping, privacy filtering, and configuration generation.
- IPC tests cover delivery to a running receiver, unavailable receiver, malformed
  message, and socket cleanup.
- Installer tests cover idempotent install, refusal to overwrite an unrelated
  file, removal of only the owned file, and `$COPILOT_HOME` resolution.
- Existing Claude watcher and session-tracker suites remain green.
- A manual macOS smoke test verifies an interactive Copilot CLI session wakes,
  types, celebrates, and closes Sub-agent Mini-pets.

## Open Issues

- Verify on supported macOS versions whether Copilot CLI's sandboxed hook process
  can access a user-owned Unix socket when the hook directory itself is readable.
  If not, document the exact supported permission setup; do not broaden access
  or mutate sandbox policy automatically.
- Verify the installed executable path remains usable when Copilot CLI is
  launched from a non-interactive shell.
