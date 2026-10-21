import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { copilotSessionId, type CopilotPetEvent } from "./copilot-events.ts";
import { copilotSocketPath, sendCopilotEvent } from "./copilot-ipc.ts";

export const MAX_ANTIGRAVITY_HOOK_INPUT_BYTES = 64 * 1024;
export const ANTIGRAVITY_NAMESPACE = "peon-pet";

const HOOK_EVENTS = {
  PreInvocation: "UserPromptSubmit",
  Stop: "Stop",
  SessionEnd: "SessionEnd",
} as const;
type HookName = keyof typeof HOOK_EVENTS;
const HOOK_NAMES = Object.keys(HOOK_EVENTS) as HookName[];

const SAFE_SESSION_ID = /^[A-Za-z0-9._:-]{1,256}$/;
const MAX_CWD_LENGTH = 4096;
const MAX_TRANSCRIPT_PATH_LENGTH = 4096;
const FALLBACK_SESSION = "default";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export function parseAntigravityHookEvent(
  hookName: string,
  payload: unknown,
  now = Date.now(),
): CopilotPetEvent | null {
  if (!Object.hasOwn(HOOK_EVENTS, hookName) || !isRecord(payload)) return null;
  const rawId = firstString(payload, ["conversation_id", "conversationId", "session_id", "sessionId"]);
  const sessionKey = rawId && SAFE_SESSION_ID.test(rawId) ? rawId : FALLBACK_SESSION;
  const cwd = firstString(payload, ["cwd", "workspace_path", "workspacePath"]);
  const transcriptPath = firstString(payload, ["transcript_path", "transcriptPath"]);
  return {
    kind: "session",
    sessionId: copilotSessionId(sessionKey, "antigravity-session"),
    event: HOOK_EVENTS[hookName as HookName],
    cwd: cwd && cwd.length <= MAX_CWD_LENGTH ? cwd : null,
    timestamp: now,
    ...(sessionKey !== FALLBACK_SESSION ? { conversationId: sessionKey } : {}),
    ...(transcriptPath && transcriptPath.length <= MAX_TRANSCRIPT_PATH_LENGTH ? { transcriptPath } : {}),
  };
}

const ANTIGRAVITY_APP_DIRS = ["antigravity-ide", "antigravity-cli", "antigravity"];

export function findAntigravityTranscript(
  conversationId: string,
  customPath?: string | null,
  home = homedir(),
): string | null {
  if (customPath && existsSync(customPath)) return customPath;
  if (!conversationId || !SAFE_SESSION_ID.test(conversationId)) return null;

  for (const app of ANTIGRAVITY_APP_DIRS) {
    const candidate = join(
      home,
      ".gemini",
      app,
      "brain",
      conversationId,
      ".system_generated",
      "logs",
      "transcript.jsonl",
    );
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function isAntigravityTranscriptActive(filePath: string): boolean {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return false;
  }
  try {
    const size = statSync(filePath).size;
    if (size === 0) return true;
    const toRead = Math.min(size, 8192);
    const buf = Buffer.alloc(toRead);
    readSync(fd, buf, 0, toRead, size - toRead);
    const text = buf.toString("utf8");
    const lines = text.split(String.fromCharCode(10));
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const record = JSON.parse(line);
        if (!isRecord(record)) continue;
        const rtype = record.type;
        if (rtype === "USER_INPUT") {
          return true;
        }
        if (rtype === "PLANNER_RESPONSE") {
          if (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) {
            return true;
          }
          return false;
        }
        if (rtype === "ERROR_MESSAGE") {
          return false;
        }
        return true;
      } catch {}
    }
    return false;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

export type AntigravityDispatchResult = "delivered" | "invalid" | "unavailable";

export async function dispatchAntigravityHook(
  hookName: string,
  input: string,
  socketPath = copilotSocketPath(),
  send: (socketPath: string, event: CopilotPetEvent) => Promise<boolean> = sendCopilotEvent,
): Promise<AntigravityDispatchResult> {
  if (Buffer.byteLength(input, "utf8") > MAX_ANTIGRAVITY_HOOK_INPUT_BYTES) return "invalid";
  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch {
    return "invalid";
  }
  const event = parseAntigravityHookEvent(hookName, payload);
  if (!event) return "invalid";
  try {
    return (await send(socketPath, event)) ? "delivered" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export interface AntigravityHookEnvironment {
  home?: string;
  executablePath: string;
}

export function antigravityHooksPath(home = homedir()): string {
  return join(home, ".gemini", "config", "hooks.json");
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\\x27'") + "'";
}

export function buildAntigravityHooks(executablePath: string): Record<HookName, unknown[]> {
  if (!isAbsolute(executablePath)) throw new Error("Antigravity hook executable path must be absolute");
  return Object.fromEntries(
    HOOK_NAMES.map((name) => [
      name,
      [{ type: "command", command: `${shellQuote(executablePath)} --antigravity-hook ${name}`, timeout: 5 }],
    ]),
  ) as Record<HookName, unknown[]>;
}

function readConfig(path: string): Record<string, unknown> | null {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Refusing to modify unrecognized Antigravity hooks file: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Refusing to modify unparseable Antigravity hooks file: ${path}`);
  }
  if (!isRecord(parsed)) throw new Error(`Refusing to modify unrecognized Antigravity hooks file: ${path}`);
  return parsed;
}

function writeConfig(path: string, config: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function installAntigravityHooks(env: AntigravityHookEnvironment): "installed" | "already-installed" {
  const path = antigravityHooksPath(env.home);
  const config = readConfig(path) ?? {};
  const desired = buildAntigravityHooks(env.executablePath);
  if (JSON.stringify(config[ANTIGRAVITY_NAMESPACE]) === JSON.stringify(desired)) return "already-installed";
  writeConfig(path, { ...config, [ANTIGRAVITY_NAMESPACE]: desired });
  return "installed";
}

export function uninstallAntigravityHooks(env: Pick<AntigravityHookEnvironment, "home">): boolean {
  const path = antigravityHooksPath(env.home);
  const config = readConfig(path);
  if (!config || !Object.hasOwn(config, ANTIGRAVITY_NAMESPACE)) return false;
  const { [ANTIGRAVITY_NAMESPACE]: _removed, ...rest } = config;
  writeConfig(path, rest);
  return true;
}
