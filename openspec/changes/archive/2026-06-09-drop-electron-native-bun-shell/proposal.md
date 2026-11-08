# Drop Electron, run the pet on a native Bun + AppKit shell

## Why

Electron ships an entire Chromium + Node runtime (~150–200 MB on disk, ~100 MB+
resident) so that peon-pet can do one thing Chromium happens to allow: put a
transparent, always-on-top, click-through window in a corner of the screen. For a
six-frame sprite that mostly sleeps, that is a wildly disproportionate amount of
machinery — a browser engine hauled in as a window manager.

Bun is already the runtime the project wants: it executes TypeScript with no build
step, starts in milliseconds, and exposes `bun:ffi` for calling straight into
macOS frameworks. The orc's actual window behavior — float over everything, ignore
clicks, hover for tooltips — is a thin layer of AppKit (`NSPanel`) that we can
drive directly. The renderer (three.js sprite animation) can keep running, exactly
as written, inside the system's own WebKit instead of a bundled Chromium.

The win: drop the Chromium/Node payload, start faster, use less memory, and ship a
small, legible TypeScript codebase — **without rewriting the part users actually
see.**

## What Changes

- **Replace the Electron shell with a native AppKit shell** (`NSPanel` via
  `bun:ffi`): transparent, borderless, non-activating, floating above all spaces,
  click-through with hover-toggled mouse capture. Behavior is identical to today's
  `BrowserWindow` configuration.
- **Render the orc in a system `WKWebView`** layered into that panel, loading the
  **unchanged** `renderer/` (HTML + three.js + shaders).
- **Preserve the `peon-asset://` scheme** via a `WKURLSchemeHandler` backed by a
  pure, unit-tested resolver, so the renderer stays byte-for-byte unchanged. (An
  earlier draft proposed `Bun.serve()` on `127.0.0.1`; dropped because it would
  force rewriting the renderer's asset URLs.)
- **Replace Electron IPC** with `WKScriptMessageHandler` (renderer → native) and
  `evaluateJavaScript:` (native → renderer), behind a typed bridge that mirrors the
  current `window.peonBridge` surface so the renderer needs no changes.
- **Introduce a typed `NativeShell` boundary** (TypeScript interface) with two
  implementations: `AppKitShell` (real, FFI) and `FakeShell` (in-memory, for
  headless tests).
- **Port the existing app logic** — session tracker, JSONL watcher, sub-agent
  windows (main + up to 5), dock icon + menu, drag-to-move, corner positioning,
  single-instance lock — onto the new shell at **full parity**.
- **Migrate the test runner** from Jest to `bun test`; the pure `lib/` logic and
  the new shell-consumer code are tested against `FakeShell`.
- **BREAKING (developer-facing):** `npm start` / `electron .` is replaced by
  `bun run start` (`bun src/main.ts`). The Electron dependency, `main.js`,
  `preload.js`, and the `boolean` shim / Electron-only patches are removed.

## Impact

- **Affected capabilities:** `native-shell` (new), `pet-window` (mechanism
  changes, behavior preserved), `rendering` (substrate changes, renderer
  preserved).
- **Affected code:** new `src/` (TypeScript) for shell + entrypoint; `main.js`,
  `preload.js`, `patches/boolean-shim`, Electron deps removed; `lib/*.js` ported to
  TS and reused; `renderer/*` reused unchanged; `tests/*` moved to `bun test`;
  `install.sh` / `com.peonpet.app.plist` updated to launch Bun.
- **User-visible behavior:** none intended. The pet looks and acts the same.
- **Risk surface:** the FFI boundary (AppKit/WebKit calls) — isolated in
  `AppKitShell` and covered by a manual macOS smoke checklist, since FFI cannot be
  unit-tested faithfully.
