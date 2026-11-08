# native-shell Specification

## Purpose
TBD - created by archiving change drop-electron-native-bun-shell. Update Purpose after archive.
## Requirements
### Requirement: Typed NativeShell boundary

The system SHALL expose all operating-system window, cursor, and dock operations
through a single TypeScript `NativeShell` interface. Application logic MUST depend
only on this interface and MUST NOT import `bun:ffi` or call AppKit directly.

#### Scenario: Application code stays platform-agnostic

- **WHEN** any module under `src/app/` needs to create a window, move it, toggle
  click-through, read the cursor, or set the dock menu
- **THEN** it calls a method on an injected `NativeShell` instance
- **AND** it does not reference `bun:ffi`, `objc`, AppKit, or WebKit symbols

#### Scenario: Only the real shell touches FFI

- **WHEN** the codebase is searched for imports of `bun:ffi`
- **THEN** the only match is the `AppKitShell` implementation file

### Requirement: AppKit implementation via bun:ffi

The system SHALL provide an `AppKitShell` implementation of `NativeShell` that
drives `NSApplication`, `NSPanel`, and `WKWebView` through `bun:ffi` against the
Objective-C runtime, with no Electron or Chromium dependency.

#### Scenario: Window is created with the required traits

- **WHEN** `AppKitShell.createWindow(opts)` is called
- **THEN** it creates a borderless, non-activating `NSPanel`
- **AND** the panel is transparent (`opaque = false`, clear background, no shadow)
- **AND** the panel floats above normal application and full-screen windows
- **AND** the panel begins with mouse events ignored (click-through on)

#### Scenario: FFI-held native objects are retained

- **WHEN** a window, web view, or message handler is created through FFI
- **THEN** `AppKitShell` keeps a strong JavaScript reference to it for its lifetime
- **AND** the object is explicitly released only when the window is destroyed

### Requirement: In-memory FakeShell for headless tests

The system SHALL provide a `FakeShell` implementation of `NativeShell` that records
operations and simulates cursor position and inbound renderer messages, with no
FFI and no real window, so the suite runs headlessly.

#### Scenario: Logic is testable without a window

- **WHEN** application logic runs against `FakeShell` in `bun test`
- **THEN** no native window is created and no FFI is loaded
- **AND** the test can assert which shell methods were called, with what arguments
- **AND** the test can script a cursor position and an inbound message and observe
  the resulting calls (e.g. `setIgnoreMouseEvents` toggling on hover)

### Requirement: Cursor and work-area queries

The `NativeShell` SHALL report the current global cursor position and the primary
display's usable work area, in the top-left-origin coordinate convention used by
application logic.

#### Scenario: Coordinate conversion is confined to the shell

- **WHEN** application logic reads `getCursorPosition()` or `getPrimaryWorkArea()`
- **THEN** the returned coordinates use a top-left origin with y increasing
  downward
- **AND** any conversion from AppKit's bottom-left origin happens inside
  `AppKitShell`, not in application logic

