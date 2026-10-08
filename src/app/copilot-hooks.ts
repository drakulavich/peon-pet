import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

const HOOK_NAMES = [
  "sessionStart",
  "sessionEnd",
  "userPromptSubmitted",
  "permissionRequest",
  "postToolUseFailure",
  "preCompact",
  "agentStop",
  "subagentStart",
  "subagentStop",
] as const;
type HookName = (typeof HOOK_NAMES)[number];

interface CommandHook {
  type: "command";
  exec: string;
  args: ["--copilot-hook", HookName];
  timeoutSec: 5;
}

export interface CopilotHookConfig {
  version: 1;
  hooks: Record<HookName, [CommandHook]>;
}

export interface CopilotHookEnvironment {
  home?: string;
  copilotHome?: string;
  executablePath: string;
}

export function copilotHooksDirectory(home = homedir(), copilotHome?: string): string {
  return join(copilotHome || join(home, ".copilot"), "hooks");
}

export function buildCopilotHookConfig(executablePath: string): CopilotHookConfig {
  if (!isAbsolute(executablePath)) throw new Error("Copilot hook executable path must be absolute");
  const hooks = Object.fromEntries(
    HOOK_NAMES.map((hookName) => [
      hookName,
      [
        {
          type: "command",
          exec: executablePath,
          args: ["--copilot-hook", hookName],
          timeoutSec: 5,
        },
      ],
    ]),
  ) as CopilotHookConfig["hooks"];
  return { version: 1, hooks };
}

function managedFilePath(env: Pick<CopilotHookEnvironment, "home" | "copilotHome">): string {
  return join(copilotHooksDirectory(env.home, env.copilotHome), "peon-pet.json");
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function isManagedCopilotHookConfig(value: unknown): value is CopilotHookConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !candidate.hooks || typeof candidate.hooks !== "object") return false;
  if (Object.keys(candidate).sort().join(",") !== "hooks,version") return false;

  const hooks = candidate.hooks as Record<string, unknown>;
  if (Object.keys(hooks).sort().join(",") !== [...HOOK_NAMES].sort().join(",")) return false;
  return HOOK_NAMES.every((hookName) => {
    const entries = hooks[hookName];
    if (!Array.isArray(entries) || entries.length !== 1) return false;
    const entry = entries[0];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const command = entry as Record<string, unknown>;
    return (
      Object.keys(command).sort().join(",") === "args,exec,timeoutSec,type" &&
      command.type === "command" &&
      typeof command.exec === "string" &&
      isAbsolute(command.exec) &&
      command.timeoutSec === 5 &&
      Array.isArray(command.args) &&
      command.args.length === 2 &&
      command.args[0] === "--copilot-hook" &&
      command.args[1] === hookName
    );
  });
}

function readManagedFile(path: string): boolean {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) return false;
  try {
    return isManagedCopilotHookConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return false;
  }
}

export function installCopilotHooks(env: CopilotHookEnvironment): "installed" | "already-installed" {
  const filePath = managedFilePath(env);
  const content = `${JSON.stringify(buildCopilotHookConfig(env.executablePath), null, 2)}\n`;
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

  if (pathExists(filePath)) {
    if (lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`Refusing to overwrite unrecognized Copilot hook file: ${filePath}`);
    }
    if (!readManagedFile(filePath)) {
      throw new Error(`Refusing to overwrite unrecognized Copilot hook file: ${filePath}`);
    }
    if (readFileSync(filePath, "utf8") === content) return "already-installed";
  }

  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { flag: "wx", mode: 0o600 });
    if (pathExists(filePath)) {
      if (lstatSync(filePath).isSymbolicLink() || !readManagedFile(filePath)) {
        throw new Error(`Refusing to overwrite unrecognized Copilot hook file: ${filePath}`);
      }
    }
    renameSync(temporaryPath, filePath);
    chmodSync(filePath, 0o600);
    return "installed";
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function uninstallCopilotHooks(
  env: Pick<CopilotHookEnvironment, "home" | "copilotHome">,
): boolean {
  const filePath = managedFilePath(env);
  if (!pathExists(filePath)) return false;
  if (lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Refusing to remove unrecognized Copilot hook file: ${filePath}`);
  }
  if (!readManagedFile(filePath)) {
    throw new Error(`Refusing to remove unrecognized Copilot hook file: ${filePath}`);
  }
  unlinkSync(filePath);
  return true;
}
