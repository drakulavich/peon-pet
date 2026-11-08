# Changelog

## [Unreleased] - Native Bun + AppKit (drop Electron)

Replaces the Electron shell with a native Bun runtime. The pet is now a pure Bun
process that drives an AppKit `NSPanel` via `bun:ffi` and renders the **unchanged**
Three.js scene in system WebKit — no Chromium, no Node. See the OpenSpec change
`openspec/changes/drop-electron-native-bun-shell/`.

### Changed

- **Runtime:** Electron 40 → **Bun** (native TypeScript, no build step).
- **Window shell:** Electron `BrowserWindow` → AppKit `NSPanel` via a thin C shim
  (`native/peonshell.m`) loaded with `bun:ffi`. Same traits: transparent,
  borderless, floating over all spaces, click-through with hover capture.
- **Rendering:** Chromium → system **WKWebView**; the `renderer/` is byte-for-byte
  unchanged.
- **Assets:** `peon-asset://` is now served by a `WKURLSchemeHandler` backed by a
  pure, tested resolver (with CORS for cross-origin textures).
- **IPC:** Electron preload/ipc → injected `window.peonBridge` shim over
  `WKScriptMessageHandler` + `evaluateJavaScript`.
- **Tests:** Jest → `bun test` (138 tests, headless via an in-memory shell).
- **Run loop:** cooperative pump keeps Bun's loop and Cocoa's loop alive together.

### Removed

- `main.js`, `preload.js`, `lib/*.js`, the `boolean` shim/override, and the
  Electron dependency. `npm start` → `bun run start`.

### Not yet ported (tracked in the OpenSpec change)

- Sub-agent mini-windows, dock Hide/Show/Quit menu, drag-to-move, single-instance
  lock.

## [1.0.0-alpha] - 2026-02-18

First working release of peon-pet — a desktop pet for [Peon-Ping](https://peonping.com).

### Added

- **Orc pixel art sprite atlas** — 4 animations (sleeping, waking, typing, alarmed), 6 frames each, 6×4 RGBA atlas
- **Three.js renderer** — frameless 200×200 transparent Electron window, always-on-top, ignores mouse clicks
- **Warcraft-style wooden border overlay** — pixel art border rendered as a Three.js plane at z=0.4
- **Dark dungeon pixel art background** — tinted via MeshBasicMaterial color multiplier
- **Flash overlay shader** — GLSL ShaderMaterial per-animation color flash (blue for waking, gold for typing, red for alarmed)
- **Session dots** — up to 5 glowing orbs at the top of the window; hot sessions pulse bright green, warm sessions dim green, absent sessions hidden
- **Two-state session tracking** — hot (<30 s since last event), warm (<2 min), with UUID-only filter to exclude synthetic test IDs
- **Animation state machine** — reaction animations play 3× before returning to idle; orc stays typing while any session is hot
- **Idle timer** — orc sleeps after 30 s of no events when no session is hot
- **Dock icon** — 256×256 orc face extracted from sprite atlas; appears in macOS dock
- **Dock context menu** — right-click dock icon → Hide Pet / Show Pet / Quit
- **macOS auto-start** — `install.sh` installs a LaunchAgent that starts peon-pet at login and restarts on crash; `uninstall.sh` removes it
- **Test suite** — 59 Jest tests covering session tracking, UV math, animation config, and asset integrity

### Animation triggers

| Event | Animation |
|---|---|
| `SessionStart` | waking |
| `Stop`, `UserPromptSubmit` | typing |
| `PermissionRequest`, `PostToolUseFailure`, `PreCompact` | alarmed |

### Tech

- Electron 40 · Three.js r183 · Node canvas (icon generation) · Jest 29
