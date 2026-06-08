// Manages up to MAX_SUB_AGENT_WINDOWS mini-pet windows stacked above the main
// pet, one per active sub-agent. Shell-agnostic port of main.js's
// createSubAgentWindow / destroySubAgentWindow / repositionSubAgentWindows + TTL.

import type { NativeShell, WindowHandle } from "../shell/types.ts";

export const MAX_SUB_AGENT_WINDOWS = 5;
export const SUB_AGENT_SIZE = 100;
export const SUB_AGENT_X = 20;
/** px from the bottom of the work area to the main pet. */
export const SUB_AGENT_BASE_Y_OFFSET = 170;
/** Destroy a window whose SubagentStop never fired after this long. */
export const SUB_AGENT_TTL_MS = 10 * 60 * 1000;

export interface SubAgentManagerOptions {
  /** Injectable clock so TTL is testable without fake timers. */
  now?: () => number;
  /** Called once when a window is created (e.g. to wire interaction + load it). */
  onWindowCreated?: (win: WindowHandle, sessionId: string) => void;
}

export class SubAgentManager {
  private readonly windows = new Map<string, WindowHandle>();
  private readonly createdAt = new Map<string, number>();
  private readonly now: () => number;
  private readonly onWindowCreated?: (win: WindowHandle, sessionId: string) => void;

  constructor(
    private readonly shell: NativeShell,
    opts: SubAgentManagerOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.onWindowCreated = opts.onWindowCreated;
  }

  count(): number {
    return this.windows.size;
  }
  has(sessionId: string): boolean {
    return this.windows.has(sessionId);
  }

  private stackY(workHeight: number, index: number): number {
    return workHeight - SUB_AGENT_BASE_Y_OFFSET - (index + 1) * SUB_AGENT_SIZE;
  }

  create(sessionId: string): void {
    if (this.windows.size >= MAX_SUB_AGENT_WINDOWS) return;
    if (this.windows.has(sessionId)) return;

    const { height } = this.shell.getPrimaryWorkArea();
    const idx = this.windows.size;
    const win = this.shell.createWindow({
      width: SUB_AGENT_SIZE,
      height: SUB_AGENT_SIZE,
      x: SUB_AGENT_X,
      y: this.stackY(height, idx),
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

  /** Re-stack remaining windows so there are no gaps after a removal. */
  reposition(): void {
    const { height } = this.shell.getPrimaryWorkArea();
    let i = 0;
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        win.setPosition(SUB_AGENT_X, this.stackY(height, i));
        i++;
      }
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
