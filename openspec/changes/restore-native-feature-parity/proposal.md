# Restore full Electron-era feature parity on the native shell

## Why

The native Bun + AppKit migration (`drop-electron-native-bun-shell`) reached
visual + reactive parity for the **main pet, sub-agent windows, dock menu, drag,
and single-instance lock**. Four behaviors from the old `main.js` were
deliberately left out of that change to keep it shippable, and are now visible
gaps for anyone who used the full Electron build:

1. **Custom (user-installed) characters** don't load — `main.ts` hardcodes
   `userCharDir: null`, so the `peon-asset://` resolver never checks the user's
   `characters/<name>/` directory. Bundled skins work; drop-in skins don't.
2. **Remote relay sync** is gone — `main.js` polled a relay
   (`http://127.0.0.1:19998/state`) so sessions from *other machines* showed up as
   dots and animations. `main.ts` only watches local JSONL.
3. **Character selection is config-only** — the old `--character` CLI flag is not
   honored.
4. **Multi-monitor placement** is approximate — `getPrimaryWorkArea()` and the
   cursor use `[NSScreen mainScreen]` (the active screen), not the **primary**
   display, so the pet can land on the wrong screen or hover-test incorrectly.

This change closes those gaps so the native build is a complete replacement.

## What Changes

- **Custom characters:** wire a `userCharDir` (`<configDir>/characters/<character>`)
  into the asset context in `main.ts` so user files take precedence over bundled
  ones, for every asset (background, sprite, borders, dock icon).
- **Character selection:** honor a `--character <name>` CLI flag overriding
  `config.character`, matching the old `main.js` precedence.
- **Remote relay sync:** port `syncRemoteSessionsToTracker` — poll
  `config.remoteUrl` (default `http://127.0.0.1:19998`) `/state` on an interval,
  merge remote sessions into the tracker, emit animations on newly-changed remote
  events, and drop sessions the relay no longer reports.
- **Config location:** define one `configDir()` helper that resolves the pet's
  config + `characters/` directory, reading the existing Electron `userData`
  ("Peon Pet") location if present so current installs keep their settings, else
  the native default.
- **Primary-display correctness:** select the **primary** display (menu-bar
  screen) for work area + cursor conversion, and keep both in the same coordinate
  space, so placement and hover are correct on multi-monitor setups.

## Impact

- **Affected capabilities:** `characters` (custom-dir resolution), `session-tracking`
  (remote relay), `configuration` (config dir + CLI flag + display selection).
- **Affected code:** `src/main.ts` (asset context, CLI parse, relay poll, config
  dir, display selection); `src/app/asset-resolver.ts` (already supports
  `userCharDir` — no change expected); `native/peonshell.m` + `src/shell/appkit.ts`
  (add a primary-display variant of the work-area/cursor functions); a new
  `src/app/remote-relay.ts` (pure, testable poll-and-merge logic).
- **User-visible:** custom skins load; cross-machine sessions reappear;
  `--character` works; correct screen on multi-monitor.
- **Risk:** low. The relay logic and asset context are pure and unit-testable
  against `FakeShell`; only the primary-display FFI accessor is new native code.

## Non-goals

- **No multi-display "follow the active screen"** or a pet per display — the pet
  lives on the primary display. (Could be a later change.)
- **No new character format or installer UI** — just honor the existing
  `characters/<name>/<asset>.png` convention the Electron build used.
- **No relay protocol changes** — consume the same `/state` shape as before.
