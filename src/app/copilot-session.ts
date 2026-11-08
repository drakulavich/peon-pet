import type { SessionTracker } from "./session-tracker.ts";
import type { CopilotPetEvent } from "./copilot-events.ts";

export function shouldApplyCopilotEvent(
  event: CopilotPetEvent,
  endedSessions: Map<string, number>,
  now = Date.now(),
  retentionMs = 10 * 60 * 1000,
): boolean {
  for (const [sessionId, endedAt] of endedSessions) {
    if (now - endedAt <= retentionMs) break;
    endedSessions.delete(sessionId);
  }
  if (event.kind === "session" && event.event === "SessionStart") {
    endedSessions.delete(event.sessionId);
    return true;
  }
  if (endedSessions.has(event.sessionId)) return false;
  if (event.kind === "session" && event.event === "SessionEnd") {
    endedSessions.set(event.sessionId, now);
  }
  return true;
}

export function applyCopilotSessionEvent(
  event: Extract<CopilotPetEvent, { kind: "session" }>,
  tracker: SessionTracker,
  sessionCwds: Map<string, string>,
): "updated" | "ended" {
  if (event.event === "SessionEnd") {
    tracker.remove(event.sessionId);
    sessionCwds.delete(event.sessionId);
    return "ended";
  }
  tracker.update(event.sessionId, event.timestamp);
  if (event.cwd) sessionCwds.set(event.sessionId, event.cwd);
  return "updated";
}
