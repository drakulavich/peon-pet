# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

peon-pet is a macOS desktop pet (an orc) that reacts to Claude Code events with sprite
animations. It is **Bun + AppKit + Three.js, no Electron**: a native `NSPanel` driven via
`bun:ffi`, rendering a Three.js scene inside a system `WKWebView`. Target platform is
**Apple Silicon macOS only** (`darwin`/`arm64`); Linux/Windows are explicit non-goals.

## Commands

```bash
bun run start          # build native shim + launch the pet
bun run dev            # same, with native diagnostics + console echo of each reaction (--dev)
bun test               # headless test suite (no window opened)
bun test --watch       # watch mode
bun test tests/session-tracker.test.ts        # run one test file
bun test -t "prunes cold sessions"            # run tests matching a name
bun run build:native   # rebuild native/libpeonshell.dylib after editing native/peonshell.m
bun run vendor:three   # vendor three.js into renderer/vendor (runs automatically on prepack)
```

`bun run start`/`dev` always recompile the native dylib first, so editing `native/peonshell.m`
and re-running picks up changes. There is no separate lint step.

## Architecture

The central design constraint is the **`NativeShell` boundary** (`src/shell/types.ts`). It is
the single seam between application logic and the OS:

- `src/shell/types.ts` — the `NativeShell` / `WindowHandle` interfaces. All of `src/app/**`
  depends ONLY on these types.
- `src/shell/appkit.ts` — the real shell. **This is the only file in the repo allowed to
  import `bun:ffi`.** It calls into `native/libpeonshell.dylib`.
- `src/shell/fake.ts` — in-memory shell used by tests, so the whole suite runs headlessly
  with no window and no native code.

When adding OS-facing capability, extend the interface in `types.ts`, then implement it in
**both** `appkit.ts` and `fake.ts`. Do not reach for `bun:ffi` anywhere outside `appkit.ts`.

Layers:

- `src/main.ts` — composition root. Wires the shell, asset resolver, JSONL watcher, and
  session tracker; owns the timers (pump, hover, heartbeat) and graceful shutdown.
- `src/app/**` — pure-ish, OS-independent logic, each module unit-tested against `FakeShell`:
  - `jsonl-watcher.ts` — tails `~/.claude/projects/**/*.jsonl` transcripts and emits
    `session-event` / `subagent-event`. This is how Claude Code activity is detected (there
    is no IPC/hook channel — it reads the transcript files directly). Ported verbatim from a
    prior JS implementation; preserve its behavior.
  - `session-tracker.ts` — tracks live sessions by last-seen timestamp; `EVENT_TO_ANIM` maps
    Claude Code event names → sprite animation names.
  - `sub-agent-manager.ts` — spawns/destroys mini-pet windows for sub-agents.
  - `asset-resolver.ts` — resolves `peon-asset://` URLs to absolute file paths, with user
    character dirs overriding bundled assets.
  - `config.ts`, `cli.ts`, `characters.ts`, `window-position.ts`, `window-interaction.ts`,
    `anim-state.ts`, `single-instance.ts`.
- `native/peonshell.m` — thin AppKit/WebKit C shim (`NSPanel` + `WKWebView` + a custom
  `peon-asset://` scheme handler). Compiled to `native/libpeonshell.dylib` by `build:native`.
- `renderer/` — the Three.js renderer (`app.js`, `index.html`, shaders, assets), loaded over
  `peon-asset://app/renderer/index.html`. Native→renderer messaging goes through
  `window.__peonEmit(channel, data)` injected via `evaluateJS`.

### How a Claude Code event becomes an animation

`JsonlWatcher` detects a transcript change → emits `session-event` → `main.ts`
`handleSessionEvent` updates the tracker and calls `emit("peon-event", { anim, event })`
→ `evaluateJS` runs `window.__peonEmit` in the WebView → the Three.js renderer plays the
sprite row. Event/animation mapping and timing thresholds (`HOT_MS`, `WARM_MS`, `PRUNE_MS`)
live in `main.ts` and `session-tracker.ts`.

## Conventions

- Runtime config lives at `~/Library/Application Support/peon-pet/peon-pet-config.json`.
  Custom characters go under `.../characters/<name>/` and override bundled assets per-file.
  Character precedence: `--character` flag > config file > `orc` default.
- The sprite atlas is a fixed **6×6 grid** (512px frames, 3072×3072). Row order is fixed:
  0 Sleeping, 1 Waking, 2 Typing, 3 Alarmed, 4 Celebrate, 5 Annoyed. See `CONTRIBUTING.md`
  for the full character spec.
- TypeScript is strict, ESM-only, with `allowImportingTsExtensions` — imports use explicit
  `.ts` extensions (e.g. `./shell/appkit.ts`).
- `src/spike.ts` and `src/demo-orc.ts` are dev-only entrypoints (`bun run spike` / `demo`),
  excluded from the published package.

## Specs

Specs of record live under `openspec/specs/` (capabilities: characters, configuration,
native-shell, pet-window, rendering, session-tracking). Shipped changes are archived under
`openspec/changes/archive/`. Treat `openspec/specs/` as the source of truth for intended
behavior.
