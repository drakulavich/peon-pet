import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  antigravityHooksPath,
  dispatchAntigravityHook,
  installAntigravityHooks,
  parseAntigravityHookEvent,
  uninstallAntigravityHooks,
} from "../src/app/antigravity.ts";
import { copilotSessionId, validateCopilotPetEvent } from "../src/app/copilot-events.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function makeHome(): string {
  const root = mkdtempSync(join(tmpdir(), "peon-antigravity-"));
  roots.push(root);
  return root;
}

describe("parseAntigravityHookEvent", () => {
  test("maps hooks to events with a namespaced, valid session id", () => {
    const event = parseAntigravityHookEvent("PreInvocation", { conversation_id: "abc", cwd: "/w" }, 5);
    expect(event).toMatchObject({ kind: "session", event: "UserPromptSubmit", cwd: "/w", timestamp: 5 });
    expect(event!.sessionId).not.toBe(copilotSessionId("abc"));
    expect(validateCopilotPetEvent(event)).not.toBeNull();
    expect(parseAntigravityHookEvent("Stop", {}, 5)).toMatchObject({ event: "Stop", cwd: null });
    expect(parseAntigravityHookEvent("SessionEnd", {}, 5)).toMatchObject({ event: "SessionEnd", cwd: null });
  });

  test("ignores unknown hooks and non-object payloads", () => {
    expect(parseAntigravityHookEvent("PreToolUse", {})).toBeNull();
    expect(parseAntigravityHookEvent("Stop", [])).toBeNull();
  });
});

describe("dispatchAntigravityHook", () => {
  test("reports delivered, invalid and unavailable", async () => {
    expect(await dispatchAntigravityHook("Stop", "{}", "s", async () => true)).toBe("delivered");
    expect(await dispatchAntigravityHook("Stop", "{}", "s", async () => false)).toBe("unavailable");
    expect(await dispatchAntigravityHook("Stop", "nope", "s", async () => true)).toBe("invalid");
  });
});

describe("hooks.json install", () => {
  test("preserves other namespaces, is idempotent, and uninstalls cleanly", () => {
    const home = makeHome();
    const path = antigravityHooksPath(home);
    mkdirSync(join(home, ".gemini", "config"), { recursive: true });
    writeFileSync(path, JSON.stringify({ other: { Stop: [] } }));

    expect(installAntigravityHooks({ home, executablePath: "/opt/it's/peon-pet" })).toBe("installed");
    const config = JSON.parse(readFileSync(path, "utf8"));
    expect(config.other).toEqual({ Stop: [] });
    expect(config["peon-pet"].Stop[0].command).toBe("'/opt/it'\\''s/peon-pet' --antigravity-hook Stop");
    expect(installAntigravityHooks({ home, executablePath: "/opt/it's/peon-pet" })).toBe("already-installed");

    expect(uninstallAntigravityHooks({ home })).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ other: { Stop: [] } });
    expect(uninstallAntigravityHooks({ home })).toBe(false);
  });

  test("creates the file when absent and refuses unparseable files", () => {
    const home = makeHome();
    expect(installAntigravityHooks({ home, executablePath: "/x/peon-pet" })).toBe("installed");
    writeFileSync(antigravityHooksPath(home), "{bad");
    expect(() => installAntigravityHooks({ home, executablePath: "/x/peon-pet" })).toThrow();
  });
});


import {
  findAntigravityTranscript,
  isAntigravityTranscriptActive,
} from "../src/app/antigravity.ts";

describe("findAntigravityTranscript", () => {
  test("finds transcript in brain directory when it exists", () => {
    const home = makeHome();
    const convId = "test-conv-123";
    const dir = join(home, ".gemini", "antigravity-ide", "brain", convId, ".system_generated", "logs");
    mkdirSync(dir, { recursive: true });
    const logFile = join(dir, "transcript.jsonl");
    writeFileSync(logFile, "{}");

    expect(findAntigravityTranscript(convId, undefined, home)).toBe(logFile);
    expect(findAntigravityTranscript("non-existent", undefined, home)).toBeNull();
  });

  test("uses custom transcript path if given and exists", () => {
    const home = makeHome();
    const custom = join(home, "my-transcript.jsonl");
    writeFileSync(custom, "{}");
    expect(findAntigravityTranscript(undefined, custom, home)).toBe(custom);
  });
});

describe("isAntigravityTranscriptActive", () => {
  test("returns true for USER_INPUT and active tool_calls", () => {
    const home = makeHome();
    const file = join(home, "active.jsonl");

    writeFileSync(file, JSON.stringify({ type: "USER_INPUT", content: "hello" }) + "\n");
    expect(isAntigravityTranscriptActive(file)).toBe(true);

    writeFileSync(file, JSON.stringify({
      type: "PLANNER_RESPONSE",
      tool_calls: [{ name: "run_command" }]
    }) + "\n");
    expect(isAntigravityTranscriptActive(file)).toBe(true);
  });

  test("returns false when last record is turn end or error", () => {
    const home = makeHome();
    const file = join(home, "inactive.jsonl");

    // Turn complete: PLANNER_RESPONSE with no tool_calls
    writeFileSync(file, JSON.stringify({
      type: "PLANNER_RESPONSE",
      content: "All done!"
    }) + "\n");
    expect(isAntigravityTranscriptActive(file)).toBe(false);

    // Turn failed / EOF error
    writeFileSync(file, JSON.stringify({
      type: "ERROR_MESSAGE",
      content: "streamGenerateContent EOF"
    }) + "\n");
    expect(isAntigravityTranscriptActive(file)).toBe(false);
  });

  test("handles empty or missing files gracefully", () => {
    expect(isAntigravityTranscriptActive("/non/existent/path")).toBe(false);
  });
});
