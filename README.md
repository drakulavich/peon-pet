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

Quit with `Ctrl-C` (foreground) or `./uninstall.sh` (LaunchAgent).

> The right-click dock menu (Hide / Show / Quit) and drag-to-move are being
> reimplemented on the native shell — see the OpenSpec change under `openspec/`.

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

Sessions are removed when Claude Code fires `SessionEnd`, or automatically after 10 min of inactivity.

Hover over a dot to see the project folder and status. Hover anywhere on the widget to see all active project names.

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
bun test       # 138 tests, headless (no window opened)
bun run build:native   # rebuild native/libpeonshell.dylib after editing the shim
```

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
