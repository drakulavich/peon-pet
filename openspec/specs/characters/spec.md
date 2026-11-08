# characters Specification

## Purpose
TBD - created by archiving change restore-native-feature-parity. Update Purpose after archive.
## Requirements
### Requirement: User-installed character assets override bundled ones

The system SHALL resolve each character asset (background, sprite atlas, borders,
dock icon) from `<configDir>/characters/<character>/` before falling back to the
bundled character asset, then the orc default, so that someone who installed a
custom skin sees it on the pet.

_Priority: Must. Role: a user who dropped a custom skin into their character directory._

#### Scenario: User file overrides the bundled asset (happy path)

- **WHEN** `<configDir>/characters/<character>/sprite-atlas.png` exists
- **THEN** the pet renders that sprite atlas instead of the bundled one

#### Scenario: Partial override falls back per-asset (edge)

- **WHEN** the user character directory overrides `sprite-atlas.png` but has no
  `borders.png`
- **THEN** the user's sprite atlas is used **and** `borders.png` falls back to the
  bundled character-specific file (resolution is per-asset, not all-or-nothing)

#### Scenario: No user file falls back to bundled (failure of the lookup)

- **WHEN** the user character directory is absent or has no override for an asset
- **THEN** the bundled character-specific asset is used, else the orc fallback,
  else the request resolves as not-found

### Requirement: Character selection honors the CLI flag

The system SHALL select the active character by the precedence `--character <name>`
(CLI) > `config.character` > default (`orc`), so that a user can launch a different
skin without editing config.

_Priority: Should. Role: a user who wants a one-off skin at launch._

#### Scenario: CLI flag overrides config (happy path)

- **WHEN** the app starts with `--character moon` and config says `star`
- **THEN** the `moon` character is used

#### Scenario: Config used when no flag

- **WHEN** no `--character` flag is given and config says `moon`
- **THEN** the `moon` character is used

#### Scenario: Unknown character name degrades to the orc fallback (failure)

- **WHEN** `--character dragon` is given but no `dragon` bundle or user directory
  exists
- **THEN** each asset resolves via the orc fallback rather than crashing or showing
  a blank pet

