# Project Context

> OpenSpec context file. Read this before generating or applying any change.

## Purpose

**peon-pet** is a macOS desktop pet for [Peon-Ping](https://peonping.com): an orc
that sits in a screen corner, floats over every window, ignores mouse clicks
(hover-only for tooltips), and reacts to Claude Code events with sprite
animations. It watches Claude Code session JSONL transcripts and shows one
glowing "session dot" per active session, plus mini-pets for sub-agents.

## Tech Stack

| Area        | Today (being replaced)            | Target                                  |
| ----------- | --------------------------------- | --------------------------------------- |
| Runtime     | Node.js + Electron 40             | **Bun** (native TypeScript)             |
| Window shell| Electron `BrowserWindow`          | **AppKit `NSPanel` via `bun:ffi`**      |
| Rendering   | Chromium + three.js (WebGL)       | **System WKWebView + three.js (unchanged)** |
| Asset serve | `peon-asset://` custom protocol   | **`Bun.serve()` on `127.0.0.1`**        |
| IPC         | Electron `ipcMain` / preload      | **WKScriptMessageHandler + evaluateJavaScript** |
| Tests       | Jest (Node)                       | `bun test` (boundary fakes, headless)   |

## Project Conventions

- **Language:** TypeScript. Bun executes `.ts` directly; no separate build step.
- **The renderer is sacred.** `renderer/` (HTML + three.js + shaders) is reused
  verbatim across the migration. Changes to the shell must not require changes
  to the renderer.
- **Platform:** macOS only. Linux/Windows are explicit non-goals (see the change
  under `changes/`). Anything platform-specific lives behind the `NativeShell`
  seam so it can be faked in tests and, someday, re-implemented.
- **Test at the boundary.** The FFI/native edge is the one untrustworthy layer;
  everything above it is tested against an in-memory fake shell so the suite runs
  headless in CI.

## OpenSpec Conventions

- Capabilities live in `openspec/specs/<capability>/spec.md` (the current truth).
- Proposed work lives in `openspec/changes/<change-id>/` as `proposal.md`,
  `design.md`, `tasks.md`, and spec deltas under `specs/<capability>/spec.md`.
- Every `### Requirement:` uses SHALL/MUST and carries at least one
  `#### Scenario:` with WHEN/THEN bullets.
