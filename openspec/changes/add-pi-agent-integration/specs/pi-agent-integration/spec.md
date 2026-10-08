# pi-agent-integration

## ADDED Requirements

### Requirement: Local Pi Agent lifecycle events drive Peon Pet reactions

The system SHALL translate supported local Pi Agent lifecycle events into
Peon Pet session, animation, and cleanup behavior without changing Pi execution.

_Priority: Must. Role: Vlad, a Pi Agent user running local sessions._

#### Scenario: Pi lifecycle event reaches the pet (happy path)

- **WHEN** a valid local Pi Agent lifecycle event is received while Peon Pet is running
- **THEN** the corresponding existing animation or Session dot update is applied
- **AND** Claude Code and Copilot CLI sessions continue to be handled independently

#### Scenario: Pi event is malformed or the pet is unavailable (edge)

- **WHEN** Pi sends an invalid event or the local Peon Pet socket is unavailable
- **THEN** no invalid session state is applied
- **AND** Pi continues without being blocked or modified by the integration

### Requirement: Pi Agent sessions are isolated and cleaned up

The system SHALL display local Pi Agent sessions in the existing Session dots and
remove only the matching Pi session when its lifecycle ends.

_Priority: Must. Role: Vlad, a Pi Agent user running local sessions._

#### Scenario: Pi session lifecycle is reflected (happy path)

- **WHEN** Pi reports a session start, turn start, settled agent, or shutdown
- **THEN** the session wakes, becomes active while working, celebrates when settled,
  or is removed on shutdown as appropriate
- **AND** its identifier remains distinct from Claude Code and Copilot CLI identifiers

#### Scenario: One Pi session ends while other sessions remain (edge)

- **WHEN** one Pi session shuts down while other sessions are tracked
- **THEN** only that Pi session and its working directory are removed
- **AND** all other tracked sessions remain unchanged

### Requirement: Pi Agent extension management is explicit and non-destructive

The system SHALL install or remove only Peon Pet's user-level Pi Agent extension
when Dana explicitly requests those operations.

_Priority: Must. Role: Dana, the shell contributor._

#### Scenario: Install and uninstall are repeatable (happy path)

- **WHEN** Dana runs the Pi Agent install or uninstall command repeatedly
- **THEN** installation is idempotent and uninstall removes only the recognized
  Peon Pet extension

#### Scenario: An unrelated extension occupies the managed path (edge)

- **WHEN** the managed extension path contains an unrecognized file or symlink
- **THEN** install and uninstall report a conflict and preserve that path unchanged

## Technical Notes

- Pi lifecycle callbacks and event mapping are implemented by
  `registerPiLifecycleHandlers` / `createPiPetEvent` in `src/pi-extension.ts:39-109`.
- Pi IDs and event validation are implemented by `piSessionId` /
  `validatePiPetEvent` in `src/app/pi-events.ts:15-48`.
- The shared socket revalidates and dispatches Pi events in
  `src/app/copilot-ipc.ts:134-135`.
- Pi session tracking, end-event cleanup, and animations are routed by
  `handlePiEvent` in `src/main.ts:276-296`.
- Explicit extension management is implemented by
  `installPiExtension` / `uninstallPiExtension` in
  `src/app/pi-extension-installer.ts:49-85` and the `pi` command in
  `bin/peon-pet:16-32`.

## Open Issues

- The configured Pi installation is confirmed to use the extension API and event
  names described in its installed package. Compatibility with future Pi versions
  or third-party forks remains unverified.
