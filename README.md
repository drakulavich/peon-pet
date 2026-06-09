# peon-pet

A macOS desktop pet for [Peon-Ping](https://peonping.com) — an orc that reacts to your Claude Code events with sprite animations. Built on **Bun + AppKit + Three.js** (no Electron — a native `NSPanel` driven via `bun:ffi`, rendering the Three.js scene in system WebKit).

<video src="https://github.com/user-attachments/assets/7fd9a2cb-d227-49ad-8ccc-7953ec392a2d" autoplay loop muted playsinline width="400"></video>

Sits in the bottom-left corner of your screen and floats over all windows. Clicks pass through to whatever's underneath — except when you hover the orc itself, where it captures the mouse so you can read tooltips and drag it around.

## Requirements

- macOS (the shell is AppKit-native; Linux/Windows are non-goals)
- [Bun](https://bun.sh) 1.3+
- Xcode Command Line Tools (`clang`, to build the native shim) — `xcode-select --install`
- [peon-ping](https://peonping.com) installed and running

## Quick start

```bash
git clone <repo> peon-pet
cd peon-pet
bun install
bun run start      # builds the native shim, then launches the pet
```

`bun run start` compiles `native/libpeonshell.dylib` (a tiny AppKit shim) and runs
`src/main.ts`. Check your dock for the Peon-Ping logo.

## Install permanently (auto-start at login)

```bash
./install.sh
```

Installs a macOS LaunchAgent that starts peon-pet at login and restarts it if it quits. Logs go to `/tmp/peon-pet.log`.

To remove:

```bash
./uninstall.sh
```

## Controls

Right-click the **Peon-Ping dock icon** for a menu:

- **Hide Pet** / **Show Pet** — toggle visibility (orc + any sub-agent mini-pets) without quitting
- **Quit** — exit completely

You can also **drag** the orc with the mouse to move it, and quit with `Ctrl-C` in the
foreground (or `./uninstall.sh` to remove the LaunchAgent). Only one instance runs at
a time — launching a second just exits.

## Characters

Bundled skins: **orc** (default), **capybara**, **hello-kitty**. Select one in config,
or with a CLI flag:

```bash
bun run build:native           # once
bun src/main.ts --character capybara   # or --corner top-right
```

Config lives at `~/Library/Application Support/peon-pet/peon-pet-config.json` (the
legacy Electron `Peon Pet` dir is reused automatically if you're upgrading):

```json
{ "character": "capybara", "corner": "bottom-right" }
```

**Custom skins:** drop your own PNGs in
`~/Library/Application Support/peon-pet/characters/<name>/` —
`sprite-atlas.png`, `borders.png`, `bg.png`, `dock-icon.png`. User files override the
bundled ones per-asset (anything missing falls back to the bundled skin, then orc).
Precedence for the active character is `--character` > config > `orc`.

## Animations

| Claude Code event | Animation |
|---|---|
| Session start / resume | Waking up (plays once) |
| Prompt submit | Typing |
| Task complete (Stop) | Celebrate |
| Permission request / context compact | Alarmed |
| Tool failure | Annoyed |

The orc stays in typing mode while any session is actively working (event within last 30 s). Returns to sleeping after 30 s of inactivity.

## Session dots

Up to 10 glowing orbs appear above the orc — one per tracked Claude Code session:

- **Bright pulsing green** — active (event within last 30 s)
- **Dim green** — idle (last event 30 s–2 min ago)

Sessions are dropped automatically after 10 min of inactivity (the JSONL transcript
model has no explicit "session end" — they decay).

Hover over a dot to see the project folder and status. Hover anywhere on the widget to see all active project names.

## Sub-agents

When a session spawns sub-agents, a mini-orc (up to 5) pops up stacked above the main
pet for each active sub-agent and disappears when it finishes. The parent session is
kept "awake" while its sub-agents run, so the orc doesn't fall asleep during long
sub-agent tasks.

## Architecture

```
src/main.ts          composition root: window + watcher + session tracker
src/shell/
  types.ts           NativeShell boundary (interface)
  appkit.ts          real shell — bun:ffi → native/libpeonshell.dylib
  fake.ts            in-memory shell for headless tests
src/app/             ported logic (session tracker, jsonl watcher, anim, …)
native/peonshell.m   thin AppKit/WebKit C shim (NSPanel + WKWebView +
                     peon-asset:// scheme handler); built to libpeonshell.dylib
renderer/            unchanged Three.js renderer, loaded over peon-asset://
```

The only file that touches `bun:ffi` is `src/shell/appkit.ts`. Everything above the
`NativeShell` boundary is tested against `FakeShell`, so the suite runs headlessly.

## Development

```bash
bun run dev    # builds the shim, runs with native diagnostics (--dev)
bun test       # 182 tests, headless (no window opened)
bun run build:native   # rebuild native/libpeonshell.dylib after editing the shim
```

Specs of record live under `openspec/specs/` (capabilities), with shipped changes
archived in `openspec/changes/archive/`.

The pet reacts to Claude Code automatically: just use Claude Code and watch the orc
wake / type / celebrate. With `bun run dev` the terminal echoes each reaction, e.g.
`→ orc: typing (UserPromptSubmit)`.

Valid events: `SessionStart`, `Stop`, `UserPromptSubmit`, `PermissionRequest`, `PostToolUseFailure`, `PreCompact`

## Sprite atlas

The orc sprite sheet is a 6×6 pixel art atlas (`renderer/assets/orc-sprite-atlas.png`, 3072×3072). Row layout:

| Row | Animation |
|---|---|
| 0 | Sleeping |
| 1 | Waking |
| 2 | Typing |
| 3 | Alarmed |
| 4 | Celebrate |
| 5 | Annoyed |

See `docs/sprite-atlas-prompt.md` for the generation prompt used with image models.
