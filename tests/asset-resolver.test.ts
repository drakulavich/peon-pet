import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { resolveAsset, contentTypeFor, type AssetContext } from "../src/app/asset-resolver.ts";
import { bundledFilename, BUNDLED_CHARS } from "../src/app/characters.ts";

const ROOT = "/proj";
const ASSETS = "/proj/renderer/assets";

function ctx(over: Partial<AssetContext> & { present?: string[] } = {}): AssetContext {
  const present = new Set(over.present ?? []);
  return {
    character: over.character ?? "orc",
    projectRoot: over.projectRoot ?? ROOT,
    assetsDir: over.assetsDir ?? ASSETS,
    userCharDir: over.userCharDir ?? null,
    threeBuildDir: over.threeBuildDir ?? null,
    fileExists: over.fileExists ?? ((p: string) => present.has(p)),
  };
}

// ─── characters map ───────────────────────────────────────────────────────────

describe("bundledFilename", () => {
  test("maps orc sprite atlas", () => {
    expect(bundledFilename("orc", "sprite-atlas.png")).toBe("orc-sprite-atlas.png");
  });

  test("a non-orc character's asset falls back to orc's bundled file", () => {
    // orc is the only bundled skin → any other character maps to orc
    expect(BUNDLED_CHARS["dragon"]).toBeUndefined();
    expect(bundledFilename("dragon", "bg.png")).toBe("bg-pixel.png");
  });

  test("unknown character falls back to orc map", () => {
    expect(bundledFilename("dragon", "sprite-atlas.png")).toBe("orc-sprite-atlas.png");
  });

  test("unknown asset name passes through unchanged", () => {
    expect(bundledFilename("orc", "mystery.png")).toBe("mystery.png");
  });
});

// ─── content types ────────────────────────────────────────────────────────────

describe("contentTypeFor", () => {
  test.each([
    ["a.html", "text/html; charset=utf-8"],
    ["a.js", "text/javascript; charset=utf-8"],
    ["a.png", "image/png"],
    ["flash.vert", "text/plain; charset=utf-8"],
    ["flash.frag", "text/plain; charset=utf-8"],
    ["weird.xyz", "application/octet-stream"],
  ])("%s → %s", (file, type) => {
    expect(contentTypeFor(file)).toBe(type);
  });
});

// ─── character assets (host form) ─────────────────────────────────────────────

describe("resolveAsset — character assets", () => {
  test("orc sprite-atlas resolves to bundled file", () => {
    const c = ctx({ present: [join(ASSETS, "orc-sprite-atlas.png")] });
    const r = resolveAsset("peon-asset://sprite-atlas.png", c);
    expect(r).toEqual({ filePath: join(ASSETS, "orc-sprite-atlas.png"), contentType: "image/png" });
  });

  test("user-installed character dir takes precedence over bundled", () => {
    const userDir = "/home/u/.peon/characters/orc";
    const c = ctx({
      userCharDir: userDir,
      present: [join(userDir, "sprite-atlas.png"), join(ASSETS, "orc-sprite-atlas.png")],
    });
    const r = resolveAsset("peon-asset://sprite-atlas.png", c);
    expect(r?.filePath).toBe(join(userDir, "sprite-atlas.png"));
  });

  test("falls back to bundled when user dir lacks the file", () => {
    const userDir = "/home/u/.peon/characters/orc";
    const c = ctx({ userCharDir: userDir, present: [join(ASSETS, "orc-sprite-atlas.png")] });
    const r = resolveAsset("peon-asset://sprite-atlas.png", c);
    expect(r?.filePath).toBe(join(ASSETS, "orc-sprite-atlas.png"));
  });

  test("a non-orc character's bg.png resolves via the orc fallback file", () => {
    const c = ctx({ character: "dragon", present: [join(ASSETS, "bg-pixel.png")] });
    const r = resolveAsset("peon-asset://bg.png", c);
    expect(r?.filePath).toBe(join(ASSETS, "bg-pixel.png"));
  });

  test("returns null when the bundled file is missing", () => {
    const c = ctx({ present: [] });
    expect(resolveAsset("peon-asset://sprite-atlas.png", c)).toBeNull();
  });

  test("user-dir override applies to dock-icon.png too", () => {
    const userDir = "/home/u/.peon/characters/orc";
    const c = ctx({
      userCharDir: userDir,
      present: [join(userDir, "dock-icon.png"), join(ASSETS, "orc-dock-icon.png")],
    });
    expect(resolveAsset("peon-asset://dock-icon.png", c)?.filePath).toBe(join(userDir, "dock-icon.png"));
  });

  test("unknown character falls back to the orc bundled asset", () => {
    const c = ctx({ character: "dragon", present: [join(ASSETS, "orc-sprite-atlas.png")] });
    expect(resolveAsset("peon-asset://sprite-atlas.png", c)?.filePath).toBe(
      join(ASSETS, "orc-sprite-atlas.png"),
    );
  });

  test("partial user override: overridden asset from user dir, others fall back to bundled", () => {
    const userDir = "/home/u/.peon/characters/orc";
    const c = ctx({
      userCharDir: userDir,
      present: [join(userDir, "sprite-atlas.png"), join(ASSETS, "orc-borders.png")],
    });
    // sprite-atlas overridden by the user; borders has no user file → bundled.
    expect(resolveAsset("peon-asset://sprite-atlas.png", c)?.filePath).toBe(join(userDir, "sprite-atlas.png"));
    expect(resolveAsset("peon-asset://borders.png", c)?.filePath).toBe(join(ASSETS, "orc-borders.png"));
  });
});

// ─── renderer files (path form) ───────────────────────────────────────────────

describe("resolveAsset — renderer files", () => {
  test("document path resolves under project root", () => {
    const c = ctx({ present: [join(ROOT, "renderer/index.html")] });
    const r = resolveAsset("peon-asset://app/renderer/index.html", c);
    expect(r).toEqual({
      filePath: join(ROOT, "renderer/index.html"),
      contentType: "text/html; charset=utf-8",
    });
  });

  test("three.js module under node_modules resolves", () => {
    const p = join(ROOT, "node_modules/three/build/three.module.js");
    const c = ctx({ present: [p] });
    const r = resolveAsset("peon-asset://app/node_modules/three/build/three.module.js", c);
    expect(r?.filePath).toBe(p);
    expect(r?.contentType).toBe("text/javascript; charset=utf-8");
  });

  test("three is served from the vendored threeBuildDir when set", () => {
    const vendored = "/proj/renderer/vendor/three/build";
    const v = join(vendored, "three.module.js");
    const c = ctx({ threeBuildDir: vendored, present: [v] });
    expect(resolveAsset("peon-asset://app/node_modules/three/build/three.module.js", c)?.filePath).toBe(v);
    // three.core.js (imported by three.module.js) resolves from the same dir
    const core = join(vendored, "three.core.js");
    const c2 = ctx({ threeBuildDir: vendored, present: [core] });
    expect(resolveAsset("peon-asset://app/node_modules/three/build/three.core.js", c2)?.filePath).toBe(core);
  });

  test("three falls back to node_modules when threeBuildDir lacks the file", () => {
    const vendored = "/proj/renderer/vendor/three/build";
    const nm = join(ROOT, "node_modules/three/build/three.module.js");
    // vendored dir set, but only the node_modules copy exists on disk
    const c = ctx({ threeBuildDir: vendored, present: [nm] });
    expect(resolveAsset("peon-asset://app/node_modules/three/build/three.module.js", c)?.filePath).toBe(nm);
  });

  test("shader file resolves with text/plain", () => {
    const p = join(ROOT, "renderer/shaders/flash.vert");
    const c = ctx({ present: [p] });
    const r = resolveAsset("peon-asset://app/renderer/shaders/flash.vert", c);
    expect(r?.contentType).toBe("text/plain; charset=utf-8");
  });

  test("missing path-form file returns null", () => {
    const c = ctx({ present: [] });
    expect(resolveAsset("peon-asset://app/renderer/missing.js", c)).toBeNull();
  });

  test("path traversal is clamped within the project root (cannot reach the real FS root)", () => {
    // URL normalization clamps `..` at the authority root, so a path-form request
    // can never escape projectRoot — it resolves under /proj, never to real /etc.
    const c = ctx({ fileExists: () => true });
    const r = resolveAsset("peon-asset://app/../../etc/passwd", c);
    expect(r?.filePath.startsWith(join(ROOT, ""))).toBe(true);
    expect(r?.filePath).not.toBe("/etc/passwd");
  });
});
