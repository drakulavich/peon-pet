// The NativeShell boundary — the single seam between application logic and the
// operating system. Application code (src/app) depends ONLY on these types.
// Real impl: src/shell/appkit.ts (bun:ffi). Test impl: src/shell/fake.ts.

/** Top-left-origin screen point (y increases downward). */
export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** A screen rectangle in the same top-left-origin space. */
export interface Rect extends Point, Size {}

/** Usable area of a display (excludes menu bar / dock). */
export type WorkArea = Size;

export interface WindowOptions {
  width: number;
  height: number;
  x: number;
  y: number;
  /** Start click-through (mouse events ignored). Defaults to true. */
  ignoreMouseEvents?: boolean;
}

/** A dock menu entry: either a clickable item or a separator. */
export type DockMenuItem = { id: string; label: string } | { separator: true };

/**
 * Messages the renderer can send to the shell. Kept as a discriminated union so
 * the boundary is typed end to end. Unknown shapes are rejected by
 * {@link parseShellMessage}.
 */
export type ShellMessage = { type: "drag-start" } | { type: "drag-stop" };

const SHELL_MESSAGE_TYPES = new Set(["drag-start", "drag-stop"]);

/** Validate an untrusted inbound payload into a ShellMessage, or null. */
export function parseShellMessage(raw: unknown): ShellMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const type = (raw as { type?: unknown }).type;
  if (typeof type !== "string" || !SHELL_MESSAGE_TYPES.has(type)) return null;
  return { type } as ShellMessage;
}

/** A single native window. Coordinates are top-left-origin. */
export interface WindowHandle {
  readonly id: number;

  getPosition(): Point;
  setPosition(x: number, y: number): void;
  getSize(): Size;

  setIgnoreMouseEvents(ignore: boolean): void;
  isIgnoringMouseEvents(): boolean;

  show(): void;
  hide(): void;
  isVisible(): boolean;

  /** Point the embedded web view at a URL (the localhost asset server). */
  loadURL(url: string): void;
  /** Run JS in the web view (native → renderer). */
  evaluateJS(script: string): void;
  /** Subscribe to validated renderer → native messages. */
  onMessage(cb: (msg: ShellMessage) => void): void;

  destroy(): void;
  isDestroyed(): boolean;
}

/**
 * The operating-system surface. The ONLY place allowed to import bun:ffi is the
 * concrete AppKit implementation of this interface.
 */
export interface NativeShell {
  createWindow(opts: WindowOptions): WindowHandle;

  /** Global cursor position, top-left-origin. */
  getCursorPosition(): Point;
  /** Primary display usable work area. */
  getPrimaryWorkArea(): WorkArea;

  setDockIcon(iconPath: string): void;
  setDockMenu(items: DockMenuItem[]): void;
  onDockMenuClick(cb: (id: string) => void): void;
}
