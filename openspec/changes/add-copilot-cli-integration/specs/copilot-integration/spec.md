# copilot-integration

## ADDED Requirements

### Requirement: Copilot CLI events drive Peon Pet reactions

The system SHALL translate supported local Copilot CLI lifecycle events into
Peon Pet session, animation, and Sub-agent behavior without changing Copilot's
hook decisions or content.

_Priority: Must. Role: Dana, the shell contributor._

#### Scenario: Supported session event reaches the pet (happy path)

- **WHEN** a valid Copilot CLI hook event is received while Peon Pet is running
- **THEN** the matching existing animation or session update is applied
- **AND** Claude Code sessions continue to be handled independently

#### Scenario: Unsupported or malformed hook payload is ignored (edge)

- **WHEN** the hook receives invalid JSON, an unsupported event, or invalid
  required identifiers
- **THEN** no session, animation, or Mini-pet state is changed
- **AND** the hook exits without changing Copilot's behavior

**Technical Note:** Hook payload parsing and allowlisting are implemented in
`src/app/copilot-events.ts:95,121`; IPC reception validates the compact event
again in `src/app/copilot-ipc.ts:48,102`. The event composition point is
`src/main.ts:220`; the existing event-to-animation mapping is
`src/app/session-tracker.ts:70`.

### Requirement: Copilot CLI session and Sub-agent state is reflected

The system SHALL display active Copilot CLI sessions and Sub-agents using the
existing Session dots and Mini-pets, and remove them when their lifecycle ends.

_Priority: Must. Role: Dana, the shell contributor._

#### Scenario: Session and Sub-agent lifecycle is reflected (happy path)

- **WHEN** Copilot CLI reports session start, prompt submission, turn completion,
  or Sub-agent start/stop events
- **THEN** the corresponding Session dot and Mini-pet lifecycle is updated
- **AND** session identifiers remain distinct from Claude Code identifiers

#### Scenario: Session end removes only its own state (edge)

- **WHEN** Copilot CLI reports that one session ended
- **THEN** only that Copilot CLI session is removed from the Session dots
- **AND** other Copilot CLI and Claude Code sessions remain tracked

**Technical Note:** Session dots are assembled in `src/main.ts:158-163`;
Copilot session state and end cleanup are handled in
`src/app/copilot-session.ts:4,25` and `src/main.ts:220`. Sub-agent events
route to `SubAgentManager` from `src/main.ts:254-267`, whose window lifecycle
begins at `src/app/sub-agent-manager.ts:57`.

### Requirement: Copilot CLI hook management is explicit and non-destructive

The system SHALL install and remove only its own user-level Copilot CLI hook
configuration when Dana explicitly requests those operations.

_Priority: Must. Role: Dana, the shell contributor._

#### Scenario: Install and uninstall are repeatable (happy path)

- **WHEN** Dana runs the Copilot CLI install or uninstall command more than once
- **THEN** installation remains idempotent and uninstall removes only Peon Pet's
  dedicated hook file
- **AND** unrelated Copilot configuration is unchanged

#### Scenario: Existing unrelated hook file is preserved (edge)

- **WHEN** the dedicated target filename already contains an unrecognized file
- **THEN** installation reports the conflict and leaves that file unchanged

**Technical Note:** Hook path resolution, config generation, ownership
recognition, install, and uninstall live in `src/app/copilot-hooks.ts:37,120,151`.
The CLI routes these commands before starting AppKit in `bin/peon-pet:15`.

### Requirement: Hook failures do not interfere with Copilot CLI

The system SHALL isolate Peon Pet hook delivery failures from Copilot CLI
execution.

_Priority: Must. Role: Dana, the shell contributor._

#### Scenario: Pet is unavailable during hook delivery (failure)

- **WHEN** a valid hook runs while Peon Pet is not running or its local socket is
  unavailable
- **THEN** the hook reports a concise diagnostic to stderr
- **AND** exits successfully without blocking or modifying Copilot CLI

#### Scenario: Sensitive hook fields are excluded (edge)

- **WHEN** a Copilot CLI hook payload contains prompt text, tool arguments,
  results, responses, or error details
- **THEN** those fields are not forwarded to Peon Pet or stored by the integration

**Technical Note:** The hook dispatcher reads only bounded stdin and forwards
the allowlisted event in `src/app/copilot-cli.ts:9`; the Unix socket uses a
private per-user directory and validates frames in `src/app/copilot-ipc.ts:48,102`.
The launcher handles hook mode before building/loading the native shell in
`bin/peon-pet:37`.

## Technical Notes

- Copilot CLI hook collection uses the documented user-level `~/.copilot/hooks/`
  directory, or `$COPILOT_HOME/hooks/` when configured. Paths are resolved by
  `copilotHooksDirectory` at `src/app/copilot-hooks.ts:37`.
- The hook command receives JSON on stdin and returns an empty hook result.
- Copilot session IDs are deterministically mapped to UUID-shaped IDs with a
  dedicated namespace by `copilotSessionId` at `src/app/copilot-events.ts:46`;
  Claude transcript UUID validation is unchanged.
- The listener socket path is resolved from Peon Pet's application-support
  directory by `src/app/copilot-ipc.ts:11`.
- Existing integration points: `src/main.ts:157-274` (session composition),
  `src/app/session-tracker.ts:23` (unchanged Claude session identifier validation) and
  `src/app/session-tracker.ts:70` (`EVENT_TO_ANIM`),
  `src/app/sub-agent-manager.ts:57-70` (Mini-pet lifecycle), and
  `src/app/config.ts:32-37` (application-support path).

## Open Issues

- Copilot CLI sandbox access to the local socket must be confirmed with an
  installed CLI on macOS; setup documentation warns about this limitation rather
  than claiming sandboxed-session support.
