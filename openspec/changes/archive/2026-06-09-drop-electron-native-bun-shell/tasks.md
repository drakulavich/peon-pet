# Tasks — Drop Electron, native Bun + AppKit shell

Strangler-fig order: stand up the new shell beside Electron, port one capability at
a time keeping the app runnable, delete Electron last. Each phase leaves the pet
working.

## 1. Project setup (TypeScript + Bun)

- [x] 1.1 Add `tsconfig.json` (strict, `@types/bun`); confirm `bun --version` ≥ 1.3 (1.3.13)
- [~] 1.2 Create `src/` layout: `app/` done; `shell/` (Phase 2) and `main.ts` (Phase 6) pending
- [x] 1.3 Port `lib/*.js` → `src/app/*.ts` (session-tracker, jsonl-watcher,
      anim-state, window-position) with no logic change; add types
- [x] 1.4 Move tests to `bun test`; ported all `tests/*.test.js` → `*.test.ts`
      (native `spyOn`/`setSystemTime`/fake timers, no jest dep). 99/99 green;
      `tsc --noEmit` clean; Electron path still loads

## 2. The boundary

- [x] 2.1 Define `NativeShell` interface + `WindowHandle` + `ShellMessage` union in
      `src/shell/types.ts` (incl. `parseShellMessage` boundary validation)
- [x] 2.2 Implement `FakeShell` (`src/shell/fake.ts`): in-memory windows, scriptable
      cursor + inbound messages, call recording
- [x] 2.3 Write integration tests against `FakeShell`: hover hit-test toggles
      `setIgnoreMouseEvents`, drag follows cursor, sub-agent create/destroy/restack.
      Pulled the app controllers forward to satisfy these tests:
      `src/app/window-interaction.ts` (hover+drag, was task 6.5) and
      `src/app/sub-agent-manager.ts` (cap/restack/TTL, was task 6.2). 19 tests green.

## 3. Asset resolution (no FFI — do this before AppKit)

> Decision (Open Issue 7): keep `peon-asset://` via a `WKURLSchemeHandler` rather
> than `Bun.serve()`, to keep the renderer byte-for-byte. Phase 3 ships the pure
> resolver; the FFI handler wiring is task 5.x.

- [x] 3.1 `src/app/characters.ts` (BUNDLED_CHARS map ported) + `src/app/asset-resolver.ts`:
      pure `resolveAsset()` — host-form character assets (user → bundled → orc
      fallback) and path-form renderer files under the project root, injected
      existence check, content types
- [x] 3.2 Unit-test resolution order, fallback, content types, and path-form /
      traversal-clamp behavior (no FFI). All green.

## 4. FFI spike — prove a real window (DECISION: C shim, not raw objc_msgSend)

> Resolved Open Issue 3: use a flat C shim (`native/peonshell.m` →
> `libpeonshell.dylib`, built by `bun run build:native`) so `bun:ffi` only sees
> scalar/pointer signatures. `src/spike.ts` exercises it.

- [x] 4.1 C shim + FFI bootstrap: `dlopen(libpeonshell.dylib)` with scalar/pointer
      signatures (no objc_msgSend marshaling). Verified by `bun run src/spike.ts --check`.
- [x] 4.2 `NSApplication` init (activation policy `.regular`) via `peon_init`;
      `peon_run` enters the AppKit run loop.
- [x] 4.3 Create the `NSPanel`: borderless + non-activating, opaque-off + clear-ish
      translucent fill, no shadow, screen-saver level + all-spaces collection
      behavior (`peon_make_panel`). **Visual confirmation pending on-device.**
- [x] 4.4 `peon_panel_show` / `peon_panel_set_origin` / `peon_panel_set_ignore_mouse`
      (move / show / click-through toggle). ARC `CFBridgingRetain` keeps the panel
      alive (Open Issue 5). `hide`/`destroy` to add in Phase 5.
- [~] 4.5 `peon_primary_work_height` done (for bottom-left y conversion);
      `getCursorPosition` + full `getPrimaryWorkArea` to add in Phase 5.
- [x] 4.6 `setIgnoreMouseEvents` exposed (`peon_panel_set_ignore_mouse`); wiring the
      cursor-poll hover loop (`WindowInteraction`) to it is Phase 6.

### 4.GATE — on-device visual confirmation (USER runs this)
- [ ] G1 `bun run build:native && bun run spike` → translucent square appears
      bottom-left
- [ ] G2 it floats over a normal window and a full-screen app; no focus theft
- [ ] G3 clicking it passes through to the window beneath

## 5. AppKitShell — WKWebView + bridge

- [x] 5.1 `WKWebView` as content view; `drawsBackground=NO` + `underPageBackgroundColor`
      clear for transparency (Open Issue 2) — `peon_make_webview_panel`.
- [x] 5.2a `peon-asset://` `WKURLSchemeHandler` in the shim, serving bytes for paths
      resolved by the **TS** resolver (`peon_register_asset` / `peon_set_project_root`).
      Demo (`src/demo-orc.ts`) registers the 4 char assets and loads
      `peon-asset://app/renderer/index.html`. No crash on load.
- [x] 5.2b Inject the `window.peonBridge` shim (`onEvent`/`onSessionUpdate`/`onConfig`/
      `startDrag`/`stopDrag`) + `window.__peonEmit` over `WKScriptMessageHandler`
      at document-start, so the unchanged renderer boots without a preload.
- [x] 5.2c **CORS fix:** scheme handler returns `NSHTTPURLResponse` with
      `Access-Control-Allow-Origin: *`. Character assets are host-form
      (`peon-asset://<file>`) = cross-origin vs the document; three.js TextureLoader
      uses `crossOrigin=anonymous`, so without this the textures were tainted and
      the orc drew invisibly (confirmed: 1428 GL draws, no pixels).
- [~] 5.3 `WKScriptMessageHandler` (renderer→native, "peon" channel) wired and
      `window.__peonEmit` ready for native→renderer; `evaluateJS` push +
      `onMessage` routing into `WindowInteraction` is Phase 6.
- [x] 5.4 Renderer animates in the panel. **Visually confirmed on-device (G4+G5).**

### 5.GATE — on-device visual confirmation ✅ DONE
- [x] G4 `bun run demo` → the **sleeping orc** renders bottom-left in a transparent
      panel (real renderer, system WebKit, no Electron) — confirmed via screenshot.
- [x] G5 background + sprite + borders all render (scheme handler + three.js + CORS).

### 6.GATE — reactive behavior
- [x] G6 ✅ on-device: orc renders bottom-left and animates on events (confirmed
      typing pose + 2 green session dots via screenshot); `--dev` logs
      `→ orc: typing (UserPromptSubmit)` / `celebrate (Stop)` against the live session.
- [ ] G7 hover the orc → tooltip/session-dot info appears (click-through toggles).

> Follow-up (6b polish): `peon_pump_begin` uses `activateIgnoringOtherApps:YES`,
> which steals focus once at launch. A pet shouldn't; revisit with a gentler
> activation now that compositing is proven.

## 6. Wire the app onto the shell

> Run-loop integration (was Open Issue 4.2): solved with a **cooperative pump** —
> `AppKitShell.startPumping()` services the Cocoa run loop on a 16ms Bun timer
> instead of blocking in `[NSApp run]`, so the JSONL watcher / cursor poll /
> heartbeat keep running on Bun's loop. Verified: `main.ts` stays alive + renders.

- [x] 6.1 `src/shell/appkit.ts` (`AppKitShell` implements `NativeShell` via the shim;
      top-left↔AppKit coordinate conversion here) + `src/main.ts`: resolve+register
      assets, create main window, load renderer, start `JsonlWatcher`, push events
      via `evaluateJS(window.__peonEmit(...))`, hover click-through via
      `WindowInteraction` + cursor poll. `bun run start:bun` / `dev:bun`.
- [x] 6.2 Sub-agent windows wired in `main.ts`: `subagent-event` → `SubAgentManager`
      create/destroy, per-window `WindowInteraction`, `onConfig({size:100})` +
      waking pushed after load, TTL sweep in the heartbeat.
- [x] 6.3 Dock icon + Hide/Show/Quit menu via the shell. Shim: `applicationDockMenu:`
      + `peon_dock_menu_*` + `peon_set_dock_icon`; clicks routed to JS via a
      `JSCallback` (`onDockMenuClick`).
- [x] 6.4 Single-instance lock: `src/app/single-instance.ts` (Unix socket, stale-file
      reclaim). Verified — 2nd launch prints "already running" and exits 0. +2 tests.
- [x] 6.5 Drag-to-move end-to-end: renderer `peonBridge.startDrag/stopDrag` →
      `WKScriptMessageHandler` → `JSCallback` → owning window's `onMessage` →
      `WindowInteraction`. Corner config honored via `cornerPosition`.

## 7. Cut over and delete Electron ✅

- [x] 7.1 `package.json`: `start`/`dev` → `bun run build:native && bun src/main.ts`;
      removed `electron` + `boolean` override. (`canvas` kept — used by
      `scripts/gen-*.js`.)
- [x] 7.2 Deleted `main.js`, `preload.js`, `patches/boolean-shim`, **and** the now-dead
      `lib/*.js` (superseded by `src/app/*.ts`).
- [x] 7.3 `install.sh` + `com.peonpet.app.plist` launch Bun (`bun run <app>/src/main.ts`),
      building the native shim at install time.
- [x] 7.4 Updated `README.md` (Bun/AppKit, architecture, `bun run start`) and
      `CHANGELOG.md`. Verified: 138 tests, `tsc` clean, `bun run start` launches.

## 8. Manual macOS smoke checklist (the gate — FFI is not unit-tested)

Run on the target macOS version; all must pass before merge:

Verified on-device (2026-06-09):

- [x] 8.1 Pet appears bottom-left, correct size/margin
- [x] 8.2 Floats over a normal window **and** over a full-screen app; no focus theft
- [x] 8.3 Click-through — **accepted as Electron-parity (choice B):** clicks pass
      through when not hovering; while hovering the orc the window captures (so
      hover + drag work) and the click is consumed. Docs/spec corrected to match.
- [x] 8.4 Hover shows tooltips; session-dot hover shows project names
- [x] 8.5 Drag relocates the pet; click-through resumes after
- [x] 8.6 Animations fire on real Claude Code events (waking/typing/celebrate/…)
- [x] 8.7 Sub-agent mini-pets appear (≤5), stack, and disappear on stop/TTL
- [x] 8.8 Dock menu Hide/Show/Quit work; second launch is blocked
- [x] 8.9 Idle memory measured vs. the old Electron build → `benchmarks.md`.
      Electron 713.7 MB / 6 procs / 276 MB disk → Bun 439.7 MB / 4 procs / 76 KB shim
      (−38% RSS, −99.97% per-app disk). Caveat: Bun is main-window-only so far.

## 9. Spec sync

- [ ] 9.1 After deployment, fold these deltas into `openspec/specs/` and archive
      this change
