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
3. **Native sub-agent keepalive** — small, pure + testable, no FFI.
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

### D4. Native sub-agent keepalive (relay dropped)

The relay's real job here was a keepalive: keep the **parent** orc awake while a
sub-agent runs. We fix that locally instead of resurrecting a network dependency.

`JsonlWatcher` already tracks sub-agents — `activeSubagentToolIds` per main-session
file (foreground `agent_progress`) and a `FileState{isSubagentFile, sessionId:
parentId}` per live background `subagents/` file. Extend
`getActiveSessionIds()` to return, in addition to sessions with pending non-exempt
tools, **any session that currently has an active sub-agent** (foreground:
`activeSubagentToolIds.size > 0`; background: the parent `sessionId` of any live
sub-agent file). The heartbeat in `main.ts` already does
`for (id of watcher.getActiveSessionIds()) tracker.update(id, now)`, so this alone
keeps the parent hot — no `main.ts` change, no `fetch`, no `remoteUrl`.

This is a pure change to one method; unit-test it: a session with an active
foreground sub-agent (and one with a live background sub-agent file) is reported
active even when it has no pending tools, and stops being reported once the
sub-agent stops. Delete `readRemoteState` / `syncRemoteSessionsToTracker` /
`remoteUrl` from the ported surface (they never made it into `main.ts`, so this is
just *not* adding them).

### D5. Primary display

Add `peon_primary_*` accessors (a `[NSScreen screens][0]`-style primary lookup, or
the screen whose frame origin is `(0,0)` — the menu-bar display) alongside the
existing `mainScreen` ones, and switch `AppKitShell.getPrimaryWorkArea()` +
`getCursorPosition()` to use the **primary** display consistently so window
placement and cursor hit-testing share one coordinate space.

## Open questions

1. **Config-dir strategy.** Read the old Electron `Peon Pet` dir for a seamless
   upgrade, or start clean at `peon-pet` and let users re-configure?
   *Recommendation:* prefer-existing (D3) — least surprise for current users.
2. **`--corner` CLI flag too?** The old build only had it in config. Cheap to add
   alongside `--character`. *Recommendation:* add it; it's two lines.
3. **Primary vs. "display under the menu bar where the dock is."** On exotic
   multi-display arrangements "primary" can be ambiguous. *Recommendation:* primary
   display (menu-bar screen); defer follow-the-cursor behavior (non-goal).

> Resolved: the `127.0.0.1:19998` relay is **dropped** (D4) — its only real job here
> was a keepalive, now handled locally. Multi-machine aggregation is a non-goal.

## Risks / trade-offs

- **Sub-agent keepalive** must also *stop* keeping a session hot once the sub-agent
  ends, or a finished session never decays. The watcher already clears
  `activeSubagentToolIds` on `turn_duration` and tears down stale background files,
  so this falls out — but the test must cover the stop transition.
- **Config-dir migration** could read a stale Electron config; acceptable — it's the
  user's own prior setting.
- **Primary-display FFI** is the only new native surface; cover it in the manual
  smoke checklist (multi-monitor placement).
