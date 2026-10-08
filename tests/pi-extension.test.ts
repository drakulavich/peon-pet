import { describe, expect, test } from "bun:test";
import { piSessionId as appPiSessionId } from "../src/app/pi-events.ts";

async function loadPiExtension() {
  try {
    return await import("../src/pi-extension.ts");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
      return null;
    }
    throw error;
  }
}

describe("Pi Agent extension", () => {
  test("maps supported Pi callbacks to privacy-minimized pet events", async () => {
    const extension = await loadPiExtension();
    expect(extension).not.toBeNull();
    if (!extension) return;

    const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
    const received: unknown[] = [];
    extension.registerPiLifecycleHandlers(
      { on: (name: string, handler: (event: unknown, context: unknown) => unknown) => handlers.set(name, handler) },
      async (event: unknown) => { received.push(event); },
      () => 1_800_000_000_000,
    );
    const context = {
      cwd: "/Users/vlad/project",
      sessionManager: { getSessionId: () => "pi-session-1" },
    };

    for (const [hook, event] of [
      ["session_start", "SessionStart"],
      ["turn_start", "UserPromptSubmit"],
      ["agent_settled", "Stop"],
      ["session_shutdown", "SessionEnd"],
    ]) {
      await handlers.get(hook)?.({ prompt: "secret" }, context);
      expect(received.at(-1)).toMatchObject({ kind: "pi-session", event });
      expect((received.at(-1) as { sessionId: string }).sessionId).toBe(appPiSessionId("pi-session-1"));
      expect(JSON.stringify(received.at(-1))).not.toContain("secret");
    }
    expect(handlers.size).toBe(4);
  });

  test("does not let failed delivery or missing session metadata affect Pi handlers", async () => {
    const extension = await loadPiExtension();
    expect(extension).not.toBeNull();
    if (!extension) return;

    const handlers = new Map<string, (event: unknown, context: unknown) => unknown>();
    let attempts = 0;
    extension.registerPiLifecycleHandlers(
      { on: (name: string, handler: (event: unknown, context: unknown) => unknown) => handlers.set(name, handler) },
      async () => {
        attempts++;
        throw new Error("pet unavailable");
      },
    );

    await expect(handlers.get("turn_start")?.({}, {
      cwd: "/project",
      sessionManager: { getSessionId: () => "pi-session" },
    })).resolves.toBeUndefined();
    await handlers.get("turn_start")?.({}, { cwd: "/project", sessionManager: {} });
    expect(attempts).toBe(1);
  });
});
