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

## 3. Remote relay sync

- [ ] 3.1 `src/app/remote-relay.ts`: `RemoteRelay` with `merge(state, ctx)` porting
      `syncRemoteSessionsToTracker` (Unix-seconds → ms, emit-on-change, drop-absent).
      Pure; no network.
- [ ] 3.2 Unit-test merge: add/update remote sessions, anim only on event change,
      removal when the relay drops a session, invalid session-id filtering.
- [ ] 3.3 `main.ts`: poll `config.remoteUrl` (default `http://127.0.0.1:19998`)
      `/state` every 5s via Bun `fetch` + `AbortSignal.timeout(150)`; feed
      `RemoteRelay.merge`; emit returned anims + `sendSessionUpdate`. Best-effort
      (swallow errors). Gate on Open Question 1.

## 4. Primary-display correctness

- [ ] 4.1 `native/peonshell.m`: `peon_primary_work_left/top/width/height` +
      `peon_primary_cursor_*` (or document that `mainScreen` == primary and skip).
- [ ] 4.2 `AppKitShell`: use the primary-display accessors for `getPrimaryWorkArea`
      + `getCursorPosition`, one coordinate space.
- [ ] 4.3 Manual: on a 2-monitor setup the pet sits bottom-left of the **primary**
      display and hover works there.

## 5. Verification

- [ ] 5.1 `bun test` green (new config + relay + resolver tests).
- [ ] 5.2 `tsc --noEmit` clean.
- [ ] 5.3 Manual smoke: custom skin loads; a relayed session shows a dot + animates;
      `--character capybara` switches the skin; correct screen on multi-monitor.
- [ ] 5.4 Re-measure idle memory at full parity; update the migration's
      `benchmarks.md`.
