// Hover-driven click-through + drag-to-move for a single window.
// Shell-agnostic port of main.js's startMouseTrackingForWindow + drag IPC.
//
// Click-through is on by default; while the cursor is inside the window we turn
// it off so the renderer receives mousemove (tooltips). A drag-start message
// (from the renderer) makes the window follow the cursor until drag-stop.

import type { NativeShell, WindowHandle } from "../shell/types.ts";

export interface WindowInteractionOptions {
  /** Main pet is draggable; sub-agent mini-pets are not. */
  draggable?: boolean;
}

export class WindowInteraction {
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(
    private readonly shell: NativeShell,
    private readonly window: WindowHandle,
    opts: WindowInteractionOptions = {},
  ) {
    if (opts.draggable) {
      this.window.onMessage((msg) => {
        if (msg.type === "drag-start") this.startDrag();
        else if (msg.type === "drag-stop") this.isDragging = false;
      });
    }
  }

  get dragging(): boolean {
    return this.isDragging;
  }

  private startDrag(): void {
    const cursor = this.shell.getCursorPosition();
    const pos = this.window.getPosition();
    this.dragOffsetX = cursor.x - pos.x;
    this.dragOffsetY = cursor.y - pos.y;
    this.isDragging = true;
    // Stop ignoring mouse events so the drag isn't interrupted.
    if (this.window.isIgnoringMouseEvents()) this.window.setIgnoreMouseEvents(false);
  }

  /** Advance one polling tick: follow the cursor while dragging, else hit-test. */
  tick(): void {
    if (this.window.isDestroyed()) return;
    const cursor = this.shell.getCursorPosition();

    if (this.isDragging) {
      const nx = cursor.x - this.dragOffsetX;
      const ny = cursor.y - this.dragOffsetY;
      const pos = this.window.getPosition();
      if (nx !== pos.x || ny !== pos.y) this.window.setPosition(nx, ny);
      return;
    }

    const pos = this.window.getPosition();
    const size = this.window.getSize();
    const inside =
      cursor.x >= pos.x &&
      cursor.x <= pos.x + size.width &&
      cursor.y >= pos.y &&
      cursor.y <= pos.y + size.height;

    const desiredIgnore = !inside;
    if (this.window.isIgnoringMouseEvents() !== desiredIgnore) {
      this.window.setIgnoreMouseEvents(desiredIgnore);
    }
  }
}
