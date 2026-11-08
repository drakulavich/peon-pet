import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MANAGED_MARKER = "// @peon-pet-managed-pi-extension";

export interface PiExtensionEnvironment {
  home?: string;
  piAgentDir?: string;
}

function agentDirectory(home = homedir(), piAgentDir?: string): string {
  return piAgentDir || join(home, ".pi", "agent");
}

export function piExtensionsDirectory(home = homedir(), piAgentDir?: string): string {
  return join(agentDirectory(home, piAgentDir), "extensions");
}

function managedFilePath(env: PiExtensionEnvironment): string {
  return join(piExtensionsDirectory(env.home, env.piAgentDir), "peon-pet.ts");
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

function isManagedExtension(path: string): boolean {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) return false;
  return readFileSync(path, "utf8").startsWith(`${MANAGED_MARKER}\n`);
}

export function installPiExtension(
  env: PiExtensionEnvironment & { extensionSource: string },
): "installed" | "already-installed" {
  if (!env.extensionSource.startsWith(`${MANAGED_MARKER}\n`)) {
    throw new Error("Pi extension source is missing Peon Pet's ownership marker");
  }

  const filePath = managedFilePath(env);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  if (pathExists(filePath)) {
    if (!isManagedExtension(filePath)) {
      throw new Error(`Refusing to overwrite unrecognized Pi extension: ${filePath}`);
    }
    if (readFileSync(filePath, "utf8") === env.extensionSource) return "already-installed";
  }

  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, env.extensionSource, { flag: "wx", mode: 0o600 });
    if (pathExists(filePath) && !isManagedExtension(filePath)) {
      throw new Error(`Refusing to overwrite unrecognized Pi extension: ${filePath}`);
    }
    renameSync(temporaryPath, filePath);
    return "installed";
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function uninstallPiExtension(env: PiExtensionEnvironment): boolean {
  const filePath = managedFilePath(env);
  if (!pathExists(filePath)) return false;
  if (!isManagedExtension(filePath)) {
    throw new Error(`Refusing to remove unrecognized Pi extension: ${filePath}`);
  }
  unlinkSync(filePath);
  return true;
}
