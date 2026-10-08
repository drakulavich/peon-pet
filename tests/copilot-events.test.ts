import { describe, expect, test } from "bun:test";
import {
  copilotSessionId,
  parseCopilotHookEvent,
  validateCopilotPetEvent,
} from "../src/app/copilot-events.ts";

const base = {
  sessionId: "copilot-session-123",
  timestamp: 1_800_000_000_000,
  cwd: "/Users/vlad/project",
};

describe("parseCopilotHookEvent", () => {
  test("maps a prompt hook to a namespaced session event without forwarding prompt text", () => {
    const event = parseCopilotHookEvent("userPromptSubmitted", {
      ...base,
      prompt: "private prompt",
    });

    expect(event).toEqual({
      kind: "session",
      sessionId: copilotSessionId("copilot-session-123"),
      event: "UserPromptSubmit",
      cwd: "/Users/vlad/project",
      timestamp: 1_800_000_000_000,
    });
    expect(JSON.stringify(event)).not.toContain("private prompt");
  });

  test("maps Copilot lifecycle hooks to existing pet event names", () => {
    const cases = [
      ["sessionStart", "SessionStart"],
      ["agentStop", "Stop"],
      ["permissionRequest", "PermissionRequest"],
      ["postToolUseFailure", "PostToolUseFailure"],
      ["preCompact", "PreCompact"],
      ["sessionEnd", "SessionEnd"],
    ] as const;

    for (const [hookName, eventName] of cases) {
      expect(parseCopilotHookEvent(hookName, base)).toMatchObject({
        kind: "session",
        event: eventName,
      });
    }
  });

  test("scopes a subagent lifecycle key to its session without forwarding its transcript path", () => {
    const transcriptPath = "/private/path/to/subagent.jsonl";
    const event = parseCopilotHookEvent("subagentStart", {
      ...base,
      agentName: "research",
      transcriptPath,
      agentDescription: "sensitive description",
    });
    const stopped = parseCopilotHookEvent("subagentStop", {
      ...base,
      agentId: "agent-id",
      transcriptPath,
      response: "private response",
    });

    expect(event).toMatchObject({
      kind: "subagent",
      sessionId: copilotSessionId("copilot-session-123"),
      event: "SubagentStart",
    });
    expect(stopped).toMatchObject({
      kind: "subagent",
      sessionId: copilotSessionId("copilot-session-123"),
      event: "SubagentStop",
      parentToolId: event?.kind === "subagent" ? event.parentToolId : "",
    });
    expect(event?.kind === "subagent" ? event.parentToolId : "").toContain(copilotSessionId("copilot-session-123"));
    expect(JSON.stringify(event)).not.toContain("copilot-session-123");
    expect(JSON.stringify(event)).not.toContain("/private/path");
    expect(JSON.stringify(event)).not.toContain("sensitive description");
    expect(JSON.stringify(stopped)).not.toContain("/private/path");
    expect(JSON.stringify(stopped)).not.toContain("private response");
  });

  test("rejects unknown hooks and malformed required metadata", () => {
    expect(parseCopilotHookEvent("unknown", base)).toBeNull();
    expect(parseCopilotHookEvent("constructor", base)).toBeNull();
    expect(parseCopilotHookEvent("sessionStart", { ...base, sessionId: "" })).toBeNull();
    expect(parseCopilotHookEvent("sessionStart", { ...base, timestamp: "now" })).toBeNull();
    expect(parseCopilotHookEvent("subagentStop", { ...base, agentId: "a1" })).toBeNull();
  });

  test("creates a stable UUID-shaped identifier in the Copilot namespace", () => {
    const first = copilotSessionId("session-1");
    expect(first).toBe(copilotSessionId("session-1"));
    expect(first).toMatch(/^c0a17e71-c0a1-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(first).not.toBe(copilotSessionId("session-2"));
  });

  test("rejects Pi lifecycle events in its independent identifier namespace", () => {
    const event = {
      kind: "pi-session",
      sessionId: "91a11a00-91a1-8abc-8abc-123456789abc",
      event: "UserPromptSubmit",
      cwd: "/Users/vlad/project",
      timestamp: 1_800_000_000_000,
    };

    expect(validateCopilotPetEvent(event)).toBeNull();
  });
});
