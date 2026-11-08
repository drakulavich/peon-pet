# Design — Native Bun + AppKit shell for peon-pet

> This document is written in the style Joel Spolsky describes in *Painless
> Functional Specifications* (joelonsoftware.com): a readable, narrative spec that
> describes the product from the outside in, names its non-goals, and keeps a
> living list of open issues. The technical decisions (the "how") are folded in
> because, for an infrastructure migration, the user-visible behavior is "nothing
> changes" — so the interesting spec *is* the internals.

## Disclaimer

This spec is not complete and it will be wrong in places. It describes the
intended design as of this change; as the FFI work uncovers reality (and it will),
update this document rather than letting it rot. If a detail here contradicts what
AppKit actually does on the test machine, AppKit wins — fix the spec.

## Author

One owner: the engineer executing this change. Route corrections and arguments to
them, not to a committee. (Joel's rule: a spec with many authors is a spec nobody
owns.)

## The three design lenses

The user asked for this design to be viewed through three practitioners' lenses.
They are not decoration; each one decided something concrete.

- **Kent C. Dodds — "use the platform; avoid hasty abstractions."** This is why we
  keep the three.js renderer and run it in the *system* WebKit instead of rewriting
  the orc against a native drawing API. The platform already renders WebGL; we use
  it. We add exactly one new abstraction (`NativeShell`) and only because tests
  demand a seam — no speculative "PlatformShell for Linux/Windows" we don't need
  yet (AHA: Avoid Hasty Abstractions).

- **Artem Zakharchenko — "intercept at the boundary."** MSW's core idea is to
  faithfully mock at the lowest meaningful boundary. Here the boundary is the FFI
  edge to AppKit. We define `NativeShell` as that boundary and provide `FakeShell`
  as the interceptor, so every line of application logic is tested headlessly
  against a real contract — never against a live window, never mocked ad hoc inside
  each test. The bridge between renderer and native is a typed message contract,
  not a stringly-typed free-for-all.

- **Luca Rossi — "ship simplicity incrementally; reduce the surface area."** This
  is why the migration is a strangler-fig (run new shell behind a flag, port one
  capability at a time, delete Electron last) rather than a big-bang rewrite, and
  why "drop ~150 MB and one whole runtime" is itself the headline feature. Each
  phase is independently reviewable and leaves the app working.

## Scenarios

Real, fictitious users — the way Joel insists you write them.

**Priya, the all-day Claude Code user.** Priya keeps three Claude Code sessions
open across two monitors. She wants the orc in the bottom-left corner, on top of
her IDE and full-screen browser, sleeping until something happens, then waking/
typing/celebrating as her sessions move. She never wants to *click* the orc by
accident while reaching for her dock — clicks must pass straight through to
whatever is underneath. Occasionally she hovers it to read which project each
session dot belongs to. **She must not be able to tell that Electron is gone.**

**Sam, the contributor.** Sam clones the repo on a fresh Mac, runs `bun install &&
bun run start`, and the pet appears in seconds. No Electron download, no Chromium,
no native build toolchain. Sam writes a feature touching session logic and runs
`bun test`; the whole suite passes headlessly without a window ever opening,
because the logic talks to `FakeShell`.

**Dana, the laptop-battery-watcher.** Dana noticed peon-pet eating 120 MB of RAM
and a non-trivial slice of CPU just to idle. After this change Dana sees a single
small Bun process plus the system's already-running WebKit, and a fraction of the
memory. That reduction is the point of the project for Dana.

## Non-goals

Listed loudly so we can stop debating them (Joel: nongoals settle arguments early).

- **Not cross-platform.** macOS only. No Linux, no Windows, no abstraction layer
  built *in anticipation* of them. The `NativeShell` seam exists for testing, not
  for portability; if portability ever comes, that's a separate change.
- **Not a rendering rewrite.** We are not reimplementing the orc in CALayer, Metal,
  or Canvas. The three.js renderer is reused byte-for-byte.
- **Not a new feature.** No new animations, characters, settings, or behaviors.
  Parity with today's Electron app, nothing more. (New characters etc. ship in
  later changes, on the new shell.)
- **Not a redesign of session tracking.** `lib/session-tracker`,
  `lib/jsonl-watcher`, `lib/anim-state`, `lib/window-position` keep their logic;
  they are translated to TypeScript and otherwise left alone.
- **Not Wayland/X for sub-agent windows.** Sub-agent mini-pets are macOS panels
  like the main one.

## Overview

The architecture is three layers and one boundary:

```
┌──────────────────────────────────────────────────────────────┐
│  src/main.ts        — entrypoint: wires everything, owns state │
│  src/app/           — ported logic (session tracker, watcher,  │
│                       anim state, positioning, sub-agents)     │
├──────────────────────────────────────────────────────────────┤
│  NativeShell (TypeScript interface)   ←── THE BOUNDARY          │
│    • createWindow(opts) → WindowHandle                         │
│    • window: setPosition / setIgnoreMouseEvents / show / hide  │
│    • window.loadURL / evaluateJS / onMessage                   │
│    • getCursorPosition / getPrimaryWorkArea                    │
│    • setDockIcon / setDockMenu / onDockMenuClick               │
├───────────────────────────────┬──────────────────────────────┤
│  AppKitShell (real)           │  FakeShell (tests)            │
│   bun:ffi → libobjc/AppKit/   │   in-memory window registry,  │
│   WebKit: NSPanel, WKWebView, │   scripted cursor + messages, │
│   NSApplication, dock         │   no FFI, no window           │
└───────────────────────────────┴──────────────────────────────┘
        Asset delivery: Bun.serve() on 127.0.0.1  →  WKWebView
        Renderer (UNCHANGED): renderer/index.html + three.js
```

Data flows exactly as today, just over new pipes:

1. `JsonlWatcher` (ported) emits session/sub-agent events.
2. `src/app` updates the session tracker and computes animation state.
3. The entrypoint pushes updates to a window via `shell.window.evaluateJS(...)`,
   which calls the same renderer functions `window.peonBridge` callbacks used to.
4. The renderer (untouched) renders the orc and session dots into a transparent
   WKWebView.
5. A cursor-poll loop toggles `setIgnoreMouseEvents` so hover works while clicks
   pass through; drag messages come back via `WKScriptMessageHandler`.

## Details

The meat. Each subsection is a decision plus its consequence.

### D1. The window: NSPanel, not NSWindow

We use an `NSPanel` (subclass of `NSWindow`) with style mask
`NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel`. Non-activating
means clicking near it (or the rare focus event) never steals key focus from the
user's real app — the Electron equivalent of `focusable: false`.

Configuration, one-to-one with the current `BrowserWindow` options:

| Electron option         | AppKit equivalent                                              |
| ----------------------- | -------------------------------------------------------------- |
| `transparent: true`     | `setOpaque:NO`, `setBackgroundColor:[NSColor clearColor]`      |
| `frame: false`          | borderless style mask                                          |
| `alwaysOnTop: true`     | high window `level` (screen-saver level) + collection behavior |
| `skipTaskbar: true`     | panel + accessory treatment (no window menu entry)             |
| `focusable: false`      | non-activating panel; `setIgnoresMouseEvents` baseline YES     |
| `hasShadow: false`      | `setHasShadow:NO`                                              |
| `setIgnoreMouseEvents`  | `setIgnoresMouseEvents:` (toggled, see D3)                     |

"Floats over **all** windows, including full-screen Spaces" requires collection
behavior `CanJoinAllSpaces | FullScreenAuxiliary | Stationary`. This matches what
Priya expects on her full-screen browser.

### D2. Rendering: WKWebView loading the unchanged renderer

A `WKWebView` is added as the panel's content view. To make it transparent over
the clear panel we set its backing `drawsBackground` to NO (via
`setValue:forKey:@"drawsBackground"`), and the existing renderer already uses
`background: transparent` and an alpha WebGL context — so no renderer change.

The webview loads `http://127.0.0.1:<port>/index.html` (see D4), not a `file://`
URL, which keeps the existing CSP working and sidesteps WKWebView's `file://`
read-access quirks.

### D3. Click-through + hover: the cursor poll, ported verbatim in spirit

Today `main.js` polls `screen.getCursorScreenPoint()` every 50 ms and flips
`setIgnoreMouseEvents` when the cursor enters/leaves the window rectangle, so the
renderer receives `mousemove` for tooltips only while hovered, and clicks pass
through otherwise. We keep this exact strategy: `NativeShell.getCursorPosition()`
(backed by `NSEvent`'s `mouseLocation` / `CGEventGetLocation`) feeds the same
hit-test logic, now living in testable `src/app` code rather than the shell.
Drag-to-move is the same: on `drag-start` (a renderer message) we stop ignoring
mouse events and move the window to follow the cursor until `drag-stop`.

Coordinate note: AppKit's origin is bottom-left and y-up; the app logic works in
the same top-left convention the Electron code used, and the **shell** is the only
place that converts. (Boundary owns the ugliness — Zakharchenko's lens.)

### D4. Assets: keep `peon-asset://`, served by a scheme handler + pure resolver

**(Revised — see Open Issue 7.)** An earlier draft replaced `peon-asset://` with a
localhost `Bun.serve()`. That was dropped: the renderer requests character assets
as `peon-asset://bg.png` (and the CSP allows `peon-asset:`), so a localhost server
would force editing those URLs — breaking the renderer-unchanged promise.

Instead we **keep the `peon-asset://` scheme** and serve it from a
`WKURLSchemeHandler` (Phase 5, FFI). The byte-mapping logic is a **pure resolver**
(`src/app/asset-resolver.ts`, Phase 3, no FFI) that the handler calls:

- **Character assets (host form)** `peon-asset://<filename>` → `renderer/assets`
  with the exact precedence of today: user char dir → bundled char-specific → orc
  fallback. (Logic shared with `src/app/characters.ts`.)
- **Renderer files (path form)** the document is loaded as
  `peon-asset://app/renderer/index.html`, so its relative refs resolve as path-form
  requests: `app.js`, `../node_modules/three/build/three.module.js`,
  `./shaders/flash.{vert,frag}` → files under the project root.

The resolver does no I/O itself (existence is injected), so it is fully unit-tested
headlessly; the handler is a thin adapter that streams bytes. CSP is unaffected
because the document origin is `peon-asset://app` and `default-src` already lists
the `peon-asset:` scheme.

### D5. IPC: a typed bridge that preserves `window.peonBridge`

The renderer expects `window.peonBridge` with `onEvent`, `onSessionUpdate`,
`onConfig`, `startDrag`, `stopDrag`. We preserve that surface:

- **Native → renderer:** `shell.window.evaluateJS("window.__peon.emit('event', …)")`.
  A ~10-line injected shim defines `window.peonBridge` in terms of `window.__peon`
  + `window.webkit.messageHandlers`. The renderer's own code is unchanged.
- **Renderer → native:** `window.webkit.messageHandlers.peon.postMessage({type:'drag-start'})`
  surfaces through a `WKScriptMessageHandler` as `shell.window.onMessage(cb)`.

The message payloads are a TypeScript discriminated union
(`type ShellMessage = {type:'drag-start'} | {type:'drag-stop'} | …`) — typed at
the boundary, validated on receipt.

### D6. App lifecycle, dock, single-instance — ported as-is

- `NSApplication` runs with activation policy `.regular` so the dock icon + menu
  (Hide/Show, Quit) survive; the non-activating panel keeps it from stealing
  focus. Dock menu clicks arrive via `NativeShell.onDockMenuClick`.
- Single-instance lock: a `Bun`-side lockfile/Unix socket in the user data dir
  replaces `app.requestSingleInstanceLock()`.
- Sub-agent windows: the same `createWindow` path produces up to 5 stacked panels,
  positioned and TTL-swept exactly as in `main.js` today.

### D7. Testing strategy (the Zakharchenko/Dodds payoff)

- **Pure logic** (`lib/*` ported): straight `bun test`, no shell.
- **Shell consumers** (positioning, hover hit-test, sub-agent lifecycle, IPC
  routing): tested against `FakeShell`, which records calls and lets a test script
  cursor positions and inbound messages. The integration test asserts behavior
  ("cursor enters rect → ignoreMouseEvents becomes false → renderer gets hover"),
  not implementation.
- **`AppKitShell`**: cannot be faithfully unit-tested (it's FFI into the OS).
  Covered by a documented manual macOS smoke checklist in `tasks.md`. We do not
  pretend otherwise — silent gaps are worse than named ones.

## Open issues

These must be resolved during implementation; don't let them block the spec.

1. **Window level vs. macOS menubar/notifications.** Screen-saver level may float
   over the menubar or Notification Center. Decide the exact level that clears
   normal app windows and full-screen apps but not system UI. *(Probe on device.)*
2. **WKWebView transparency.** *Resolved (Phase 5a, on-device):* `setValue:@NO
   forKey:@"drawsBackground"` succeeds (no exception) + `underPageBackgroundColor =
   clear` + `layer.opaque = NO` gives a transparent web view. The black square we
   first saw was NOT a webview-transparency bug — it was the renderer's *opaque*
   background mesh rendering black because its texture failed the cross-origin
   load. Fixed by the CORS header (Open Issue 8), not by transparency changes.
8. **Cross-origin textures over `peon-asset://`.** *Resolved (Phase 5a):* character
   assets are host-form (`peon-asset://sprite-atlas.png`) = a different origin from
   the document (`peon-asset://app`). three.js `TextureLoader` fetches with
   `crossOrigin=anonymous`, so the scheme handler MUST return
   `Access-Control-Allow-Origin: *` (via `NSHTTPURLResponse`) or textures are
   tainted and the orc renders invisibly. This is now required behavior, captured
   in the rendering spec.
3. **`objc_msgSend` ergonomics over `bun:ffi`.** *Resolved (Phase 4 spike):*
   chose the **thin C shim** (`native/peonshell.m`, a flat C API compiled to
   `libpeonshell.dylib`) over raw `objc_msgSend`. The shim takes scalars
   (e.g. 4 doubles) and builds `NSRect` natively, so `bun:ffi` never marshals
   structs or selectors. The spike proves it: `peon_init` + `peon_make_panel`
   bind and return a live `NSPanel`, and `peon_primary_work_height` reads the
   real display. AppKitShell (Phase 5) grows the shim's C surface; `bun:ffi`
   only ever sees scalar/pointer signatures.
4. **Cursor poll vs. event tap.** 50 ms polling matches today and is simple, but a
   `CGEventTap` would be lower-latency/lower-power. Default to polling (Luca's
   simplicity); revisit only if it shows up in Dana's battery numbers.
5. **Retain/release & GC.** FFI-held Obj-C objects must be retained so Bun's GC
   doesn't drop them and AppKit doesn't over-release. Define ownership rules in
   `AppKitShell` (keep strong JS refs for the window/webview/handlers).
6. **Jest → bun test migration scope.** ~~Some current tests use `canvas`.~~
   *Resolved (Phase 1):* all suites ported to `bun test` (native `spyOn` /
   `setSystemTime` / fake timers, no jest dep); 99 → 138 tests green.
7. **Asset delivery: scheme handler vs localhost server.** *Resolved (Phase 3):*
   chose the `peon-asset://` `WKURLSchemeHandler` over `Bun.serve()` to keep the
   renderer byte-for-byte (see D4). The remaining unknown is the
   `WKURLSchemeHandler` FFI wiring itself (Phase 5): start/stop of
   `WKURLSchemeTask`, streaming bytes, and MIME headers via `objc_msgSend`.

## Side notes

- **For reviewers:** the only file that may touch unsafe FFI is `AppKitShell`.
  Anything importing `bun:ffi` outside that file is a red flag in review.
- **For testers:** there is no automated coverage of the real window. The manual
  checklist in `tasks.md` (corner placement, over-fullscreen float, click-through,
  hover tooltip, drag, dock menu, sub-agent stacking, quit) is the gate.
- **For docs/README:** "Built on Electron + Three.js" becomes "Built on Bun +
  AppKit + Three.js"; `npm start` → `bun run start`; the manual event-simulation
  snippet still applies (it writes the same state the watcher reads).
