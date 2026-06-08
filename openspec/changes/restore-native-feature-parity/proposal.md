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
2. **The orc can fall asleep during long sub-agent tasks.** While a sub-agent runs,
   the *parent* session's transcript may get no new events, so it decays to idle —
   and the watcher's hot-keepalive doesn't catch it, because `Task`/`Agent` tools
   are permission-*exempt* and aren't counted as "pending." The old build masked
   this with a peon-ping relay keepalive (`127.0.0.1:19998`); we **drop the relay**
   and fix it natively instead.
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
- **Native sub-agent keepalive (replaces the relay):** keep a parent session hot
  while it has an active sub-agent — foreground (`agent_progress`) or background
  (a live `subagents/` file) — by extending `JsonlWatcher.getActiveSessionIds()`.
  The heartbeat already refreshes those ids, so the orc stays awake through long
  sub-agent runs with **no relay and no network**. The `127.0.0.1:19998` relay and
  `remoteUrl` config are removed.
- **Config location:** define one `configDir()` helper that resolves the pet's
  config + `characters/` directory, reading the existing Electron `userData`
  ("Peon Pet") location if present so current installs keep their settings, else
  the native default.
- **Primary-display correctness:** select the **primary** display (menu-bar
  screen) for work area + cursor conversion, and keep both in the same coordinate
  space, so placement and hover are correct on multi-monitor setups.

## Impact

- **Affected capabilities:** `characters` (custom-dir resolution), `session-tracking`
  (sub-agent keepalive), `configuration` (config dir + CLI flag + display selection).
- **Affected code:** `src/main.ts` (asset context, CLI parse, config dir, display
  selection); `src/app/jsonl-watcher.ts` (extend `getActiveSessionIds`);
  `src/app/asset-resolver.ts` (already supports `userCharDir` — no change expected);
  `native/peonshell.m` + `src/shell/appkit.ts` (primary-display accessors).
- **User-visible:** custom skins load; the orc stays awake through long sub-agent
  tasks; `--character` works; correct screen on multi-monitor.
- **Risk:** low. The keepalive and asset context are pure and unit-testable; only
  the primary-display FFI accessor is new native code.

## Non-goals

- **No multi-display "follow the active screen"** or a pet per display — the pet
  lives on the primary display. (Could be a later change.)
- **No new character format or installer UI** — just honor the existing
  `characters/<name>/<asset>.png` convention the Electron build used.
- **No relay / multi-machine session aggregation** — the `127.0.0.1:19998` relay is
  dropped, not ported. Cross-machine session display is out of scope (a future
  change could add it back as opt-in if there's demand).
