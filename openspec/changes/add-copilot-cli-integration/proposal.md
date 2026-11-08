# Add Copilot CLI event integration

## Why

Peon Pet currently reacts to Claude Code transcript events only. Copilot CLI
already exposes local lifecycle hooks, so its sessions can drive the same pet
animations and session indicators without parsing private session storage.

## What Changes

- Add an opt-in installer for Peon Pet's own user-level Copilot CLI hook file,
  with a matching uninstall command that leaves other hook files untouched.
- Receive hook payloads in a short-lived Peon Pet command and forward only
  validated event metadata to the running app over a local Unix-domain socket.
- Reuse existing animations, session dots, and Sub-agent mini-pets for supported
  Copilot CLI lifecycle events.
- Document supported events, setup, sandbox limitations, and removal.

## Impact

- Affected capabilities: a new `copilot-integration` capability and session
  tracking.
- Affected code: `src/main.ts`, new Copilot hook/IPC modules under `src/app`,
  CLI handling, tests, README, and the OpenSpec corpus.
- No renderer or NativeShell changes are expected.

## Non-goals

- No integration with Copilot cloud agent, IDE-only Copilot events, or other
  Copilot surfaces.
- No reading or parsing Copilot's internal session database, logs, or transcript
  files.
- No prompt, tool-argument, tool-result, response, or error-detail collection.
- No edits to existing Copilot settings, repository hooks, or sandbox policy.
- No changes to Claude Code event collection or its existing session IDs.
