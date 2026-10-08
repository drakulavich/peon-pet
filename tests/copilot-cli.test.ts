import { describe, expect, test } from "bun:test";
import { dispatchCopilotHook, MAX_COPILOT_HOOK_INPUT_BYTES } from "../src/app/copilot-cli.ts";
import { copilotSessionId } from "../src/app/copilot-events.ts";

const payload = JSON.stringify({
  sessionId: "session-1",
  timestamp: 1_800_000_000_000,
  cwd: "/Users/vlad/project",
  prompt: "must remain private",
});

describe("dispatchCopilotHook", () => {
  test("sends only the normalized event to the pet", async () => {
    let forwarded: unknown;
    const result = await dispatchCopilotHook("userPromptSubmitted", payload, "/tmp/socket", async (_path, event) => {
      forwarded = event;
      return true;
    });

    expect(result).toBe("delivered");
    expect(forwarded).toEqual({
      kind: "session",
      sessionId: copilotSessionId("session-1"),
      event: "UserPromptSubmit",
      cwd: "/Users/vlad/project",
      timestamp: 1_800_000_000_000,
    });
  });

  test("ignores invalid and oversized hook payloads", async () => {
    const sender = async () => {
      throw new Error("invalid payload reached IPC");
    };
    expect(await dispatchCopilotHook("unknown", payload, "/tmp/socket", sender)).toBe("invalid");
    expect(await dispatchCopilotHook("sessionStart", "not-json", "/tmp/socket", sender)).toBe("invalid");
    expect(
      await dispatchCopilotHook(
        "sessionStart",
        " ".repeat(MAX_COPILOT_HOOK_INPUT_BYTES + 1),
        "/tmp/socket",
        sender,
      ),
    ).toBe("invalid");
  });

  test("reports an unavailable pet without failing the hook command", async () => {
    expect(
      await dispatchCopilotHook("sessionStart", payload, "/tmp/socket", async () => false),
    ).toBe("unavailable");
    expect(
      await dispatchCopilotHook("sessionStart", payload, "/tmp/socket", async () => {
        throw new Error("socket error");
      }),
    ).toBe("unavailable");
  });
});
