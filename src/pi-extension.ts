// @peon-pet-managed-pi-extension
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";

export const PEON_PET_PI_EXTENSION_VERSION = 1;
const SOCKET_TIMEOUT_MS = 500;

export type PiPetEvent = {
  kind: "pi-session";
  sessionId: string;
  event: "SessionStart" | "UserPromptSubmit" | "Stop" | "SessionEnd";
  cwd: string | null;
  timestamp: number;
};

const PI_HOOKS = ["session_start", "turn_start", "agent_settled", "session_shutdown"] as const;
type PiHookName = (typeof PI_HOOKS)[number];
type EventSender = (event: PiPetEvent) => Promise<boolean>;
type Clock = () => number;

function socketPath(): string {
  const home = homedir();
  const support = join(home, "Library", "Application Support");
  const legacy = join(support, "Peon Pet");
  const appDirectory = existsSync(legacy) ? legacy : join(support, "peon-pet");
  return join(appDirectory, "copilot-ipc", "events.sock");
}

export function piSessionId(sessionId: string): string {
  const hash = createHash("sha256").update(`peon-pet:pi-session:${sessionId}`).digest("hex");
  const variant = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const hex = `91a11a0091a18${hash.slice(13, 16)}${variant}${hash.slice(17, 32)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createPiPetEvent(
  hookName: PiHookName,
  sessionId: string,
  cwd: string,
  timestamp: number,
): PiPetEvent {
  const events: Record<PiHookName, PiPetEvent["event"]> = {
    session_start: "SessionStart",
    turn_start: "UserPromptSubmit",
    agent_settled: "Stop",
    session_shutdown: "SessionEnd",
  };
  return {
    kind: "pi-session",
    sessionId: piSessionId(sessionId),
    event: events[hookName],
    cwd: cwd || null,
    timestamp,
  };
}

function sendPiPetEvent(event: PiPetEvent): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let response = "";
    const socket = createConnection(socketPath());
    const finish = (delivered: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve(delivered);
    };
    const timeout = setTimeout(() => finish(false), SOCKET_TIMEOUT_MS);
    socket.on("connect", () => socket.write(`${JSON.stringify(event)}\n`));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      const newline = response.indexOf("\n");
      if (newline >= 0) finish(response.slice(0, newline) === '{"ok":true}');
    });
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
  });
}

export function registerPiLifecycleHandlers(
  pi: { on(name: PiHookName, handler: (event: unknown, ctx: unknown) => unknown): unknown },
  send: EventSender = sendPiPetEvent,
  now: Clock = Date.now,
): void {
  for (const hookName of PI_HOOKS) {
    pi.on(hookName, async (_event, context) => {
      const ctx = context as {
        cwd?: unknown;
        sessionManager?: { getSessionId?: () => unknown };
      };
      const sessionId = ctx.sessionManager?.getSessionId?.();
      if (
        typeof sessionId !== "string" ||
        sessionId.length === 0 ||
        sessionId.length > 256 ||
        typeof ctx.cwd !== "string" ||
        ctx.cwd.length > 4096
      ) {
        return;
      }
      try {
        await send(createPiPetEvent(hookName, sessionId, ctx.cwd, now()));
      } catch {
        // Pet delivery is best-effort and must not affect Pi's session lifecycle.
      }
    });
  }
}

export default function (pi: Parameters<typeof registerPiLifecycleHandlers>[0]): void {
  registerPiLifecycleHandlers(pi);
}
