import { describe, expect, test } from "bun:test";
import { createSessionTracker } from "../src/app/session-tracker.ts";
import { applyCopilotSessionEvent, shouldApplyCopilotEvent } from "../src/app/copilot-session.ts";
import { copilotSessionId, parseCopilotHookEvent } from "../src/app/copilot-events.ts";

describe("applyCopilotSessionEvent", () => {
  test("tracks Copilot activity separately from Claude sessions", () => {
    const tracker = createSessionTracker();
    const cwds = new Map<string, string>();
    tracker.update("550e8400-e29b-41d4-a716-446655440000", 10);

    applyCopilotSessionEvent(
      {
        kind: "session",
        sessionId: copilotSessionId("session-1"),
        event: "UserPromptSubmit",
        cwd: "/Users/vlad/project",
        timestamp: 20,
      },
      tracker,
      cwds,
    );

    expect(tracker.entries()).toEqual([
      ["550e8400-e29b-41d4-a716-446655440000", 10],
      [copilotSessionId("session-1"), 20],
    ]);
    expect(cwds.get(copilotSessionId("session-1"))).toBe("/Users/vlad/project");
  });

  test("session end removes only that Copilot session and its cwd", () => {
    const tracker = createSessionTracker();
    const cwds = new Map<string, string>([
      [copilotSessionId("session-1"), "/one"],
      [copilotSessionId("session-2"), "/two"],
    ]);
    tracker.update(copilotSessionId("session-1"), 10);
    tracker.update(copilotSessionId("session-2"), 20);

    const result = applyCopilotSessionEvent(
      {
        kind: "session",
        sessionId: copilotSessionId("session-1"),
        event: "SessionEnd",
        cwd: "/one",
        timestamp: 30,
      },
      tracker,
      cwds,
    );

    expect(result).toBe("ended");
    expect(tracker.entries()).toEqual([[copilotSessionId("session-2"), 20]]);
    expect(cwds.has(copilotSessionId("session-1"))).toBe(false);
    expect(cwds.get(copilotSessionId("session-2"))).toBe("/two");
  });

  test("late events cannot revive an ended session unless Copilot starts it again", () => {
    const endedSessions = new Map<string, number>();
    const ended = parseCopilotHookEvent("sessionEnd", {
      sessionId: "session-1",
      timestamp: 30,
    });
    const lateSubagentStop = parseCopilotHookEvent("subagentStop", {
      sessionId: "session-1",
      timestamp: 31,
      transcriptPath: "/tmp/agent.jsonl",
    });
    const restarted = parseCopilotHookEvent("sessionStart", {
      sessionId: "session-1",
      timestamp: 32,
    });

    expect(shouldApplyCopilotEvent(ended!, endedSessions, 100)).toBe(true);
    expect(shouldApplyCopilotEvent(lateSubagentStop!, endedSessions, 101)).toBe(false);
    expect(shouldApplyCopilotEvent(restarted!, endedSessions, 102)).toBe(true);
    expect(endedSessions.has(copilotSessionId("session-1"))).toBe(false);
  });
});
