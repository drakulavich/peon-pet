# Tasks — restore native feature parity

Four independent gaps, highest user value first. Each leaves the app working.

## 1. Config directory

- [ ] 1.1 `src/app/config.ts`: `configDir()` → existing Electron `Peon Pet` dir if
      present, else native `peon-pet` (Open Question 2). `loadConfig()` reads
      `<configDir>/peon-pet-config.json`.
- [ ] 1.2 Unit-test `configDir()` resolution (injected existence check) + config
      parse/fallback.
- [ ] 1.3 Point `main.ts` at `configDir()` (replaces the inline path).

## 2. Custom characters + `--character`

- [ ] 2.1 `main.ts`: parse `--character <name>` (and `--corner <c>`, OQ3); precedence
      CLI > config > default.
- [ ] 2.2 Build the asset context with
      `userCharDir = join(configDir(), "characters", character)` so user files win.
- [ ] 2.3 Verify all four assets (bg / sprite / borders / dock-icon) honor the user
      dir; add a resolver test for a user-dir override of `dock-icon.png`.
- [ ] 2.4 Manual: drop a custom `sprite-atlas.png` in
      `<configDir>/characters/orc/` → the pet uses it.

## 3. Native sub-agent keepalive (relay dropped)

- [ ] 3.1 `src/app/jsonl-watcher.ts`: extend `getActiveSessionIds()` to also report a
      session that has an active sub-agent — foreground
      (`activeSubagentToolIds.size > 0`) or background (parent `sessionId` of a live
      `subagents/` file). No `main.ts` change (heartbeat already refreshes these ids).
- [ ] 3.2 Unit-test: a session with an active foreground sub-agent (and one with a
      live background sub-agent file) is reported active despite no pending tools,
      and is **no longer** reported once the sub-agent stops (`turn_duration` /
      stale teardown).
- [ ] 3.3 Confirm nothing reintroduces `remoteUrl` / `readRemoteState` /
      `syncRemoteSessionsToTracker`; manual: run a long sub-agent task → orc stays
      awake (no relay running).

## 4. Primary-display correctness

- [ ] 4.1 `native/peonshell.m`: `peon_primary_work_left/top/width/height` +
      `peon_primary_cursor_*` (or document that `mainScreen` == primary and skip).
- [ ] 4.2 `AppKitShell`: use the primary-display accessors for `getPrimaryWorkArea`
      + `getCursorPosition`, one coordinate space.
- [ ] 4.3 Manual: on a 2-monitor setup the pet sits bottom-left of the **primary**
      display and hover works there.

## 5. Verification

- [ ] 5.1 `bun test` green (new config + keepalive + resolver tests).
- [ ] 5.2 `tsc --noEmit` clean.
- [ ] 5.3 Manual smoke: custom skin loads; orc stays awake through a long sub-agent
      task; `--character capybara` switches the skin; correct screen on multi-monitor.
- [ ] 5.4 Re-measure idle memory at full parity; update the migration's
      `benchmarks.md`.
