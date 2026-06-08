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
- [ ] 5.2b Inject the ~10-line `window.peonBridge` shim over
      `window.webkit.messageHandlers` + an injected emit hook (for IPC)
- [ ] 5.3 `evaluateJS` (native→renderer) and `WKScriptMessageHandler`
      (renderer→native) wired to `onMessage`; validate inbound `ShellMessage`
- [~] 5.4 Renderer loads in the panel without crashing; **on-device visual
      confirmation that the orc animates is the USER gate below**

### 5.GATE — on-device visual confirmation (USER runs this)
- [ ] G4 `bun run build:native && bun run demo` → the **sleeping orc** appears
      bottom-left in a transparent panel (your real renderer, system WebKit, no Electron)
- [ ] G5 background/sprite/borders render correctly (scheme handler + three.js OK)

## 6. Wire the app onto the shell

- [ ] 6.1 `src/main.ts`: instantiate `AppKitShell`, create main window, start asset
      server, start `JsonlWatcher`, push events via `evaluateJS`
- [x] 6.2 Sub-agent windows: up to 5 stacked panels, positioning + TTL sweep ported
      from `main.js` (`src/app/sub-agent-manager.ts`, done in Phase 2 — wiring to a
      real shell still pending)
- [ ] 6.3 Dock icon + menu (Hide/Show/Quit) via shell; `onDockMenuClick`
- [ ] 6.4 Single-instance lock (lockfile/Unix socket in user data dir)
- [~] 6.5 Drag-to-move logic done (`src/app/window-interaction.ts`, Phase 2);
      end-to-end wiring + corner config honored still pending

## 7. Cut over and delete Electron

- [ ] 7.1 `package.json`: `start`/`dev` → `bun src/main.ts`; remove `electron`,
      `canvas` (if unused), `boolean` override
- [ ] 7.2 Delete `main.js`, `preload.js`, `patches/boolean-shim`
- [ ] 7.3 Update `install.sh` + `com.peonpet.app.plist` to launch Bun
- [ ] 7.4 Update `README.md` (Electron→Bun/AppKit, `npm start`→`bun run start`)
      and `CHANGELOG.md`

## 8. Manual macOS smoke checklist (the gate — FFI is not unit-tested)

Run on the target macOS version; all must pass before merge:

- [ ] 8.1 Pet appears bottom-left, correct size/margin
- [ ] 8.2 Floats over a normal window **and** over a full-screen app; no focus theft
- [ ] 8.3 Click over the pet passes through to the window beneath
- [ ] 8.4 Hover shows tooltips; session-dot hover shows project names
- [ ] 8.5 Drag relocates the pet; click-through resumes after
- [ ] 8.6 Animations fire on real Claude Code events (waking/typing/celebrate/…)
- [ ] 8.7 Sub-agent mini-pets appear (≤5), stack, and disappear on stop/TTL
- [ ] 8.8 Dock menu Hide/Show/Quit work; second launch is blocked
- [ ] 8.9 Idle memory + CPU measured and recorded vs. the old Electron build
      (Dana's scenario — capture the win)

## 9. Spec sync

- [ ] 9.1 After deployment, fold these deltas into `openspec/specs/` and archive
      this change
