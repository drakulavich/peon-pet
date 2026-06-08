// Session tracking: which Claude Code sessions are active, and how recently.
// Ported verbatim from lib/session-tracker.js (logic unchanged).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A [sessionId, lastSeenTimestampMs] pair. */
export type SessionEntry = [string, number];

export interface SessionTracker {
  update(sessionId: string, timestamp?: number): void;
  prune(cutoff: number): void;
  size(): number;
  entries(): SessionEntry[];
  remove(sessionId: string): void;
}

export interface SessionState {
  id: string;
  hot: boolean;
  warm: boolean;
}

export function isValidSessionId(id: unknown): id is string {
  if (!id || typeof id !== "string") return false;
  return UUID_RE.test(id);
}

export function createSessionTracker(): SessionTracker {
  const map = new Map<string, number>();

  return {
    update(sessionId: string, timestamp: number = Date.now()): void {
      map.set(sessionId, timestamp);
    },
    prune(cutoff: number): void {
      for (const [id, t] of map) {
        if (t < cutoff) map.delete(id);
      }
    },
    size(): number {
      return map.size;
    },
    entries(): SessionEntry[] {
      return [...map.entries()];
    },
    remove(sessionId: string): void {
      map.delete(sessionId);
    },
  };
}

export function buildSessionStates(
  entries: SessionEntry[],
  now: number,
  hotMs: number,
  warmMs: number,
  maxCount: number,
): SessionState[] {
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCount)
    .map(([id, t]) => ({
      id,
      hot: now - t < hotMs,
      warm: now - t < warmMs,
    }));
}

/** Claude Code event name → sprite animation name. */
export const EVENT_TO_ANIM: Record<string, string> = {
  SessionStart: "waking",
  Stop: "celebrate",
  UserPromptSubmit: "typing",
  PermissionRequest: "alarmed",
  PostToolUseFailure: "annoyed",
  PreCompact: "alarmed",
};
