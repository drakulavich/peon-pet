// AppKitShell — the real NativeShell, backed by native/libpeonshell.dylib via
// bun:ffi. THE ONLY production file that imports bun:ffi.
//
// Coordinate conventions: the rest of the app works in top-left-origin work-area
// coordinates (like Electron). AppKit uses bottom-left full-screen coordinates.
// All conversion happens here (design D3); the shim returns raw AppKit values.

import { CString, dlopen, FFIType, JSCallback, type Pointer } from "bun:ffi";
import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  parseShellMessage,
  type DockMenuItem,
  type NativeShell,
  type Point,
  type ShellMessage,
  type Size,
  type WindowHandle,
  type WindowOptions,
  type WorkArea,
} from "./types.ts";

const cstr = (s: string): Buffer => Buffer.from(s + "\0", "utf8");

function loadLib(dylibPath: string) {
  return dlopen(dylibPath, {
    peon_init: { args: [], returns: FFIType.void },
    peon_set_verbose: { args: [FFIType.bool], returns: FFIType.void },
    peon_set_project_root: { args: [FFIType.cstring], returns: FFIType.void },
    peon_set_three_dir: { args: [FFIType.cstring], returns: FFIType.void },
    peon_register_asset: { args: [FFIType.cstring, FFIType.cstring], returns: FFIType.void },
    peon_make_webview_panel: {
      args: [FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64],
      returns: FFIType.ptr,
    },
    peon_panel_load: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.void },
    peon_panel_eval: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.void },
    peon_panel_show: { args: [FFIType.ptr], returns: FFIType.void },
    peon_panel_hide: { args: [FFIType.ptr], returns: FFIType.void },
    peon_panel_destroy: { args: [FFIType.ptr], returns: FFIType.void },
    peon_panel_set_ignore_mouse: { args: [FFIType.ptr, FFIType.bool], returns: FFIType.void },
    peon_panel_set_origin: { args: [FFIType.ptr, FFIType.f64, FFIType.f64], returns: FFIType.void },
    peon_work_left: { args: [], returns: FFIType.f64 },
    peon_work_top: { args: [], returns: FFIType.f64 },
    peon_work_width: { args: [], returns: FFIType.f64 },
    peon_work_height: { args: [], returns: FFIType.f64 },
    peon_cursor_x: { args: [], returns: FFIType.f64 },
    peon_cursor_y: { args: [], returns: FFIType.f64 },
    peon_run: { args: [], returns: FFIType.void },
    peon_pump_begin: { args: [], returns: FFIType.void },
    peon_pump: { args: [], returns: FFIType.void },
    peon_set_message_callback: { args: [FFIType.ptr], returns: FFIType.void },
    peon_set_dock_callback: { args: [FFIType.ptr], returns: FFIType.void },
    peon_set_dock_icon: { args: [FFIType.cstring], returns: FFIType.void },
    peon_dock_menu_clear: { args: [], returns: FFIType.void },
    peon_dock_menu_add: { args: [FFIType.cstring, FFIType.cstring], returns: FFIType.void },
    peon_dock_menu_add_separator: { args: [], returns: FFIType.void },
  });
}

type Sym = ReturnType<typeof loadLib>["symbols"];

class AppKitWindow implements WindowHandle {
  readonly id: number;
  #ptr: ReturnType<Sym["peon_make_webview_panel"]>;
  #sym: Sym;
  #toAppKitY: (topY: number, height: number) => number;
  #toAppKitX: (topX: number) => number;
  #pos: Point;
  #size: Size;
  #ignoring: boolean;
  #visible = true;
  #destroyed = false;
  #messageHandlers: ((msg: ShellMessage) => void)[] = [];
  #onDestroy: () => void;

  constructor(
    id: number,
    ptr: ReturnType<Sym["peon_make_webview_panel"]>,
    sym: Sym,
    opts: WindowOptions,
    conv: {
      toAppKitX: (x: number) => number;
      toAppKitY: (y: number, h: number) => number;
      onDestroy: () => void;
    },
  ) {
    this.id = id;
    this.#ptr = ptr;
    this.#sym = sym;
    this.#toAppKitX = conv.toAppKitX;
    this.#toAppKitY = conv.toAppKitY;
    this.#onDestroy = conv.onDestroy;
    this.#pos = { x: opts.x, y: opts.y };
    this.#size = { width: opts.width, height: opts.height };
    this.#ignoring = opts.ignoreMouseEvents ?? true;
  }

  getPosition(): Point {
    return { ...this.#pos };
  }
  setPosition(x: number, y: number): void {
    this.#pos = { x, y };
    this.#sym.peon_panel_set_origin(this.#ptr, this.#toAppKitX(x), this.#toAppKitY(y, this.#size.height));
  }
  getSize(): Size {
    return { ...this.#size };
  }

  setIgnoreMouseEvents(ignore: boolean): void {
    this.#ignoring = ignore;
    this.#sym.peon_panel_set_ignore_mouse(this.#ptr, ignore);
  }
  isIgnoringMouseEvents(): boolean {
    return this.#ignoring;
  }

  show(): void {
    this.#visible = true;
    this.#sym.peon_panel_show(this.#ptr);
  }
  hide(): void {
    this.#visible = false;
    this.#sym.peon_panel_hide(this.#ptr);
  }
  isVisible(): boolean {
    return this.#visible;
  }

  loadURL(url: string): void {
    this.#sym.peon_panel_load(this.#ptr, cstr(url));
  }
  evaluateJS(script: string): void {
    this.#sym.peon_panel_eval(this.#ptr, cstr(script));
  }
  onMessage(cb: (msg: ShellMessage) => void): void {
    this.#messageHandlers.push(cb);
  }

  /** The native panel pointer — used by AppKitShell to route inbound messages. */
  get nativePtr(): ReturnType<Sym["peon_make_webview_panel"]> {
    return this.#ptr;
  }

  /** Deliver a validated renderer→native message to this window's handlers. */
  dispatchMessage(msg: ShellMessage): void {
    for (const cb of this.#messageHandlers) cb(msg);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#sym.peon_panel_destroy(this.#ptr);
    this.#onDestroy();
  }
  isDestroyed(): boolean {
    return this.#destroyed;
  }
}

export interface AppKitShellOptions {
  /** Project root + resolved character-asset paths to serve over peon-asset://. */
  projectRoot: string;
  assets: { name: string; filePath: string }[];
  /** Vendored three.js build dir (published package); null/omit for a git clone. */
  threeBuildDir?: string | null;
  /** Native diagnostics to stderr. */
  verbose?: boolean;
  /** Override the dylib path (defaults to ../native/libpeonshell.dylib). */
  dylibPath?: string;
}

export class AppKitShell implements NativeShell {
  #sym: Sym;
  #nextId = 1;
  #windowsByPtr = new Map<number, AppKitWindow>();
  #dockClickHandler: ((id: string) => void) | null = null;
  // JSCallbacks must be retained for their lifetime, or the GC frees the trampoline.
  #messageCb: JSCallback;
  #dockCb: JSCallback;

  constructor(opts: AppKitShellOptions) {
    const dylib = opts.dylibPath ?? join(import.meta.dir, "..", "..", "native", "libpeonshell.dylib");
    if (!existsSync(dylib)) {
      throw new Error(`Native shim not found at ${dylib}. Run: bun run build:native`);
    }
    this.#sym = loadLib(dylib).symbols;
    this.#sym.peon_init();
    this.#sym.peon_set_verbose(opts.verbose ?? false);
    // Finish app launch BEFORE any window is created/shown, so panels composite
    // under the cooperative pump.
    this.#sym.peon_pump_begin();
    this.#sym.peon_set_project_root(cstr(opts.projectRoot));
    if (opts.threeBuildDir) this.#sym.peon_set_three_dir(cstr(opts.threeBuildDir));
    for (const a of opts.assets) this.#sym.peon_register_asset(cstr(a.name), cstr(a.filePath));

    // Renderer → native (drag-start/stop): route to the owning window.
    this.#messageCb = new JSCallback(
      (panelPtr: Pointer, typePtr: Pointer) => {
        const win = panelPtr ? this.#windowsByPtr.get(Number(panelPtr)) : undefined;
        const msg = parseShellMessage({ type: typePtr ? new CString(typePtr).toString() : "" });
        if (win && msg) win.dispatchMessage(msg);
      },
      { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.void },
    );
    this.#sym.peon_set_message_callback(this.#messageCb.ptr);

    // Dock menu clicks.
    this.#dockCb = new JSCallback(
      (idPtr: Pointer) => {
        if (idPtr) this.#dockClickHandler?.(new CString(idPtr).toString());
      },
      { args: [FFIType.ptr], returns: FFIType.void },
    );
    this.#sym.peon_set_dock_callback(this.#dockCb.ptr);
  }

  #toAppKitX = (topX: number): number => this.#sym.peon_work_left() + topX;
  #toAppKitY = (topY: number, height: number): number =>
    this.#sym.peon_work_top() - topY - height;

  createWindow(opts: WindowOptions): WindowHandle {
    const ptr = this.#sym.peon_make_webview_panel(
      this.#toAppKitX(opts.x),
      this.#toAppKitY(opts.y, opts.height),
      opts.width,
      opts.height,
    );
    const key = ptr ? Number(ptr) : 0;
    const win = new AppKitWindow(this.#nextId++, ptr, this.#sym, opts, {
      toAppKitX: this.#toAppKitX,
      toAppKitY: this.#toAppKitY,
      onDestroy: () => this.#windowsByPtr.delete(key),
    });
    if (ptr) this.#windowsByPtr.set(key, win);
    return win;
  }

  getCursorPosition(): Point {
    // AppKit bottom-left → top-left within the work area.
    return {
      x: this.#sym.peon_cursor_x() - this.#sym.peon_work_left(),
      y: this.#sym.peon_work_top() - this.#sym.peon_cursor_y(),
    };
  }

  getPrimaryWorkArea(): WorkArea {
    return { width: this.#sym.peon_work_width(), height: this.#sym.peon_work_height() };
  }

  setDockIcon(iconPath: string): void {
    this.#sym.peon_set_dock_icon(cstr(iconPath));
  }

  setDockMenu(items: DockMenuItem[]): void {
    this.#sym.peon_dock_menu_clear();
    for (const item of items) {
      if ("separator" in item) this.#sym.peon_dock_menu_add_separator();
      else this.#sym.peon_dock_menu_add(cstr(item.id), cstr(item.label));
    }
  }

  onDockMenuClick(cb: (id: string) => void): void {
    this.#dockClickHandler = cb;
  }

  /** Enter the AppKit run loop. Blocks; the GUI lives here. (Used by the spike.) */
  run(): void {
    this.#sym.peon_run();
  }

  /**
   * Service the Cocoa run loop for one slice. Call this on a Bun timer (~16ms)
   * so the GUI renders while Bun's event loop keeps driving the JSONL watcher,
   * cursor poll, and heartbeat. Returns a handle you can clearInterval.
   */
  startPumping(intervalMs = 16): ReturnType<typeof setInterval> {
    return setInterval(() => this.#sym.peon_pump(), intervalMs);
  }
}
