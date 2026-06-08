# characters

## ADDED Requirements

### Requirement: User-installed character assets override bundled ones

The system SHALL resolve character assets from the user's character directory
(`<configDir>/characters/<character>/`) before falling back to bundled assets, for
every asset the renderer requests (background, sprite atlas, borders, dock icon).

#### Scenario: User file overrides the bundled asset

- **WHEN** a file `<configDir>/characters/<character>/sprite-atlas.png` exists
- **THEN** the pet renders that sprite atlas instead of the bundled one

#### Scenario: Falls back to bundled when no user file exists

- **WHEN** the user character directory has no override for an asset
- **THEN** the bundled character-specific asset is used, else the orc fallback

### Requirement: Character selection honors the CLI flag

The system SHALL select the active character by the precedence
`--character <name>` (CLI) > `config.character` > default (`orc`).

#### Scenario: CLI flag overrides config

- **WHEN** the app starts with `--character capybara` and config says `hello-kitty`
- **THEN** the capybara character is used

#### Scenario: Config used when no flag

- **WHEN** no `--character` flag is given and config says `capybara`
- **THEN** the capybara character is used
