# Design — restore native feature parity

> Smaller companion to `drop-electron-native-bun-shell`. Same lenses (Dodds: reuse
> what exists, don't over-abstract; Zakharchenko: keep the new logic pure and
> tested at a seam; Rossi: ship the parity gaps incrementally). Joel-style: the
> open questions below are real and want answers before/while implementing.

## Author

One owner: the engineer picking up this change.

## Scope, in priority order

The four gaps are independent; ship them in this order (highest user value first),
each independently reviewable:

1. **Custom characters + `--character`** — small, high value, no FFI.
2. **Config-dir resolution** — small, unblocks #1's `characters/` lookup.
3. **Remote relay sync** — medium, pure + testable, no FFI.
4. **Primary-display correctness** — small native accessor + wiring.

## Decisions

### D1. Custom characters: wire the existing resolver, don't rebuild it

`resolveAsset` already implements the precedence *user dir → bundled → orc
fallback*; the only bug is `main.ts` passing `userCharDir: null`. Fix is to compute
`userCharDir = join(configDir(), "characters", character)` and pass it. No resolver
change. The four registered assets (bg, sprite, borders, dock-icon) all flow
through the same context, so custom skins override per-file.

### D2. Character selection precedence (match `main.js`)

`--character <name>` (CLI) **>** `config.character` **>** `"orc"`. A tiny arg
parser in `main.ts` (the old `parseArgPath` was 3 lines).

### D3. Config directory

Define `configDir()` returning the first of:
1. the Electron `userData` dir (`~/Library/Application Support/Peon Pet`) **if it
   exists** — so existing installs keep config + custom characters;
2. else the native default (`~/Library/Application Support/peon-pet`).

`loadConfig()` and the `characters/` lookup both use it. (See Open Question 2.)

### D4. Remote relay as a pure, tested unit

New `src/app/remote-relay.ts`: a `RemoteRelay` object owning `remoteSessionIds` +
`remoteLastEvents`, with a pure `merge(state, { tracker, sessionCwds })` that
returns the animations to emit and mutates the tracker/cwd map exactly as
`syncRemoteSessionsToTracker` did (relay timestamps are Unix **seconds** → ×1000;
emit an anim only when a remote session's event *changes*; drop sessions the relay
stops reporting). `main.ts` owns the `fetch` + interval; the merge logic is unit
tested with a fake tracker — no network in tests (Zakharchenko: intercept at the
seam). Bun's global `fetch` + `AbortSignal.timeout(150)` replace Electron `net`.

### D5. Primary display

Add `peon_primary_*` accessors (a `[NSScreen screens][0]`-style primary lookup, or
the screen whose frame origin is `(0,0)` — the menu-bar display) alongside the
existing `mainScreen` ones, and switch `AppKitShell.getPrimaryWorkArea()` +
`getCursorPosition()` to use the **primary** display consistently so window
placement and cursor hit-testing share one coordinate space.

## Open questions

1. **Is the relay still used?** The `127.0.0.1:19998` relay is part of the
   multi-machine peon-ping setup. If it's deprecated, drop gap #2 entirely.
   *Recommendation:* port it for parity unless the relay is confirmed dead.
2. **Config-dir strategy.** Read the old Electron `Peon Pet` dir for a seamless
   upgrade, or start clean at `peon-pet` and let users re-configure?
   *Recommendation:* prefer-existing (D3) — least surprise for current users.
3. **`--corner` CLI flag too?** The old build only had it in config. Cheap to add
   alongside `--character`. *Recommendation:* add it; it's two lines.
4. **Primary vs. "display under the menu bar where the dock is."** On exotic
   multi-display arrangements "primary" can be ambiguous. *Recommendation:* primary
   display (menu-bar screen); defer follow-the-cursor behavior (non-goal).

## Risks / trade-offs

- **Relay network calls** can hang; reuse the 150ms `AbortSignal.timeout` and never
  block the pump. Failures are swallowed (best-effort, like the old build).
- **Config-dir migration** could read a stale Electron config; acceptable — it's the
  user's own prior setting.
- **Primary-display FFI** is the only new native surface; cover it in the manual
  smoke checklist (multi-monitor placement).
