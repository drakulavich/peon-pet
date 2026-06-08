# session-tracking

## ADDED Requirements

### Requirement: Parent sessions stay active while a sub-agent runs

The system SHALL treat a session as active (eligible to be kept hot by the
heartbeat) while it has an active sub-agent, even if the session has no pending
non-exempt tools, so the orc does not fall asleep during long sub-agent tasks.

#### Scenario: Foreground sub-agent keeps the parent active

- **WHEN** a session has an active foreground sub-agent (an `agent_progress` record
  seen, no matching stop yet) and no pending non-exempt tools
- **THEN** the session is reported among the active session ids
- **AND** the heartbeat refreshes its timestamp, keeping the orc awake

#### Scenario: Background sub-agent keeps the parent active

- **WHEN** a live background sub-agent file (`<session>/subagents/agent-*.jsonl`)
  exists for a parent session
- **THEN** that parent session is reported among the active session ids

#### Scenario: Stops keeping the session active when the sub-agent ends

- **WHEN** the sub-agent ends (the turn completes, or the background sub-agent file
  goes stale and is torn down) and the session has no other activity
- **THEN** the session is no longer reported active and may decay normally
