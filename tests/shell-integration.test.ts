import { describe, test, expect } from "bun:test";
import { FakeShell } from "../src/shell/fake.ts";
import { parseShellMessage } from "../src/shell/types.ts";
import { WindowInteraction } from "../src/app/window-interaction.ts";
import {
  SubAgentManager,
  type SubAgentManagerOptions,
  MAX_SUB_AGENT_WINDOWS,
  SUB_AGENT_SIZE,
  SUB_AGENT_STACK_OVERLAP,
  SUB_AGENT_TTL_MS,
} from "../src/app/sub-agent-manager.ts";

// ─── parseShellMessage (boundary validation) ─────────────────────────────────

describe("parseShellMessage", () => {
  test("accepts known message types", () => {
    expect(parseShellMessage({ type: "drag-start" })).toEqual({ type: "drag-start" });
    expect(parseShellMessage({ type: "drag-stop" })).toEqual({ type: "drag-stop" });
  });

  test("rejects unknown / malformed payloads", () => {
    expect(parseShellMessage({ type: "explode" })).toBeNull();
    expect(parseShellMessage({ type: 42 })).toBeNull();
    expect(parseShellMessage({})).toBeNull();
    expect(parseShellMessage(null)).toBeNull();
    expect(parseShellMessage("drag-start")).toBeNull();
  });
});

// ─── Hover hit-test toggles click-through ────────────────────────────────────

describe("WindowInteraction — hover", () => {
  function setup() {
    const shell = new FakeShell();
    const win = shell.createWindow({ width: 200, height: 200, x: 20, y: 860 });
    const interaction = new WindowInteraction(shell, win, { draggable: true });
    return { shell, win, interaction };
  }

  test("starts click-through (ignoring mouse events)", () => {
    const { win } = setup();
    expect(win.isIgnoringMouseEvents()).toBe(true);
  });

  test("cursor entering the window disables click-through", () => {
    const { shell, win, interaction } = setup();
    shell.setCursor(100, 900); // inside 20..220 × 860..1060
    interaction.tick();
    expect(win.isIgnoringMouseEvents()).toBe(false);
  });

  test("cursor leaving the window re-enables click-through", () => {
    const { shell, win, interaction } = setup();
    shell.setCursor(100, 900);
    interaction.tick(); // enter
    shell.setCursor(5, 5); // far away
    interaction.tick(); // leave
    expect(win.isIgnoringMouseEvents()).toBe(true);
  });

  test("does not redundantly toggle when state is unchanged", () => {
    const { shell, win, interaction } = setup();
    shell.setCursor(5, 5); // outside; already ignoring
    interaction.tick();
    interaction.tick();
    expect(win.calls.filter((c) => c.startsWith("setIgnoreMouseEvents"))).toHaveLength(0);
  });

  test("boundary pixel (exact edge) counts as inside", () => {
    const { shell, win, interaction } = setup();
    shell.setCursor(220, 1060); // x+width, y+height — inclusive in main.js
    interaction.tick();
    expect(win.isIgnoringMouseEvents()).toBe(false);
  });
});

// ─── Drag follows the cursor ─────────────────────────────────────────────────

describe("WindowInteraction — drag", () => {
  function setup() {
    const shell = new FakeShell();
    const win = shell.createWindow({ width: 200, height: 200, x: 20, y: 860 });
    const interaction = new WindowInteraction(shell, win, { draggable: true });
    return { shell, win, interaction };
  }

  test("drag-start disables click-through so the drag isn't interrupted", () => {
    const { shell, win } = setup();
    shell.setCursor(120, 960); // grab point: offset (100,100) from window origin (20,860)
    win.emitMessage({ type: "drag-start" });
    expect(win.isIgnoringMouseEvents()).toBe(false);
  });

  test("window tracks cursor minus grab offset while dragging", () => {
    const { shell, win, interaction } = setup();
    shell.setCursor(120, 960); // offset (100,100)
    win.emitMessage({ type: "drag-start" });
    shell.setCursor(300, 500);
    interaction.tick();
    expect(win.getPosition()).toEqual({ x: 200, y: 400 }); // 300-100, 500-100
  });

  test("drag-stop ends following; later cursor moves do not reposition", () => {
    const { shell, win, interaction } = setup();
    shell.setCursor(120, 960);
    win.emitMessage({ type: "drag-start" });
    shell.setCursor(300, 500);
    interaction.tick();
    win.emitMessage({ type: "drag-stop" });
    const posAfterStop = win.getPosition();
    shell.setCursor(800, 800);
    interaction.tick();
    expect(win.getPosition()).toEqual(posAfterStop);
  });

  test("non-draggable window ignores drag messages", () => {
    const shell = new FakeShell();
    const win = shell.createWindow({ width: 100, height: 100, x: 20, y: 860 });
    const interaction = new WindowInteraction(shell, win, { draggable: false });
    win.emitMessage({ type: "drag-start" });
    expect(interaction.dragging).toBe(false);
  });
});

// ─── Sub-agent create / destroy / restack ────────────────────────────────────

describe("SubAgentManager", () => {
  // Main pet at the default bottom-left corner of a 1920×1080 work area
  // (x = margin 20, y = 1080 − 200 − 20).
  const PET_POS = { x: 20, y: 860 };
  const slotY = (petY: number, i: number) => petY - (i + 1) * SUB_AGENT_SIZE + SUB_AGENT_STACK_OVERLAP;
  const mkMgr = (shell: FakeShell, opts: Partial<SubAgentManagerOptions> = {}) =>
    new SubAgentManager(shell, { anchor: () => PET_POS, ...opts });

  test("creates a window stacked above the main pet", () => {
    const shell = new FakeShell();
    const mgr = mkMgr(shell);
    mgr.create("s1");
    expect(mgr.count()).toBe(1);
    const win = shell.liveWindows()[0];
    expect(win.getSize()).toEqual({ width: SUB_AGENT_SIZE, height: SUB_AGENT_SIZE });
    expect(win.getPosition()).toEqual({ x: PET_POS.x, y: slotY(PET_POS.y, 0) });
  });

  test("stacks relative to the pet's current position, not a fixed corner", () => {
    const shell = new FakeShell();
    const mgr = mkMgr(shell, { anchor: () => ({ x: 700, y: 300 }) });
    mgr.create("s1");
    mgr.create("s2");
    const [w1, w2] = shell.windows;
    expect(w1.getPosition()).toEqual({ x: 700, y: slotY(300, 0) });
    expect(w2.getPosition()).toEqual({ x: 700, y: slotY(300, 1) });
  });

  test("reposition() follows the pet after it moves (drag)", () => {
    const shell = new FakeShell();
    let pet = { x: 20, y: 860 };
    const mgr = mkMgr(shell, { anchor: () => pet });
    mgr.create("s1");
    pet = { x: 1500, y: 400 };
    mgr.reposition();
    expect(shell.windows[0].getPosition()).toEqual({ x: 1500, y: slotY(400, 0) });
  });

  test("ignores duplicate session ids", () => {
    const shell = new FakeShell();
    const mgr = mkMgr(shell);
    mgr.create("s1");
    mgr.create("s1");
    expect(mgr.count()).toBe(1);
  });

  test(`caps at ${MAX_SUB_AGENT_WINDOWS} windows`, () => {
    const shell = new FakeShell();
    const mgr = mkMgr(shell);
    for (let i = 0; i < MAX_SUB_AGENT_WINDOWS + 3; i++) mgr.create(`s${i}`);
    expect(mgr.count()).toBe(MAX_SUB_AGENT_WINDOWS);
    expect(shell.liveWindows()).toHaveLength(MAX_SUB_AGENT_WINDOWS);
  });

  test("destroy removes the window and re-stacks the remainder", () => {
    const shell = new FakeShell();
    const mgr = mkMgr(shell);
    mgr.create("s1");
    mgr.create("s2");
    mgr.create("s3");
    const [w1, w2, w3] = shell.windows;
    mgr.destroy("s1"); // remove the first

    expect(w1.isDestroyed()).toBe(true);
    expect(mgr.count()).toBe(2);
    // remaining windows re-stack into slots 0 and 1 (no gap)
    expect(w2.getPosition().y).toBe(slotY(PET_POS.y, 0));
    expect(w3.getPosition().y).toBe(slotY(PET_POS.y, 1));
  });

  test("a freed slot can be reused after destroy", () => {
    const shell = new FakeShell();
    const mgr = mkMgr(shell);
    for (let i = 0; i < MAX_SUB_AGENT_WINDOWS; i++) mgr.create(`s${i}`);
    expect(mgr.count()).toBe(MAX_SUB_AGENT_WINDOWS);
    mgr.destroy("s0");
    mgr.create("s-new");
    expect(mgr.count()).toBe(MAX_SUB_AGENT_WINDOWS);
    expect(mgr.has("s-new")).toBe(true);
  });

  test("sweepExpired destroys windows past the TTL (injected clock)", () => {
    let t = 1_000_000;
    const shell = new FakeShell();
    const mgr = mkMgr(shell, { now: () => t });
    mgr.create("stale");
    t += SUB_AGENT_TTL_MS + 1;
    mgr.create("fresh");
    mgr.sweepExpired();
    expect(mgr.has("stale")).toBe(false);
    expect(mgr.has("fresh")).toBe(true);
  });

  test("onWindowCreated fires once per new window with its session id", () => {
    const shell = new FakeShell();
    const created: string[] = [];
    const mgr = mkMgr(shell, {
      onWindowCreated: (_win, sessionId) => created.push(sessionId),
    });
    mgr.create("a");
    mgr.create("b");
    mgr.create("a"); // duplicate, no callback
    expect(created).toEqual(["a", "b"]);
  });

  test("destroyAll tears down every window", () => {
    const shell = new FakeShell();
    const mgr = mkMgr(shell);
    mgr.create("s1");
    mgr.create("s2");
    mgr.destroyAll();
    expect(mgr.count()).toBe(0);
    expect(shell.liveWindows()).toHaveLength(0);
  });
});
