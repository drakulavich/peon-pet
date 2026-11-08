import { createHash } from "node:crypto";

export type PiPetEvent = {
  kind: "pi-session";
  sessionId: string;
  event: "SessionStart" | "UserPromptSubmit" | "Stop" | "SessionEnd";
  cwd: string | null;
  timestamp: number;
};

const MAX_CWD_LENGTH = 4096;
const PI_SESSION_NAMESPACE = /^91a11a00-91a1-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PI_EVENTS = new Set(["SessionStart", "UserPromptSubmit", "Stop", "SessionEnd"]);

export function piSessionId(sessionId: string): string {
  const hash = createHash("sha256").update(`peon-pet:pi-session:${sessionId}`).digest("hex");
  const variant = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const hex = `91a11a0091a18${hash.slice(13, 16)}${variant}${hash.slice(17, 32)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validatePiPetEvent(value: unknown): PiPetEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind !== "pi-session" ||
    typeof candidate.sessionId !== "string" ||
    !PI_SESSION_NAMESPACE.test(candidate.sessionId) ||
    typeof candidate.event !== "string" ||
    !PI_EVENTS.has(candidate.event) ||
    typeof candidate.timestamp !== "number" ||
    !Number.isSafeInteger(candidate.timestamp) ||
    candidate.timestamp <= 0 ||
    (candidate.cwd !== null &&
      (typeof candidate.cwd !== "string" || candidate.cwd.length > MAX_CWD_LENGTH))
  ) {
    return null;
  }
  return {
    kind: "pi-session",
    sessionId: candidate.sessionId,
    event: candidate.event as PiPetEvent["event"],
    cwd: candidate.cwd,
    timestamp: candidate.timestamp,
  };
}
