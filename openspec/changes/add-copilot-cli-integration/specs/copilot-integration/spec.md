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

**Technical Note:** The event composition point is `src/main.ts:158-199`; the
existing event-to-animation mapping is `src/app/session-tracker.ts:70-76`.

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

**Technical Note:** Session dots are assembled in `src/main.ts:150-155`;
Sub-agent events currently route to `SubAgentManager` at `src/main.ts:202-206`,
whose window lifecycle begins at `src/app/sub-agent-manager.ts:57`.

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

**Technical Note:** Application-support path resolution is centralized at
`src/app/config.ts:32-37`. Copilot's separate `COPILOT_HOME` hook path is new.

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

**Technical Note:** Current event handling and animation dispatch are at
`src/main.ts:158-199`; payload filtering and local IPC are new integration
boundaries and must have dedicated unit tests.

## Technical Notes

- Copilot CLI hook collection uses the documented user-level `~/.copilot/hooks/`
  directory, or `$COPILOT_HOME/hooks/` when configured.
- The hook command receives JSON on stdin and returns an empty hook result.
- Supported hook-to-animation mappings are defined in the change design.
- Existing integration points: `src/main.ts:150-206` (session composition),
  `src/app/session-tracker.ts:23-25` (Claude session identifier validation) and
  `src/app/session-tracker.ts:70-76` (`EVENT_TO_ANIM`),
  `src/app/sub-agent-manager.ts:57-70` (Mini-pet lifecycle), and
  `src/app/config.ts:32-37` (application-support path).

## Open Issues

- Copilot CLI sandbox access to the local socket must be verified on macOS before
  promising support for sandboxed sessions.
- The exact implementation line references will be added after implementation.
