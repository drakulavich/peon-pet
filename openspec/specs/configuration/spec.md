# configuration Specification

## Purpose
TBD - created by archiving change restore-native-feature-parity. Update Purpose after archive.
## Requirements
### Requirement: Configuration directory resolution

The system SHALL resolve one configuration directory — used for both the config
file and the `characters/` directory — preferring an existing prior-install
location, so that a user upgrading from the Electron build keeps their settings and
custom skins.

_Priority: Must. Role: a user upgrading from the Electron build._

#### Scenario: Existing install location is reused (happy path)

- **WHEN** a prior config directory exists at the legacy Electron `userData`
  location
- **THEN** the system reads config and custom characters from there

#### Scenario: Falls back to the native default

- **WHEN** no legacy directory exists
- **THEN** the system uses the native default config directory

#### Scenario: Missing or malformed config degrades to safe defaults (failure)

- **WHEN** the config file is absent, unreadable, or not valid JSON
- **THEN** the pet starts with documented defaults (corner = bottom-left,
  character = `orc`) and does not crash or surface an error to the user

### Requirement: Pet is placed on the primary display

The system SHALL place the pet and perform cursor hit-testing using the primary
display's work area, in one consistent coordinate space, so that a user on a
multi-monitor setup finds the pet where they expect.

_Priority: Should. Role: a user on a multi-monitor setup._

#### Scenario: Correct screen on multi-monitor (happy path)

- **WHEN** more than one display is connected
- **THEN** the pet is anchored to the configured corner of the primary display
- **AND** hover/click-through hit-testing uses that same display's coordinates

#### Scenario: Single display behaves identically (edge)

- **WHEN** exactly one display is connected
- **THEN** placement and hit-testing are unchanged from prior behavior (primary ==
  the only display)

