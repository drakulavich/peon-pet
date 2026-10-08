import { describe, expect, test } from "bun:test";
import { copilotSessionId } from "../src/app/copilot-events.ts";

async function loadPiEvents() {
  try {
    return await import("../src/app/pi-events.ts");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

describe("Pi Agent events", () => {
  test("uses a stable, distinct Pi session identifier namespace", async () => {
    const piEvents = await loadPiEvents();
    expect(piEvents).not.toBeNull();
    if (!piEvents) return;

    const first = piEvents.piSessionId("pi-session-1");
    expect(first).toBe(piEvents.piSessionId("pi-session-1"));
    expect(first).toMatch(/^91a11a00-91a1-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(first).not.toBe(piEvents.piSessionId("pi-session-2"));
    expect(first).not.toBe(copilotSessionId("pi-session-1"));
  });

  test("validates and normalizes only supported Pi lifecycle fields", async () => {
    const piEvents = await loadPiEvents();
    expect(piEvents).not.toBeNull();
    if (!piEvents) return;

    const event = {
      kind: "pi-session",
      sessionId: piEvents.piSessionId("pi-session-1"),
      event: "UserPromptSubmit",
      cwd: "/Users/vlad/project",
      timestamp: 1_800_000_000_000,
      prompt: "must not be forwarded",
    };

    expect(piEvents.validatePiPetEvent(event)).toEqual({
      kind: "pi-session",
      sessionId: event.sessionId,
      event: "UserPromptSubmit",
      cwd: "/Users/vlad/project",
      timestamp: 1_800_000_000_000,
    });
  });

  test("rejects invalid Pi ids, event names, timestamps, and working directories", async () => {
    const piEvents = await loadPiEvents();
    expect(piEvents).not.toBeNull();
    if (!piEvents) return;

    const event = {
      kind: "pi-session",
      sessionId: piEvents.piSessionId("pi-session-1"),
      event: "SessionStart",
      cwd: null,
      timestamp: 1_800_000_000_000,
    };

    expect(piEvents.validatePiPetEvent({ ...event, sessionId: copilotSessionId("wrong-source") })).toBeNull();
    expect(piEvents.validatePiPetEvent({ ...event, event: "PermissionRequest" })).toBeNull();
    expect(piEvents.validatePiPetEvent({ ...event, timestamp: -1 })).toBeNull();
    expect(piEvents.validatePiPetEvent({ ...event, cwd: "x".repeat(4097) })).toBeNull();
  });
});
