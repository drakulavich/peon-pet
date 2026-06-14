# Glossary

Canonical (ubiquitous-language) terms for the peon-pet spec corpus. Specs use these
terms verbatim — one term per concept, no synonyms. If you need a new term, add it
here first.

| Term | Definition |
|---|---|
| **Session** | One Claude Code conversation, identified by a UUID and backed by a JSONL transcript under `~/.claude/projects/` (`src/app/jsonl-watcher.ts`, `src/app/session-tracker.ts`). |
| **Sub-agent** | A nested agent a Session spawns. *Foreground* = `agent_progress` records in the parent transcript; *background* = a `subagents/agent-*.jsonl` file (`src/app/sub-agent-manager.ts`). |
| **JsonlWatcher** | The component that tails Session transcripts and reports which Sessions are Active (`src/app/jsonl-watcher.ts`). |
| **Active** (session) | A Session reported by `JsonlWatcher.getActiveSessionIds()` (`src/app/jsonl-watcher.ts:99`); the heartbeat keeps active Sessions' timestamps fresh (`src/main.ts`). |
| **Hot / Warm** | Display states of a Session dot: *hot* = an event within `HOT_MS` (30 s), *warm* = within `WARM_MS` (2 min) (`src/main.ts:38-39`). |
| **Session dot** | The glowing indicator drawn per Active Session; the orc shows up to `MAX_DOTS` of them (`src/main.ts`, built by `buildSessionStates`). |
| **Mini-pet** | A smaller companion sprite shown for a Sub-agent (`src/app/sub-agent-manager.ts`). |
| **Character / skin** | A named set of sprite assets (`sprite-atlas`, `borders`, `bg`, `dock-icon`), bundled or user-installed, selected by name (`src/app/characters.ts`, `src/app/asset-resolver.ts`). |
| **NativeShell** | The TypeScript boundary over the OS — the seam every OS-touching call goes through (`src/shell/types.ts`). |
| **AppKitShell** | The one FFI-backed `NativeShell` implementation, driving an `NSPanel` via `native/libpeonshell.dylib` through `bun:ffi` (`src/shell/appkit.ts`). |
| **FakeShell** | The in-memory `NativeShell` used so the suite runs headless in `bun test` — the boundary the tests exercise instead of the FFI edge (`src/shell/fake.ts`). |
| **NSPanel** | The borderless, always-floating, click-through AppKit window the orc lives in, created by AppKitShell. |
| **Work area** | A display's usable region (excludes menu bar + dock); top-left-origin in app code (`src/app/window-position.ts`). |
| **Primary display** | The menu-bar display (`[NSScreen screens][0]`), distinct from `mainScreen` (the active one). |
| **renderer** | The reused-verbatim `renderer/` surface (HTML + Three.js + shaders) that draws the orc; the shell must not require renderer changes. |
