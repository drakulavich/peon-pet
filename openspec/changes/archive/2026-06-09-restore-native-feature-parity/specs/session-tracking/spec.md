# session-tracking

## ADDED Requirements

### Requirement: Parent sessions stay active while a sub-agent runs

The system SHALL treat a session as active (eligible to be kept hot by the
heartbeat) while it has an active sub-agent, even when the session has no pending
non-exempt tools, so that a long sub-agent task does not put the orc to sleep.

_Priority: Must. Role: a Claude Code user running a long sub-agent task._

#### Scenario: Foreground sub-agent keeps the parent active (happy path)

- **WHEN** a session has an active foreground sub-agent (an `agent_progress` record
  seen, no matching stop yet) and no pending non-exempt tools
- **THEN** the session is reported among the active session ids
- **AND** the heartbeat refreshes its timestamp, keeping the orc awake

#### Scenario: Background sub-agent keeps the parent active

- **WHEN** a live background sub-agent file (`<session>/subagents/agent-*.jsonl`)
  exists for a parent session
- **THEN** that parent session is reported among the active session ids

#### Scenario: Stops keeping the session active when the sub-agent ends (failure/exit)

- **WHEN** the sub-agent ends (the turn completes, or the background sub-agent file
  goes stale and is torn down) and the session has no other activity
- **THEN** the session is no longer reported active and may decay normally

#### Scenario: Invalid parent session id is ignored (edge)

- **WHEN** a sub-agent references a parent session id that is not a valid UUID
- **THEN** no session is reported active for it and the tracker is unaffected

#### Scenario: Already-pruned parent is not revived (known limitation)

- **WHEN** a parent session has fully pruned from the tracker (`PRUNE_MS`, 10 min)
  before its sub-agent ends
- **THEN** the keepalive does **not** re-insert it — the heartbeat only refreshes
  already-tracked sessions (accepted; a sub-agent normally keeps the parent < 10 min
  stale)
