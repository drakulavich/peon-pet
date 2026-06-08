# configuration

## ADDED Requirements

### Requirement: Configuration directory resolution

The system SHALL resolve a single configuration directory used for both the config
file and the `characters/` directory, preferring an existing prior install location
so current users keep their settings.

#### Scenario: Existing install location is reused

- **WHEN** a prior config directory exists at the legacy Electron `userData`
  location
- **THEN** the system reads config and custom characters from there

#### Scenario: Falls back to the native default

- **WHEN** no legacy directory exists
- **THEN** the system uses the native default config directory

### Requirement: Pet is placed on the primary display

The system SHALL place the pet and perform cursor hit-testing using the primary
display's work area, in a single consistent coordinate space, on multi-monitor
setups.

#### Scenario: Correct screen on multi-monitor

- **WHEN** more than one display is connected
- **THEN** the pet is anchored to the configured corner of the **primary** display
- **AND** hover/click-through hit-testing uses that same display's coordinates
