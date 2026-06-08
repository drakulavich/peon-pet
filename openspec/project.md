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

### Spec authoring — Nikita Sobolev's "correct user stories" lens

We write requirements as correct, BDD-style user stories, applying
[Sobolev's engineering guide](https://dev.to/wemake-services/engineering-guide-to-writing-correct-user-stories-1i7f)
(which maps cleanly onto OpenSpec's Requirement + Scenario = Gherkin). A
requirement is not "done" until it satisfies these — the IEEE-830 attributes
(*correct, unambiguous, complete, consistent, ranked, verifiable, traceable*) in
practice:

1. **Enumerate all outcomes, not just the happy path.** Every requirement carries
   scenarios for success **and** the failure / invalid-input / edge cases. A
   single happy-path scenario is treated as incomplete. (Sobolev's #1 finding:
   stories that omit error states hide their real complexity.)
2. **Specific roles, not "the user."** Name the concrete persona/actor the
   behavior serves (e.g. *a Claude Code user running a long sub-agent task*,
   *someone who installed a custom skin*) — not a generic "user/system."
3. **User value over implementation.** The requirement states the observable
   outcome; mechanisms (FFI calls, file layouts) live in the scenarios / design,
   not the requirement title.
4. **Verifiable ⇒ a test.** Each scenario must be expressible as a `bun test`
   case (or a named manual smoke step when it crosses the FFI boundary).
5. **Prioritize with MoSCoW + name the role.** Lead the requirement with
   `The system SHALL …` so SHALL/MUST lands on the **first line** of the first plain
   paragraph (the validator scans that first line — if SHALL wraps to line 2, or the
   line starts with bold `**…**`, or the name carries a `[Must]` tag, it fails). Put
   the value + priority + role on a trailing line:
   `_Priority: Must. Role: a user upgrading from the Electron build._`
6. **Ubiquitous language.** Use the Glossary terms below consistently — one term
   per concept, no synonyms drifting across proposal/design/spec/code.

## Glossary (ubiquitous language)

| Term | Meaning |
| ---- | ------- |
| **Session** | One Claude Code conversation, identified by a UUID; backed by a JSONL transcript under `~/.claude/projects/`. |
| **Sub-agent** | A nested agent a session spawns. *Foreground* = `agent_progress` records in the parent transcript; *background* = a `subagents/agent-*.jsonl` file. |
| **Active** (session) | Reported by `JsonlWatcher.getActiveSessionIds()`; the heartbeat keeps active sessions' timestamps fresh. |
| **Hot / Warm** | Display states of a session dot: *hot* = event within `HOT_MS` (30s), *warm* = within `WARM_MS` (2min). |
| **Character / skin** | A set of sprite assets (`sprite-atlas`, `borders`, `bg`, `dock-icon`) selected by name; bundled or user-installed. |
| **Work area** | A display's usable region (excludes menu bar + dock); top-left-origin in app code. |
| **Primary display** | The menu-bar display (`[NSScreen screens][0]`), distinct from `mainScreen` (the active one). |
| **NativeShell** | The TypeScript boundary over the OS; the only FFI-touching impl is `AppKitShell`. |
