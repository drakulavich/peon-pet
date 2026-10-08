# Add Pi Agent event integration

## Why

Peon Pet already reacts to Claude Code and local Copilot CLI activity. Pi Agent
exposes a user-level TypeScript extension API with session and turn lifecycle
events, so local Pi sessions can use the same pet without parsing transcripts.

## What Changes

- Add an explicit `peon-pet pi install|uninstall` command that manages only
  Peon Pet's user-level Pi extension.
- Send normalized Pi session lifecycle events to the existing local Unix
  socket and reuse Peon Pet's Session dots and animations.
- Keep Pi session identifiers in a dedicated namespace and exclude prompts,
  tool arguments, results, and responses.
- Document the supported Pi events and installation flow.

## Impact

- Affected capabilities: new `pi-agent-integration` and session tracking.
- Affected code: event validation and IPC, app composition, Pi extension
  installation, tests, README, and the OpenSpec corpus.
- No renderer or NativeShell changes are expected.

## Non-goals

- No support for remote Pi sessions or third-party Pi forks with incompatible
  extension APIs.
- No transcript parsing or collection of prompts, tool data, or model output.
- No automatic edits to Pi settings, project extensions, or existing extensions.
- No modification to the user's two Pi launchers; both use the shared user
  extension directory instead.
