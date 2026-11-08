// In-memory NativeShell for headless tests. No FFI, no real window.
// Records operations and lets a test script the cursor and inbound messages.

import type {
  DockMenuItem,
  NativeShell,
  Point,
  ShellMessage,
  Size,
  WindowHandle,
  WindowOptions,
  WorkArea,
} from "./types.ts";

export class FakeWindow implements WindowHandle {
  readonly id: number;
  private pos: Point;
  private size: Size;
  private ignoring: boolean;
  private visible = true;
  private destroyed = false;

  /** Recorded interaction history, for assertions. */
  readonly calls: string[] = [];
  loadedURL: string | null = null;
  readonly evaluated: string[] = [];
  private messageHandlers: ((msg: ShellMessage) => void)[] = [];

  constructor(id: number, opts: WindowOptions) {
    this.id = id;
    this.pos = { x: opts.x, y: opts.y };
    this.size = { width: opts.width, height: opts.height };
    this.ignoring = opts.ignoreMouseEvents ?? true;
  }

  getPosition(): Point {
    return { ...this.pos };
  }
  setPosition(x: number, y: number): void {
    this.pos = { x, y };
    this.calls.push(`setPosition(${x},${y})`);
  }
  getSize(): Size {
    return { ...this.size };
  }

  setIgnoreMouseEvents(ignore: boolean): void {
    this.ignoring = ignore;
    this.calls.push(`setIgnoreMouseEvents(${ignore})`);
  }
  isIgnoringMouseEvents(): boolean {
    return this.ignoring;
  }

  show(): void {
    this.visible = true;
    this.calls.push("show");
  }
  hide(): void {
    this.visible = false;
    this.calls.push("hide");
  }
  isVisible(): boolean {
    return this.visible;
  }

  loadURL(url: string): void {
    this.loadedURL = url;
    this.calls.push(`loadURL(${url})`);
  }
  evaluateJS(script: string): void {
    this.evaluated.push(script);
  }
  onMessage(cb: (msg: ShellMessage) => void): void {
    this.messageHandlers.push(cb);
  }

  destroy(): void {
    this.destroyed = true;
    this.calls.push("destroy");
  }
  isDestroyed(): boolean {
    return this.destroyed;
  }

  // ── test-only driver API ──────────────────────────────────────────────────
  /** Simulate a validated message arriving from the renderer. */
  emitMessage(msg: ShellMessage): void {
    for (const cb of this.messageHandlers) cb(msg);
  }
}

export class FakeShell implements NativeShell {
  private nextId = 1;
  readonly windows: FakeWindow[] = [];
  private cursor: Point = { x: 0, y: 0 };
  private workArea: WorkArea = { width: 1920, height: 1080 };

  dockIcon: string | null = null;
  dockMenu: DockMenuItem[] = [];
  private dockClickHandler: ((id: string) => void) | null = null;

  createWindow(opts: WindowOptions): FakeWindow {
    const win = new FakeWindow(this.nextId++, opts);
    this.windows.push(win);
    return win;
  }

  getCursorPosition(): Point {
    return { ...this.cursor };
  }
  getPrimaryWorkArea(): WorkArea {
    return { ...this.workArea };
  }

  setDockIcon(iconPath: string): void {
    this.dockIcon = iconPath;
  }
  setDockMenu(items: DockMenuItem[]): void {
    this.dockMenu = items;
  }
  onDockMenuClick(cb: (id: string) => void): void {
    this.dockClickHandler = cb;
  }

  // ── test-only driver API ────────────────────────────────────────────────────
  setCursor(x: number, y: number): void {
    this.cursor = { x, y };
  }
  setWorkArea(width: number, height: number): void {
    this.workArea = { width, height };
  }
  clickDockMenu(id: string): void {
    this.dockClickHandler?.(id);
  }
  /** Windows that have not been destroyed. */
  liveWindows(): FakeWindow[] {
    return this.windows.filter((w) => !w.isDestroyed());
  }
}
