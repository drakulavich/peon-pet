import { describe, expect, test } from "bun:test";
import { createSessionTracker } from "../src/app/session-tracker.ts";

async function loadPiSession() {
  try {
    return await import("../src/app/pi-session.ts");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

describe("Pi Agent session lifecycle", () => {
  test("updates one Pi session and removes only that session on shutdown", async () => {
    const piSession = await loadPiSession();
    expect(piSession).not.toBeNull();
    if (!piSession) return;

    const tracker = createSessionTracker();
    const cwds = new Map<string, string>();
    const id = "91a11a00-91a1-8abc-8abc-123456789abc";
    const otherId = "91a11a00-91a1-8abc-8abc-123456789abd";
    tracker.update(otherId, 10);
    cwds.set(otherId, "/other");

    piSession.applyPiSessionEvent({
      kind: "pi-session",
      sessionId: id,
      event: "UserPromptSubmit",
      cwd: "/project",
      timestamp: 20,
    }, tracker, cwds);
    expect(tracker.entries()).toEqual([[otherId, 10], [id, 20]]);
    expect(cwds.get(id)).toBe("/project");

    expect(piSession.applyPiSessionEvent({
      kind: "pi-session",
      sessionId: id,
      event: "SessionEnd",
      cwd: "/project",
      timestamp: 30,
    }, tracker, cwds)).toBe("ended");
    expect(tracker.entries()).toEqual([[otherId, 10]]);
    expect(cwds.get(otherId)).toBe("/other");
    expect(cwds.has(id)).toBe(false);
  });

  test("late events cannot revive a shut down Pi session unless it starts again", async () => {
    const piSession = await loadPiSession();
    expect(piSession).not.toBeNull();
    if (!piSession) return;

    const ended = new Map<string, number>();
    const id = "91a11a00-91a1-8abc-8abc-123456789abc";
    const shutdown = { kind: "pi-session", sessionId: id, event: "SessionEnd", cwd: null, timestamp: 10 };
    const lateTurn = { ...shutdown, event: "UserPromptSubmit", timestamp: 11 };
    const restarted = { ...shutdown, event: "SessionStart", timestamp: 12 };
    expect(piSession.shouldApplyPiEvent(shutdown, ended, 100)).toBe(true);
    expect(piSession.shouldApplyPiEvent(lateTurn, ended, 101)).toBe(false);
    expect(piSession.shouldApplyPiEvent(restarted, ended, 102)).toBe(true);
  });
});
