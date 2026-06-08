# rendering

## ADDED Requirements

### Requirement: Renderer runs unchanged in a system WKWebView

The orc SHALL be rendered by the existing `renderer/` code (HTML + three.js +
shaders) running inside a system `WKWebView`, with no Chromium and no required
changes to renderer source.

#### Scenario: Renderer source is preserved

- **WHEN** the migration is complete
- **THEN** `renderer/index.html`, `renderer/app.js`, and `renderer/shaders/*` are
  byte-for-byte the same as before the migration
- **AND** the orc, background, session dots, and tooltip render identically

#### Scenario: Transparent rendering surface

- **WHEN** the WKWebView is layered into the transparent panel
- **THEN** the web view does not draw an opaque background
- **AND** only the orc's non-transparent pixels are visible over the desktop

### Requirement: Assets served via the peon-asset:// scheme handler

The renderer's `peon-asset://` scheme SHALL be preserved and served by a
`WKURLSchemeHandler`, so the renderer is unchanged. A **pure resolver**
(`resolveAsset`) SHALL map each request to an on-disk file, and the handler
SHALL stream the bytes; the resolver performs no I/O of its own (existence checks
are injected) so it is fully unit-testable without FFI.

> Design note: an earlier draft proposed `Bun.serve()` on `127.0.0.1`. That was
> dropped because it would require rewriting the renderer's `peon-asset://` URLs,
> violating the renderer-unchanged constraint. The scheme handler keeps the
> renderer byte-for-byte and the existing CSP intact.

#### Scenario: Character asset resolution order (host form)

- **WHEN** the renderer requests a named asset (e.g. `peon-asset://sprite-atlas.png`)
- **THEN** the resolver returns the user-installed character file if present
- **ELSE** the bundled character-specific file if mapped
- **ELSE** the orc fallback file
- **ELSE** returns not-found

#### Scenario: Renderer files resolve under the project root (path form)

- **WHEN** the document is loaded as `peon-asset://app/renderer/index.html` and its
  relative refs resolve (`app.js`, `../node_modules/three/...`, `./shaders/*`)
- **THEN** each path-form request maps to the corresponding file under the project
  root
- **AND** a request whose normalized path would escape the project root cannot
  reach a file outside it

#### Scenario: CSP remains valid

- **WHEN** the document loads over `peon-asset://`
- **THEN** the existing Content-Security-Policy continues to permit the page,
  its scripts, and its assets without modification

### Requirement: Typed renderer/native bridge preserving peonBridge

Communication between native shell and renderer SHALL go through a typed message
contract, and the renderer's existing `window.peonBridge` API
(`onEvent`, `onSessionUpdate`, `onConfig`, `startDrag`, `stopDrag`) SHALL remain
available unchanged.

#### Scenario: Native pushes an event to the renderer

- **WHEN** application logic emits a peon event, session update, or config
- **THEN** it is delivered to the renderer such that the corresponding
  `window.peonBridge` callback fires with the same payload shape as today

#### Scenario: Renderer sends drag intents to native

- **WHEN** the renderer calls `peonBridge.startDrag()` or `stopDrag()`
- **THEN** a typed message reaches the shell and drives the window drag behavior
- **AND** malformed inbound messages are rejected at the boundary
