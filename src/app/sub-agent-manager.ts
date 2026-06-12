// Manages up to MAX_SUB_AGENT_WINDOWS mini-pet windows stacked above the main
// pet, one per active sub-agent. Shell-agnostic port of main.js's
// createSubAgentWindow / destroySubAgentWindow / repositionSubAgentWindows + TTL.

import type { NativeShell, Point, WindowHandle } from "../shell/types.ts";

export const MAX_SUB_AGENT_WINDOWS = 5;
export const SUB_AGENT_SIZE = 100;
/** The first mini-pet overlaps the main pet's top edge by this many px, so it
 *  peeks over the pet's head (the windows are mostly transparent). */
export const SUB_AGENT_STACK_OVERLAP = SUB_AGENT_SIZE / 2;
/** Destroy a window whose SubagentStop never fired after this long. */
export const SUB_AGENT_TTL_MS = 10 * 60 * 1000;

export interface SubAgentManagerOptions {
  /** Top-left of the main pet window; the mini-pet stack hangs above it. */
  anchor: () => Point;
  /** Injectable clock so TTL is testable without fake timers. */
  now?: () => number;
  /** Called once when a window is created (e.g. to wire interaction + load it). */
  onWindowCreated?: (win: WindowHandle, sessionId: string) => void;
}

export class SubAgentManager {
  private readonly windows = new Map<string, WindowHandle>();
  private readonly createdAt = new Map<string, number>();
  private readonly anchor: () => Point;
  private readonly now: () => number;
  private readonly onWindowCreated?: (win: WindowHandle, sessionId: string) => void;

  constructor(
    private readonly shell: NativeShell,
    opts: SubAgentManagerOptions,
  ) {
    this.anchor = opts.anchor;
    this.now = opts.now ?? Date.now;
    this.onWindowCreated = opts.onWindowCreated;
  }

  count(): number {
    return this.windows.size;
  }
  has(sessionId: string): boolean {
    return this.windows.has(sessionId);
  }
  /** All live (non-destroyed) sub-agent windows. */
  liveWindows(): WindowHandle[] {
    return [...this.windows.values()].filter((w) => !w.isDestroyed());
  }

  /** Top-left of stack slot `index`, hanging above the main pet's current position. */
  private slotPosition(index: number): Point {
    const pet = this.anchor();
    return { x: pet.x, y: pet.y - (index + 1) * SUB_AGENT_SIZE + SUB_AGENT_STACK_OVERLAP };
  }

  create(sessionId: string): void {
    if (this.windows.size >= MAX_SUB_AGENT_WINDOWS) return;
    if (this.windows.has(sessionId)) return;

    const { x, y } = this.slotPosition(this.windows.size);
    const win = this.shell.createWindow({
      width: SUB_AGENT_SIZE,
      height: SUB_AGENT_SIZE,
      x,
      y,
      ignoreMouseEvents: true,
    });

    this.windows.set(sessionId, win);
    this.createdAt.set(sessionId, this.now());
    this.onWindowCreated?.(win, sessionId);
  }

  destroy(sessionId: string): void {
    const win = this.windows.get(sessionId);
    if (win && !win.isDestroyed()) win.destroy();
    this.windows.delete(sessionId);
    this.createdAt.delete(sessionId);
    this.reposition();
  }

  /** Re-stack above the pet's current position (after a removal or a pet move). */
  reposition(): void {
    let i = 0;
    for (const win of this.windows.values()) {
      if (win.isDestroyed()) continue;
      const target = this.slotPosition(i++);
      const pos = win.getPosition();
      if (pos.x !== target.x || pos.y !== target.y) win.setPosition(target.x, target.y);
    }
  }

  /** Destroy windows whose SubagentStop never fired within the TTL. */
  sweepExpired(): void {
    const now = this.now();
    const expired: string[] = [];
    for (const [sessionId, createdAt] of this.createdAt) {
      if (now - createdAt > SUB_AGENT_TTL_MS) expired.push(sessionId);
    }
    for (const sessionId of expired) this.destroy(sessionId);
  }

  destroyAll(): void {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.windows.clear();
    this.createdAt.clear();
  }
}
