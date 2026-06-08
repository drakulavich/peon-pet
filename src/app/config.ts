// Configuration directory + file resolution. Pure (the filesystem is injected) so
// it's unit-testable; `main.ts` calls the zero-arg forms which use the real FS.

import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import type { Corner } from "./window-position.ts";

export interface PetConfig {
  character?: string;
  corner?: Corner;
}

/** Injected filesystem seam so config resolution is testable without real I/O. */
export interface ConfigEnv {
  home: string;
  fileExists: (path: string) => boolean;
  readFile: (path: string) => string;
}

const realEnv: ConfigEnv = {
  home: homedir(),
  fileExists: existsSync,
  readFile: (p) => readFileSync(p, "utf8"),
};

/**
 * The pet's config + `characters/` directory. Prefer the legacy Electron
 * `userData` location ("Peon Pet") if it exists, so upgrading users keep their
 * settings and custom skins; otherwise the native default ("peon-pet").
 */
export function configDir(env: ConfigEnv = realEnv): string {
  const support = join(env.home, "Library", "Application Support");
  const legacy = join(support, "Peon Pet"); // Electron productName dir
  const native = join(support, "peon-pet");
  return env.fileExists(legacy) ? legacy : native;
}

/** Read `<configDir>/peon-pet-config.json`; missing/malformed → empty config. */
export function loadConfig(env: ConfigEnv = realEnv): PetConfig {
  try {
    const parsed = JSON.parse(env.readFile(join(configDir(env), "peon-pet-config.json")));
    return parsed && typeof parsed === "object" ? (parsed as PetConfig) : {};
  } catch {
    return {};
  }
}
