# session-tracking

## ADDED Requirements

### Requirement: Remote relay sessions are tracked and animated

The system SHALL periodically read a relay's `/state` endpoint and merge the remote
sessions it reports into the session tracker, so sessions from other machines
appear as dots and drive animations.

#### Scenario: Remote session appears and animates

- **WHEN** the relay reports a session with a known event (e.g. `UserPromptSubmit`)
  that differs from the last event seen for that session
- **THEN** the session is added/updated in the tracker (relay Unix-seconds
  timestamp converted to milliseconds)
- **AND** the mapped animation is emitted once for that change

#### Scenario: Same event is not re-animated

- **WHEN** the relay reports the same event for a session across two polls
- **THEN** no duplicate animation is emitted for it

#### Scenario: Dropped remote session is removed

- **WHEN** the relay stops reporting a previously-seen remote session
- **THEN** that session is removed from the tracker and its cwd entry cleared

#### Scenario: Invalid relay data is ignored

- **WHEN** the relay returns no state, an unreachable endpoint, or an entry with an
  invalid session id
- **THEN** the tracker is unchanged and no error is surfaced to the user
