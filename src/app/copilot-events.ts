import { createHash } from "node:crypto";

type SessionEventName =
  | "SessionStart"
  | "UserPromptSubmit"
  | "Stop"
  | "PermissionRequest"
  | "PostToolUseFailure"
  | "PreCompact"
  | "SessionEnd";

export type CopilotPetEvent =
  | {
      kind: "session";
      sessionId: string;
      event: SessionEventName;
      cwd: string | null;
      timestamp: number;
    }
  | {
      kind: "subagent";
      sessionId: string;
      parentToolId: string;
      event: "SubagentStart" | "SubagentStop";
      cwd: string | null;
      timestamp: number;
    };

const SESSION_HOOKS: Record<string, SessionEventName> = {
  sessionStart: "SessionStart",
  userPromptSubmitted: "UserPromptSubmit",
  agentStop: "Stop",
  permissionRequest: "PermissionRequest",
  postToolUseFailure: "PostToolUseFailure",
  preCompact: "PreCompact",
  sessionEnd: "SessionEnd",
};
const SESSION_EVENTS = new Set<SessionEventName>(Object.values(SESSION_HOOKS));

const MAX_SESSION_ID_LENGTH = 256;
const MAX_CWD_LENGTH = 4096;
const MAX_TRANSCRIPT_PATH_LENGTH = 4096;
const SAFE_SESSION_ID = /^[A-Za-z0-9._:-]+$/;
const COPILOT_SESSION_NAMESPACE = /^c0a17e71-c0a1-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function copilotSessionId(sessionId: string): string {
  const hash = createHash("sha256").update(`peon-pet:copilot-session:${sessionId}`).digest("hex");
  const variant = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const hex = `c0a17e71c0a18${hash.slice(13, 16)}${variant}${hash.slice(17, 32)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSessionMetadata(payload: Record<string, unknown>): {
  sessionId: string;
  cwd: string | null;
  timestamp: number;
} | null {
  const { sessionId, cwd, timestamp } = payload;
  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    sessionId.length > MAX_SESSION_ID_LENGTH ||
    !SAFE_SESSION_ID.test(sessionId) ||
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    (cwd !== undefined && (typeof cwd !== "string" || cwd.length > MAX_CWD_LENGTH))
  ) {
    return null;
  }

  return {
    sessionId: copilotSessionId(sessionId),
    cwd: typeof cwd === "string" && cwd.length > 0 ? cwd : null,
    timestamp,
  };
}

function subagentKey(sessionId: string, transcriptPath: unknown): string | null {
  if (
    typeof transcriptPath !== "string" ||
    transcriptPath.length === 0 ||
    transcriptPath.length > MAX_TRANSCRIPT_PATH_LENGTH
  ) {
    return null;
  }
  const digest = createHash("sha256").update(transcriptPath).digest("hex");
  return `${sessionId}:subagent:${digest}`;
}

export function parseCopilotHookEvent(hookName: string, payload: unknown): CopilotPetEvent | null {
  if (!isRecord(payload)) return null;

  if (hookName === "subagentStart" || hookName === "subagentStop") {
    const metadata = readSessionMetadata(payload);
    if (!metadata) return null;
    const parentToolId = subagentKey(metadata.sessionId, payload.transcriptPath);
    if (!parentToolId) return null;
    return {
      kind: "subagent",
      sessionId: metadata.sessionId,
      parentToolId,
      event: hookName === "subagentStart" ? "SubagentStart" : "SubagentStop",
      cwd: metadata.cwd,
      timestamp: metadata.timestamp,
    };
  }

  if (!Object.hasOwn(SESSION_HOOKS, hookName)) return null;
  const event = SESSION_HOOKS[hookName];
  if (!event) return null;
  const metadata = readSessionMetadata(payload);
  if (!metadata) return null;
  return { kind: "session", ...metadata, event };
}

export function validateCopilotPetEvent(value: unknown): CopilotPetEvent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.sessionId !== "string" ||
    !COPILOT_SESSION_NAMESPACE.test(value.sessionId)
  ) {
    return null;
  }

  if (value.kind === "session") {
    if (
      typeof value.event !== "string" ||
      !SESSION_EVENTS.has(value.event as SessionEventName) ||
      typeof value.timestamp !== "number" ||
      !Number.isSafeInteger(value.timestamp) ||
      value.timestamp <= 0 ||
      (value.cwd !== null &&
        (typeof value.cwd !== "string" || value.cwd.length > MAX_CWD_LENGTH))
    ) {
      return null;
    }
    return {
      kind: "session",
      sessionId: value.sessionId,
      event: value.event as SessionEventName,
      cwd: value.cwd,
      timestamp: value.timestamp,
    };
  }

  const subagentPrefix = `${value.sessionId}:subagent:`;
  const subagentDigest =
    typeof value.parentToolId === "string" && value.parentToolId.startsWith(subagentPrefix)
      ? value.parentToolId.slice(subagentPrefix.length)
      : "";
  if (
    value.kind === "subagent" &&
    (value.event === "SubagentStart" || value.event === "SubagentStop") &&
    /^[0-9a-f]{64}$/i.test(subagentDigest) &&
    (value.cwd === null || (typeof value.cwd === "string" && value.cwd.length <= MAX_CWD_LENGTH)) &&
    typeof value.timestamp === "number" &&
    Number.isSafeInteger(value.timestamp) &&
    value.timestamp > 0
  ) {
    return {
      kind: "subagent",
      sessionId: value.sessionId,
      parentToolId: value.parentToolId,
      event: value.event,
      cwd: value.cwd,
      timestamp: value.timestamp,
    };
  }
  return null;
}
