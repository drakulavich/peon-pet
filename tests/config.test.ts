import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { configDir, loadConfig, type ConfigEnv } from "../src/app/config.ts";

const HOME = "/home/u";
const SUPPORT = join(HOME, "Library", "Application Support");
const LEGACY = join(SUPPORT, "Peon Pet");
const NATIVE = join(SUPPORT, "peon-pet");

function env(over: Partial<ConfigEnv> & { present?: string[]; files?: Record<string, string> } = {}): ConfigEnv {
  const present = new Set(over.present ?? []);
  const files = over.files ?? {};
  return {
    home: over.home ?? HOME,
    fileExists: over.fileExists ?? ((p) => present.has(p) || p in files),
    readFile:
      over.readFile ??
      ((p) => {
        if (p in files) return files[p];
        throw new Error("ENOENT");
      }),
  };
}

describe("configDir", () => {
  test("prefers the legacy Electron dir when it exists", () => {
    expect(configDir(env({ present: [LEGACY] }))).toBe(LEGACY);
  });

  test("falls back to the native dir when no legacy dir exists", () => {
    expect(configDir(env({ present: [] }))).toBe(NATIVE);
  });
});

describe("loadConfig", () => {
  test("parses a valid config from the resolved dir", () => {
    const path = join(NATIVE, "peon-pet-config.json");
    const cfg = loadConfig(env({ files: { [path]: JSON.stringify({ character: "dragon", corner: "top-right" }) } }));
    expect(cfg).toEqual({ character: "dragon", corner: "top-right" });
  });

  test("reads from the legacy dir when present", () => {
    const path = join(LEGACY, "peon-pet-config.json");
    const cfg = loadConfig(env({ present: [LEGACY], files: { [path]: JSON.stringify({ character: "orc" }) } }));
    expect(cfg.character).toBe("orc");
  });

  test("missing config file → empty config (safe defaults)", () => {
    expect(loadConfig(env({ files: {} }))).toEqual({});
  });

  test("malformed JSON → empty config (no throw)", () => {
    const path = join(NATIVE, "peon-pet-config.json");
    expect(loadConfig(env({ files: { [path]: "{ not valid json" } }))).toEqual({});
  });

  test("non-object JSON → empty config", () => {
    const path = join(NATIVE, "peon-pet-config.json");
    expect(loadConfig(env({ files: { [path]: "42" } }))).toEqual({});
  });
});
