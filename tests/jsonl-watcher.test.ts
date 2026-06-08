import { describe, test, expect, afterEach, spyOn, setSystemTime, jest } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { JsonlWatcher } from "../src/app/jsonl-watcher.ts";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const PROJECT_DIR = path.join(PROJECTS_DIR, "proj");
const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const NOW = 1_700_000_000_000;
const STALE_MTIME = NOW - 11 * 60_000; // > 10 min old
const FRESH_MTIME = NOW - 5_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fakeDir(name: string): any {
  return { name, isDirectory: () => true, isFile: () => false };
}
function fakeFile(name: string): any {
  return { name, isDirectory: () => false, isFile: () => true };
}

/**
 * Wire up fs spies for a single-session project layout.
 *
 * PROJECTS_DIR/proj/<SESSION_ID>.jsonl           ← main session file
 * PROJECTS_DIR/proj/<SESSION_ID>/subagents/...   ← optional bg subagent files
 */
function setupFs({
  mtime = FRESH_MTIME,
  lines = [],
  subagentFiles = null,
}: { mtime?: number; lines?: any[]; subagentFiles?: string[] | null } = {}): void {
  const buf = Buffer.from(
    lines.length ? lines.map((l) => JSON.stringify(l)).join("\n") + "\n" : "",
    "utf8",
  );
  let consumed = false;

  spyOn(fs, "existsSync").mockImplementation(((p: any) => p === PROJECTS_DIR) as any);
  spyOn(fs, "readdirSync").mockImplementation(((dir: any) => {
    if (dir === PROJECTS_DIR) return [fakeDir("proj")];
    if (dir === PROJECT_DIR) {
      const list: any[] = [fakeFile(`${SESSION_ID}.jsonl`)];
      if (subagentFiles) list.push(fakeDir(SESSION_ID));
      return list;
    }
    if (subagentFiles && dir === path.join(PROJECT_DIR, SESSION_ID, "subagents")) {
      return subagentFiles;
    }
    return [];
  }) as any);
  spyOn(fs, "statSync").mockReturnValue({ mtimeMs: mtime } as any);
  spyOn(fs, "watch").mockReturnValue({ close: jest.fn() } as any);
  spyOn(fs, "openSync").mockReturnValue(3 as any);
  spyOn(fs, "fstatSync").mockImplementation((() => ({
    size: consumed || !buf.length ? 0 : buf.length,
  })) as any);
  spyOn(fs, "readSync").mockImplementation(((_fd: any, dst: any, dstOff: any, len: any, srcOff: any) => {
    consumed = true;
    buf.copy(dst, dstOff, srcOff, srcOff + len);
    return len;
  }) as any);
  spyOn(fs, "closeSync").mockReturnValue(undefined as any);
}

function collect(watcher: JsonlWatcher, eventName: string): any[] {
  const events: any[] = [];
  watcher.on(eventName, (e) => events.push(e));
  return events;
}

// ─── .claude/projects does not exist ─────────────────────────────────────────

describe("when .claude/projects does not exist", () => {
  afterEach(() => jest.restoreAllMocks());

  test("start() does not throw", () => {
    spyOn(fs, "existsSync").mockReturnValue(false as any);
    const w = new JsonlWatcher();
    expect(() => {
      w.start();
      w.stop();
    }).not.toThrow();
  });

  test("no events are emitted", () => {
    spyOn(fs, "existsSync").mockReturnValue(false as any);
    const w = new JsonlWatcher();
    const sessionEvents = collect(w, "session-event");
    const subagentEvents = collect(w, "subagent-event");
    w.start();
    w.stop();
    expect(sessionEvents).toHaveLength(0);
    expect(subagentEvents).toHaveLength(0);
  });
});

// ─── Startup scan ─────────────────────────────────────────────────────────────

describe("startup scan — SessionSeen", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setSystemTime();
  });

  test("fresh file emits SessionSeen with the correct sessionId", () => {
    setSystemTime(NOW);
    setupFs({ mtime: FRESH_MTIME });
    const w = new JsonlWatcher();
    const events = collect(w, "session-event");
    w.start();
    w.stop();
    const ev = events.find((e) => e.event === "SessionSeen");
    expect(ev).toBeDefined();
    expect(ev.sessionId).toBe(SESSION_ID);
  });

  test("SessionSeen carries the file mtime as timestamp", () => {
    setSystemTime(NOW);
    setupFs({ mtime: FRESH_MTIME });
    const w = new JsonlWatcher();
    const events = collect(w, "session-event");
    w.start();
    w.stop();
    expect(events.find((e) => e.event === "SessionSeen").timestamp).toBe(FRESH_MTIME);
  });

  test("file older than 10 min is pruned and emits nothing", () => {
    setSystemTime(NOW);
    setupFs({ mtime: STALE_MTIME });
    const w = new JsonlWatcher();
    const events = collect(w, "session-event");
    w.start();
    w.stop();
    expect(events).toHaveLength(0);
  });

  test("file exactly at the 10-min boundary is NOT pruned", () => {
    setSystemTime(NOW);
    // > SESSION_PRUNE_MS, not >=, so exactly 10 min is still kept
    setupFs({ mtime: NOW - 10 * 60_000 });
    const w = new JsonlWatcher();
    const events = collect(w, "session-event");
    w.start();
    w.stop();
    expect(events.some((e) => e.event === "SessionSeen")).toBe(true);
  });
});

// ─── Live scan ────────────────────────────────────────────────────────────────

describe("live scan — SessionStart", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test("new file appearing after startup emits SessionStart", () => {
    jest.useFakeTimers();
    setSystemTime(NOW);
    setupFs({ mtime: FRESH_MTIME });

    const w = new JsonlWatcher();
    w.start(); // startup scan registers SESSION_ID

    const events = collect(w, "session-event");

    const ID2 = "cccccccc-0000-0000-0000-000000000002";
    // Make a second session visible on the next scan
    spyOn(fs, "readdirSync").mockImplementation(((dir: any) => {
      if (dir === PROJECTS_DIR) return [fakeDir("proj")];
      if (dir === PROJECT_DIR) return [fakeFile(`${SESSION_ID}.jsonl`), fakeFile(`${ID2}.jsonl`)];
      return [];
    }) as any);

    jest.advanceTimersByTime(1_000);
    w.stop();

    expect(events.some((e) => e.event === "SessionStart" && e.sessionId === ID2)).toBe(true);
  });

  test("already-known file does not emit SessionStart again on re-scan", () => {
    jest.useFakeTimers();
    setSystemTime(NOW);
    setupFs({ mtime: FRESH_MTIME });

    const w = new JsonlWatcher();
    w.start();

    const events = collect(w, "session-event");
    jest.advanceTimersByTime(1_000); // same files visible
    w.stop();

    expect(events.some((e) => e.event === "SessionStart")).toBe(false);
  });
});

// ─── UserPromptSubmit ─────────────────────────────────────────────────────────

describe("line parsing — UserPromptSubmit", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setSystemTime();
  });

  test("assistant record with tool_use content emits UserPromptSubmit", () => {
    setSystemTime(NOW);
    setupFs({
      lines: [
        {
          type: "assistant",
          message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
        },
      ],
    });
    const w = new JsonlWatcher();
    const events = collect(w, "session-event");
    w.start();
    w.stop();
    expect(events.some((e) => e.event === "UserPromptSubmit")).toBe(true);
  });

  test("assistant record with non-empty text content emits UserPromptSubmit", () => {
    setSystemTime(NOW);
    setupFs({
      lines: [
        { type: "assistant", message: { content: [{ type: "text", text: "Here is my plan." }] } },
      ],
    });
    const w = new JsonlWatcher();
    const events = collect(w, "session-event");
    w.start();
    w.stop();
    expect(events.some((e) => e.event === "UserPromptSubmit")).toBe(true);
  });

  test("assistant record with whitespace-only text does NOT emit UserPromptSubmit", () => {
    setSystemTime(NOW);
    setupFs({
      lines: [{ type: "assistant", message: { content: [{ type: "text", text: "   \n  " }] } }],
    });
    const w = new JsonlWatcher();
    const events = collect(w, "session-event");
    w.start();
    w.stop();
    expect(events.some((e) => e.event === "UserPromptSubmit")).toBe(false);
  });

  test("malformed JSON line is silently skipped", () => {
    setSystemTime(NOW);
    const buf = Buffer.from("not-valid-json\n", "utf8");
    spyOn(fs, "existsSync").mockImplementation(((p: any) => p === PROJECTS_DIR) as any);
    spyOn(fs, "readdirSync").mockImplementation(((dir: any) => {
      if (dir === PROJECTS_DIR) return [fakeDir("proj")];
      if (dir === PROJECT_DIR) return [fakeFile(`${SESSION_ID}.jsonl`)];
      return [];
    }) as any);
    spyOn(fs, "statSync").mockReturnValue({ mtimeMs: FRESH_MTIME } as any);
    spyOn(fs, "watch").mockReturnValue({ close: jest.fn() } as any);
    let consumed = false;
    spyOn(fs, "openSync").mockReturnValue(3 as any);
    spyOn(fs, "fstatSync").mockImplementation((() => ({ size: consumed ? 0 : buf.length })) as any);
    spyOn(fs, "readSync").mockImplementation(((_fd: any, dst: any, dstOff: any, len: any, srcOff: any) => {
      consumed = true;
      buf.copy(dst, dstOff, srcOff, srcOff + len);
      return len;
    }) as any);
    spyOn(fs, "closeSync").mockReturnValue(undefined as any);

    const w = new JsonlWatcher();
    expect(() => {
      w.start();
      w.stop();
    }).not.toThrow();
  });
});

// ─── Stop ─────────────────────────────────────────────────────────────────────

describe("line parsing — Stop", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setSystemTime();
  });

  test("system turn_duration record emits Stop", () => {
    setSystemTime(NOW);
    setupFs({ lines: [{ type: "system", subtype: "turn_duration" }] });
    const w = new JsonlWatcher();
    const events = collect(w, "session-event");
    w.start();
    w.stop();
    expect(events.some((e) => e.event === "Stop" && e.sessionId === SESSION_ID)).toBe(true);
  });

  test("Stop clears active foreground subagents", () => {
    setSystemTime(NOW);
    setupFs({
      lines: [
        { type: "progress", parentToolUseID: "ptool-1", data: { type: "agent_progress" } },
        { type: "system", subtype: "turn_duration" },
      ],
    });
    const w = new JsonlWatcher();
    const subEvents = collect(w, "subagent-event");
    w.start();
    w.stop();
    expect(subEvents.some((e) => e.event === "SubagentStop" && e.parentToolId === "ptool-1")).toBe(true);
  });
});

// ─── PermissionRequest ────────────────────────────────────────────────────────

describe("line parsing — PermissionRequest", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test("non-exempt tool pending for 7 s triggers PermissionRequest", () => {
    jest.useFakeTimers();
    setSystemTime(NOW);
    setupFs({
      lines: [
        {
          type: "assistant",
          message: { content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: {} }] },
        },
      ],
    });
    const w = new JsonlWatcher();
    const events = collect(w, "session-event");
    w.start();

    expect(events.some((e) => e.event === "PermissionRequest")).toBe(false);
    jest.advanceTimersByTime(7_000);
    expect(events.some((e) => e.event === "PermissionRequest")).toBe(true);
    w.stop();
  });

  test("exempt tools (Task / Agent / AskUserQuestion) never trigger PermissionRequest", () => {
    jest.useFakeTimers();
    setSystemTime(NOW);
    setupFs({
      lines: [
        {
          type: "assistant",
          message: {
            content: [
              { type: "tool_use", id: "task-1", name: "Task", input: {} },
              { type: "tool_use", id: "agent-1", name: "Agent", input: {} },
              { type: "tool_use", id: "ask-1", name: "AskUserQuestion", input: {} },
            ],
          },
        },
      ],
    });
    const w = new JsonlWatcher();
    const events = collect(w, "session-event");
    w.start();
    jest.advanceTimersByTime(10_000);
    w.stop();
    expect(events.some((e) => e.event === "PermissionRequest")).toBe(false);
  });

  test("tool_result response cancels the pending permission timer", () => {
    jest.useFakeTimers();
    setSystemTime(NOW);

    const assistantRecord = {
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "bash-2", name: "Bash", input: {} }] },
    };
    const userRecord = {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "bash-2", content: "ok" }] },
    };

    const allContent = Buffer.from(
      [assistantRecord, userRecord].map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf8",
    );
    let consumed = false;
    spyOn(fs, "existsSync").mockImplementation(((p: any) => p === PROJECTS_DIR) as any);
    spyOn(fs, "readdirSync").mockImplementation(((dir: any) => {
      if (dir === PROJECTS_DIR) return [fakeDir("proj")];
      if (dir === PROJECT_DIR) return [fakeFile(`${SESSION_ID}.jsonl`)];
      return [];
    }) as any);
    spyOn(fs, "statSync").mockReturnValue({ mtimeMs: FRESH_MTIME } as any);
    spyOn(fs, "watch").mockReturnValue({ close: jest.fn() } as any);
    spyOn(fs, "openSync").mockReturnValue(3 as any);
    spyOn(fs, "fstatSync").mockImplementation((() => ({ size: consumed ? 0 : allContent.length })) as any);
    spyOn(fs, "readSync").mockImplementation(((_fd: any, dst: any, dstOff: any, len: any, srcOff: any) => {
      consumed = true;
      allContent.copy(dst, dstOff, srcOff, srcOff + len);
      return len;
    }) as any);
    spyOn(fs, "closeSync").mockReturnValue(undefined as any);

    const w = new JsonlWatcher();
    const events = collect(w, "session-event");
    w.start();
    jest.advanceTimersByTime(10_000); // past the 7 s window
    w.stop();

    expect(events.some((e) => e.event === "PermissionRequest")).toBe(false);
  });
});

// ─── Foreground subagent detection ───────────────────────────────────────────

describe("subagent detection — foreground (agent_progress)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    setSystemTime();
  });

  test("progress record with agent_progress emits SubagentStart", () => {
    setSystemTime(NOW);
    setupFs({
      lines: [
        {
          type: "progress",
          parentToolUseID: "ptool-fg-1",
          toolUseID: "tuse-1",
          data: { type: "agent_progress" },
        },
      ],
    });
    const w = new JsonlWatcher();
    const events = collect(w, "subagent-event");
    w.start();
    w.stop();
    const ev = events.find((e) => e.event === "SubagentStart");
    expect(ev).toBeDefined();
    expect(ev.sessionId).toBe(SESSION_ID);
    expect(ev.parentToolId).toBe("ptool-fg-1");
  });

  test("falls back to toolUseID when parentToolUseID is absent", () => {
    setSystemTime(NOW);
    setupFs({
      lines: [{ type: "progress", toolUseID: "tuse-fallback", data: { type: "agent_progress" } }],
    });
    const w = new JsonlWatcher();
    const events = collect(w, "subagent-event");
    w.start();
    w.stop();
    expect(events.find((e) => e.event === "SubagentStart").parentToolId).toBe("tuse-fallback");
  });

  test("same parentToolUseID seen twice emits SubagentStart only once", () => {
    setSystemTime(NOW);
    const rec = { type: "progress", parentToolUseID: "ptool-dup", data: { type: "agent_progress" } };
    setupFs({ lines: [rec, rec] });
    const w = new JsonlWatcher();
    const events = collect(w, "subagent-event");
    w.start();
    w.stop();
    expect(events.filter((e) => e.event === "SubagentStart")).toHaveLength(1);
  });

  test("SubagentStop is emitted for each active subagent on turn_duration", () => {
    setSystemTime(NOW);
    setupFs({
      lines: [
        { type: "progress", parentToolUseID: "ptool-a", data: { type: "agent_progress" } },
        { type: "progress", parentToolUseID: "ptool-b", data: { type: "agent_progress" } },
        { type: "system", subtype: "turn_duration" },
      ],
    });
    const w = new JsonlWatcher();
    const events = collect(w, "subagent-event");
    w.start();
    w.stop();
    const stops = events.filter((e) => e.event === "SubagentStop").map((e) => e.parentToolId);
    expect(stops).toContain("ptool-a");
    expect(stops).toContain("ptool-b");
  });
});

// ─── Background subagent detection ───────────────────────────────────────────

describe("subagent detection — background (subagents/ dir)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test("agent-xxx.jsonl file emits SubagentStart with bg_ prefix", () => {
    jest.useFakeTimers();
    setSystemTime(NOW);
    setupFs({ subagentFiles: ["agent-abc123.jsonl"] });
    const w = new JsonlWatcher();
    const events = collect(w, "subagent-event");
    w.start();
    w.stop();
    const ev = events.find((e) => e.event === "SubagentStart");
    expect(ev).toBeDefined();
    expect(ev.sessionId).toBe(SESSION_ID);
    expect(ev.parentToolId).toBe("bg_abc123");
  });

  test("subagent emits SubagentStop after 5 s of inactivity", () => {
    jest.useFakeTimers();
    setSystemTime(NOW);
    setupFs({ subagentFiles: ["agent-idle.jsonl"] });
    const w = new JsonlWatcher();
    const events = collect(w, "subagent-event");
    w.start();

    expect(events.some((e) => e.event === "SubagentStop")).toBe(false);
    jest.advanceTimersByTime(5_000);
    expect(events.some((e) => e.event === "SubagentStop")).toBe(true);
  });

  test("non-matching files in subagents/ are ignored", () => {
    jest.useFakeTimers();
    setSystemTime(NOW);
    setupFs({ subagentFiles: ["README.txt", "agent-valid.jsonl", "not-an-agent.jsonl"] });
    const w = new JsonlWatcher();
    const events = collect(w, "subagent-event");
    w.start();
    w.stop();
    const starts = events.filter((e) => e.event === "SubagentStart");
    expect(starts).toHaveLength(1);
    expect(starts[0].parentToolId).toBe("bg_valid");
  });

  test("stale background subagent file (>10 min) is pruned on startup", () => {
    jest.useFakeTimers();
    setSystemTime(NOW);
    setupFs({ mtime: STALE_MTIME, subagentFiles: ["agent-old.jsonl"] });
    const w = new JsonlWatcher();
    const events = collect(w, "subagent-event");
    w.start();
    w.stop();
    expect(events.some((e) => e.event === "SubagentStart")).toBe(false);
  });
});

// ─── Sub-agent keepalive (getActiveSessionIds) ───────────────────────────────

describe("getActiveSessionIds — sub-agent keepalive", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    setSystemTime();
  });

  test("a session with an active foreground sub-agent is active despite no pending tools", () => {
    setSystemTime(NOW);
    setupFs({
      lines: [{ type: "progress", parentToolUseID: "p1", data: { type: "agent_progress" } }],
    });
    const w = new JsonlWatcher();
    w.start();
    expect(w.getActiveSessionIds().has(SESSION_ID)).toBe(true);
    w.stop();
  });

  test("the parent of a live background sub-agent file is active", () => {
    jest.useFakeTimers();
    setSystemTime(NOW);
    setupFs({ subagentFiles: ["agent-bg1.jsonl"] });
    const w = new JsonlWatcher();
    w.start();
    expect(w.getActiveSessionIds().has(SESSION_ID)).toBe(true);
    w.stop();
  });

  test("session stops being active after the sub-agent turn ends", () => {
    setSystemTime(NOW);
    setupFs({
      lines: [
        { type: "progress", parentToolUseID: "p1", data: { type: "agent_progress" } },
        { type: "system", subtype: "turn_duration" },
      ],
    });
    const w = new JsonlWatcher();
    w.start();
    // turn_duration cleared activeSubagentToolIds and there are no pending tools.
    expect(w.getActiveSessionIds().has(SESSION_ID)).toBe(false);
    w.stop();
  });

  test("parent stops being active after the background sub-agent goes stale", () => {
    jest.useFakeTimers();
    setSystemTime(NOW);
    setupFs({ subagentFiles: ["agent-idle.jsonl"] });
    const w = new JsonlWatcher();
    w.start();
    expect(w.getActiveSessionIds().has(SESSION_ID)).toBe(true);
    jest.advanceTimersByTime(5_000); // idle → torn down + removed from file states
    expect(w.getActiveSessionIds().has(SESSION_ID)).toBe(false);
  });

  test("only valid UUID session ids are ever reported active", () => {
    setSystemTime(NOW);
    setupFs({
      lines: [{ type: "progress", parentToolUseID: "p1", data: { type: "agent_progress" } }],
    });
    const w = new JsonlWatcher();
    w.start();
    for (const id of w.getActiveSessionIds()) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
    w.stop();
  });
});
