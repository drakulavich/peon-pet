// Watches ~/.claude/projects/ JSONL transcripts and emits session/subagent events.
// Ported verbatim from lib/jsonl-watcher.js (logic unchanged; types added).

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { EventEmitter } from "node:events";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const SCAN_INTERVAL_MS = 1000;
const FILE_POLL_INTERVAL_MS = 500;
const SESSION_PRUNE_MS = 10 * 60 * 1000; // skip files older than 10min on startup
const PERMISSION_TIMEOUT_MS = 7000;
const SUBAGENT_IDLE_MS = 5000; // subagent window closes after 5s of no new content
const PERMISSION_EXEMPT_TOOLS = new Set(["Task", "Agent", "AskUserQuestion"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SessionEventName =
  | "SessionStart"
  | "SessionSeen"
  | "SessionCwd"
  | "Stop"
  | "UserPromptSubmit"
  | "PermissionRequest"
  | "PostToolUseFailure";

export interface SessionEvent {
  sessionId: string;
  event: SessionEventName;
  cwd?: string | null;
  timestamp: number;
}

export type SubagentEventName = "SubagentStart" | "SubagentStop";

export interface SubagentEvent {
  sessionId: string;
  parentToolId: string;
  event: SubagentEventName;
}

interface FileState {
  sessionId: string;
  filePath: string;
  lineBuffer: string;
  offset: number;
  fsWatcher: fs.FSWatcher | null;
  pollInterval: ReturnType<typeof setInterval> | null;
  staleTimer: ReturnType<typeof setTimeout> | null;
  cwd: string | null;
  pendingTools?: Set<string>;
  permissionTimer?: ReturnType<typeof setTimeout> | null;
  activeSubagentToolIds?: Set<string>;
  parentToolId?: string;
  isSubagentFile?: boolean;
}

function sessionIdFromPath(filePath: string): string | null {
  const base = path.basename(filePath, ".jsonl");
  return UUID_RE.test(base) ? base : null;
}

/**
 * Watches ~/.claude/projects/ for JSONL transcript files and emits events:
 *
 *   'session-event'  { sessionId, event, cwd, timestamp }
 *   'subagent-event' { sessionId, parentToolId, event }
 *
 * Two subagent mechanisms are detected:
 *   - Foreground (sync) agents: agent_progress records in the main session JSONL
 *   - Background agents: separate files at <session-id>/subagents/agent-<agentId>.jsonl
 */
export class JsonlWatcher extends EventEmitter {
  private _fileStates: Map<string, FileState>;
  private _knownFiles: Set<string>;
  private _scanInterval: ReturnType<typeof setInterval> | null;
  private _startupScanDone: boolean;

  constructor() {
    super();
    this._fileStates = new Map();
    this._knownFiles = new Set();
    this._scanInterval = null;
    this._startupScanDone = false;
  }

  start(): void {
    this._scan();
    this._startupScanDone = true;
    this._scanInterval = setInterval(() => this._scan(), SCAN_INTERVAL_MS);
  }

  // Session IDs that should be kept "hot" by the heartbeat: those with unresolved
  // tool_use calls, OR those running a sub-agent — foreground (`agent_progress`
  // tracked in `activeSubagentToolIds`) or background (a live `subagents/` file,
  // whose `sessionId` is the parent). The sub-agent cases keep the parent orc awake
  // during long sub-agent tasks, where the parent transcript may go quiet and the
  // `Task`/`Agent` tools are permission-exempt (so not counted as pending).
  getActiveSessionIds(): Set<string> {
    const active = new Set<string>();
    for (const state of this._fileStates.values()) {
      if (state.isSubagentFile) {
        // Live background sub-agent → parent stays active. This decays ONLY because
        // `_watchSubagentFile` always arms a stale timer that deletes the file state
        // after SUBAGENT_IDLE_MS; don't drop that invariant or sessions stick active.
        active.add(state.sessionId);
      } else if ((state.pendingTools?.size ?? 0) > 0 || (state.activeSubagentToolIds?.size ?? 0) > 0) {
        active.add(state.sessionId);
      }
    }
    return active;
  }

  stop(): void {
    if (this._scanInterval) clearInterval(this._scanInterval);
    for (const state of this._fileStates.values()) this._teardownFile(state);
    this._fileStates.clear();
    this._knownFiles.clear();
  }

  private _scan(): void {
    if (!fs.existsSync(PROJECTS_DIR)) return;
    try {
      const projectDirs = fs
        .readdirSync(PROJECTS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(PROJECTS_DIR, d.name));

      for (const dir of projectDirs) {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            this._registerFile(path.join(dir, entry.name));
          } else if (entry.isDirectory() && UUID_RE.test(entry.name)) {
            // Session subdirectory — scan for background subagent files
            this._scanSubagentsDir(path.join(dir, entry.name, "subagents"), entry.name);
          }
        }
      }
    } catch {}
  }

  private _scanSubagentsDir(subagentsDir: string, parentSessionId: string): void {
    let files: string[];
    try {
      files = fs.readdirSync(subagentsDir) as string[];
    } catch {
      return;
    }
    for (const f of files) {
      if (!f.startsWith("agent-") || !f.endsWith(".jsonl")) continue;
      const filePath = path.join(subagentsDir, f);
      if (this._knownFiles.has(filePath)) continue;
      this._knownFiles.add(filePath);
      const agentId = f.slice("agent-".length, -".jsonl".length);
      this._watchSubagentFile(filePath, parentSessionId, agentId);
    }
  }

  private _registerFile(filePath: string): void {
    if (this._knownFiles.has(filePath)) return;
    this._knownFiles.add(filePath);
    this._watchFile(filePath);
  }

  private _watchFile(filePath: string): void {
    const sessionId = sessionIdFromPath(filePath);
    if (!sessionId) return;

    const isStartup = !this._startupScanDone;
    let fileMtime: number;
    try {
      fileMtime = fs.statSync(filePath).mtimeMs;
    } catch {
      return;
    }

    // Skip stale files during startup
    if (isStartup && Date.now() - fileMtime > SESSION_PRUNE_MS) return;

    const state: FileState = {
      sessionId,
      filePath,
      lineBuffer: "",
      offset: 0,
      fsWatcher: null,
      pollInterval: null,
      staleTimer: null,
      cwd: null,
      pendingTools: new Set(),
      permissionTimer: null,
      activeSubagentToolIds: new Set(),
    };

    this.emit("session-event", {
      sessionId,
      event: isStartup ? "SessionSeen" : "SessionStart",
      cwd: null,
      timestamp: isStartup ? fileMtime : Date.now(),
    });

    const readNew = () => this._readNewLines(state);
    try {
      state.fsWatcher = fs.watch(filePath, readNew);
    } catch {}
    state.pollInterval = setInterval(readNew, FILE_POLL_INTERVAL_MS);
    this._fileStates.set(filePath, state);
    readNew();
  }

  private _watchSubagentFile(filePath: string, parentSessionId: string, agentId: string): void {
    const isStartup = !this._startupScanDone;
    let fileMtime: number;
    try {
      fileMtime = fs.statSync(filePath).mtimeMs;
    } catch {
      return;
    }

    // Skip stale subagent files on startup
    if (isStartup && Date.now() - fileMtime > SESSION_PRUNE_MS) return;

    const parentToolId = `bg_${agentId}`;

    const state: FileState = {
      sessionId: parentSessionId,
      filePath,
      lineBuffer: "",
      offset: 0,
      fsWatcher: null,
      pollInterval: null,
      staleTimer: null,
      cwd: null,
      parentToolId,
      isSubagentFile: true,
    };

    this.emit("subagent-event", { sessionId: parentSessionId, parentToolId, event: "SubagentStart" });

    const resetStaleTimer = () => {
      if (state.staleTimer) clearTimeout(state.staleTimer);
      state.staleTimer = setTimeout(() => {
        this.emit("subagent-event", { sessionId: parentSessionId, parentToolId, event: "SubagentStop" });
        this._teardownFile(state);
        this._fileStates.delete(filePath);
      }, SUBAGENT_IDLE_MS);
    };

    const readNew = () => {
      const hadNew = this._readNewLines(state);
      if (hadNew) resetStaleTimer();
    };

    try {
      state.fsWatcher = fs.watch(filePath, readNew);
    } catch {}
    state.pollInterval = setInterval(readNew, FILE_POLL_INTERVAL_MS);
    this._fileStates.set(filePath, state);
    readNew();
    resetStaleTimer();
  }

  private _teardownFile(state: FileState): void {
    try {
      state.fsWatcher?.close();
    } catch {}
    if (state.pollInterval) clearInterval(state.pollInterval);
    if (state.permissionTimer) clearTimeout(state.permissionTimer);
    if (state.staleTimer) clearTimeout(state.staleTimer);
  }

  // Returns true if new bytes were read
  private _readNewLines(state: FileState): boolean {
    let buf: Buffer;
    try {
      const fd = fs.openSync(state.filePath, "r");
      const size = fs.fstatSync(fd).size;
      if (size <= state.offset) {
        fs.closeSync(fd);
        return false;
      }
      buf = Buffer.alloc(size - state.offset);
      fs.readSync(fd, buf, 0, buf.length, state.offset);
      state.offset = size;
      fs.closeSync(fd);
    } catch {
      return false;
    }

    const text = state.lineBuffer + buf.toString("utf8");
    const lines = text.split("\n");
    state.lineBuffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) this._processLine(line, state);
    }
    return true;
  }

  private _processLine(line: string, state: FileState): void {
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }

    // Subagent files: only extract cwd, nothing else to track
    if (state.isSubagentFile) {
      if (!state.cwd && record.cwd) state.cwd = record.cwd;
      return;
    }

    // Extract cwd from the first record that has it
    if (!state.cwd && record.cwd) {
      state.cwd = record.cwd;
      this.emit("session-event", {
        sessionId: state.sessionId,
        event: "SessionCwd",
        cwd: record.cwd,
        timestamp: Date.now(),
      });
    }

    const now = Date.now();

    switch (record.type) {
      case "system":
        this._handleSystem(record, state, now);
        break;
      case "assistant":
        this._handleAssistant(record, state, now);
        break;
      case "user":
        this._handleUser(record, state, now);
        break;
      case "progress":
        this._handleProgress(record, state);
        break;
    }
  }

  private _handleSystem(record: any, state: FileState, now: number): void {
    if (record.subtype === "turn_duration") {
      state.pendingTools?.clear();
      if (state.permissionTimer) {
        clearTimeout(state.permissionTimer);
        state.permissionTimer = null;
      }

      for (const parentToolId of state.activeSubagentToolIds ?? []) {
        this.emit("subagent-event", { sessionId: state.sessionId, parentToolId, event: "SubagentStop" });
      }
      state.activeSubagentToolIds?.clear();

      this.emit("session-event", { sessionId: state.sessionId, event: "Stop", timestamp: now });
    }
  }

  private _handleAssistant(record: any, state: FileState, now: number): void {
    const content = record.message?.content;
    if (!Array.isArray(content)) return;

    const toolUses = content.filter((c: any) => c.type === "tool_use");
    const hasActivity =
      toolUses.length > 0 || content.some((c: any) => c.type === "text" && c.text?.trim());

    if (hasActivity) {
      this.emit("session-event", { sessionId: state.sessionId, event: "UserPromptSubmit", timestamp: now });
    }

    for (const tool of toolUses) {
      if (!PERMISSION_EXEMPT_TOOLS.has(tool.name)) {
        state.pendingTools?.add(tool.id);
      }
    }

    this._resetPermissionTimer(state);
  }

  private _handleUser(record: any, state: FileState, now: number): void {
    const content = record.message?.content;
    if (!Array.isArray(content)) return;

    let hadFailure = false;
    for (const item of content) {
      if (item.type === "tool_result") {
        state.pendingTools?.delete(item.tool_use_id);
        if (item.is_error) hadFailure = true;
      }
    }

    if (hadFailure) {
      this.emit("session-event", { sessionId: state.sessionId, event: "PostToolUseFailure", timestamp: now });
    }

    if (state.pendingTools?.size === 0 && state.permissionTimer) {
      clearTimeout(state.permissionTimer);
      state.permissionTimer = null;
    }
  }

  private _handleProgress(record: any, state: FileState): void {
    const data = record.data || {};

    // Foreground subagents: agent_progress records in the main session JSONL
    if (data.type === "agent_progress") {
      const parentToolId = record.parentToolUseID || record.toolUseID;
      if (parentToolId && !state.activeSubagentToolIds?.has(parentToolId)) {
        state.activeSubagentToolIds?.add(parentToolId);
        this.emit("subagent-event", { sessionId: state.sessionId, parentToolId, event: "SubagentStart" });
      }
    }
  }

  private _resetPermissionTimer(state: FileState): void {
    if (state.pendingTools?.size === 0) return;
    if (state.permissionTimer) return;

    state.permissionTimer = setTimeout(() => {
      state.permissionTimer = null;
      if ((state.pendingTools?.size ?? 0) > 0) {
        this.emit("session-event", {
          sessionId: state.sessionId,
          event: "PermissionRequest",
          timestamp: Date.now(),
        });
      }
    }, PERMISSION_TIMEOUT_MS);
  }
}
