# Tasks — restore native feature parity

Four independent gaps, highest user value first. Each leaves the app working.

## 1. Config directory

- [x] 1.1 Created `src/app/config.ts` (extracted `loadConfig` out of `main.ts`) with
      `configDir()` → legacy Electron `Peon Pet` dir if present, else native
      `peon-pet`; injected FS seam. `loadConfig()` reads `<configDir>/peon-pet-config.json`.
- [x] 1.2 `tests/config.test.ts`: dir resolution + parse + missing/malformed/non-object
      fallback. 7 tests green.
- [x] 1.3 `main.ts` uses `configDir()` / `loadConfig()`.

## 2. Custom characters + `--character`

- [x] 2.1 `main.ts`: `--character <name>` + `--corner <c>` parsed; precedence
      CLI > config > default.
- [x] 2.2 Asset context built with
      `userCharDir = join(configDir(), "characters", character)` so user files win.
- [x] 2.3 Resolver honors the user dir for all assets; added a `dock-icon.png`
      user-override test. Verified live: `--character capybara` served
      `capybara-sprite-atlas.png` / `capybara-borders.png`.
- [ ] 2.4 Manual (on-device): drop a custom `sprite-atlas.png` in
      `<configDir>/characters/orc/` → the pet uses it.

## 3. Native sub-agent keepalive (relay dropped)

- [x] 3.1 `src/app/jsonl-watcher.ts`: extended `getActiveSessionIds()` to also report a
      session with an active sub-agent — foreground (`activeSubagentToolIds.size > 0`)
      or background (parent `sessionId` of a live `subagents/` file). No `main.ts`
      change (heartbeat already refreshes these ids).
- [x] 3.2 Unit tests added (`tests/jsonl-watcher.test.ts`): foreground + background
      keepalive despite no pending tools; stops on `turn_duration` and on stale
      teardown; only valid UUID ids reported. 5 tests, green.
- [x] 3.3 No `remoteUrl` / `readRemoteState` / `syncRemoteSessionsToTracker` in the
      tree. (Manual "long sub-agent → orc stays awake" remains an on-device check.)

## 4. Primary-display correctness

- [x] 4.1 `native/peonshell.m`: `peon_work_*` now read the **primary** display
      (`peon_primary_screen()` = `[NSScreen screens][0]`) instead of `mainScreen`.
      Removed the misnamed `peon_primary_work_height` stub; `src/spike.ts` +
      `src/demo-orc.ts` updated to `peon_work_height`.
- [x] 4.2 `AppKitShell` already binds `peon_work_*` / `peon_cursor_*` in `loadLib`
      and uses them in `getPrimaryWorkArea` + `getCursorPosition` — now
      primary-based, one coordinate space. No change needed.
- [ ] 4.3 Manual (on-device): on a 2-monitor setup the pet sits bottom-left of the
      **primary** display and hover works there. (Single-display verified: placement
      unchanged at `(20,20)`.)

## 5. Verification

- [ ] 5.1 `bun test` green (new config + keepalive + resolver tests).
- [ ] 5.2 `tsc --noEmit` clean.
- [ ] 5.3 Manual smoke: custom skin loads; orc stays awake through a long sub-agent
      task; `--character capybara` switches the skin; correct screen on multi-monitor.
- [ ] 5.4 Re-measure idle memory at full parity; update
      `openspec/changes/drop-electron-native-bun-shell/benchmarks.md`.

> Test layout: new tests go under the top-level `tests/` directory (e.g.
> `tests/config.test.ts`, `tests/jsonl-watcher.test.ts`), matching the existing
> suite — not co-located `src/app/*.test.ts`.
