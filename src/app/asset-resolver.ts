// Pure resolution of a peon-asset:// request to an on-disk file + content type.
// No FFI, no I/O of its own (existence checks are injected) so it is fully
// unit-testable. The AppKit WKURLSchemeHandler (Phase 5) is a thin adapter that
// parses the request, calls resolveAsset, and streams the bytes.
//
// Two request shapes, matching the unchanged renderer:
//   - Character asset (host form):  peon-asset://bg.png            (pathname "/")
//       → renderer/assets with precedence: user char dir → bundled → orc fallback
//   - Renderer file (path form):    peon-asset://app/renderer/app.js
//       → a file under the project root, addressed by pathname
//
// Loading the document as `peon-asset://app/renderer/index.html` makes the
// renderer's relative refs resolve as path-form requests:
//   ../node_modules/three/build/three.module.js  → /node_modules/three/...
//   ./shaders/flash.vert                          → /renderer/shaders/flash.vert
//   app.js                                        → /renderer/app.js

import { join, normalize, sep, extname } from "node:path";
import { bundledFilename } from "./characters.ts";

export interface AssetContext {
  /** Active character (e.g. "orc"). */
  character: string;
  /** Absolute project root, for path-form requests. */
  projectRoot: string;
  /** Absolute renderer/assets dir, for character assets. */
  assetsDir: string;
  /** Absolute user-installed character dir, or null if none. */
  userCharDir: string | null;
  /**
   * Absolute dir holding three.js's `build/` files (three.module.js + three.core.js).
   * When set, `node_modules/three/build/*` requests are served from here instead of
   * `<projectRoot>/node_modules/three/build/*`. Lets the published package vendor
   * three so it works even when npm hoists the real `three` elsewhere. Null = use
   * the project root (git-clone layout).
   */
  threeBuildDir?: string | null;
  /** Injected existence check (real FS in prod, fake in tests). */
  fileExists: (path: string) => boolean;
}

const THREE_BUILD_PREFIX = "node_modules/three/build/";

export interface ResolvedAsset {
  filePath: string;
  contentType: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".vert": "text/plain; charset=utf-8",
  ".frag": "text/plain; charset=utf-8",
  ".glsl": "text/plain; charset=utf-8",
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
}

/**
 * Resolve a peon-asset:// URL to a file. Returns null if not found or if a
 * path-form request escapes the project root.
 */
export function resolveAsset(requestUrl: string, ctx: AssetContext): ResolvedAsset | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }

  const pathname = decodeURIComponent(url.pathname);

  // ── Character asset (host form): peon-asset://<filename> ───────────────────
  if (pathname === "" || pathname === "/") {
    const filename = decodeURIComponent(url.hostname);
    if (!filename) return null;

    // 1. user-installed character dir
    if (ctx.userCharDir) {
      const userPath = join(ctx.userCharDir, filename);
      if (ctx.fileExists(userPath)) {
        return { filePath: userPath, contentType: contentTypeFor(userPath) };
      }
    }
    // 2. bundled char-specific → orc fallback → identity
    const mapped = bundledFilename(ctx.character, filename);
    const bundledPath = join(ctx.assetsDir, mapped);
    if (!ctx.fileExists(bundledPath)) return null;
    return { filePath: bundledPath, contentType: contentTypeFor(bundledPath) };
  }

  // ── Renderer file (path form): peon-asset://app/<path under project root> ──
  const rel = normalize(pathname).replace(/^([/\\])+/, "");

  // three.js alias: serve vendored three from threeBuildDir if configured + present.
  if (ctx.threeBuildDir && rel.startsWith(THREE_BUILD_PREFIX)) {
    const file = rel.slice(THREE_BUILD_PREFIX.length);
    const aliased = join(ctx.threeBuildDir, file);
    const prefix = ctx.threeBuildDir.endsWith(sep) ? ctx.threeBuildDir : ctx.threeBuildDir + sep;
    if (aliased.startsWith(prefix) && ctx.fileExists(aliased)) {
      return { filePath: aliased, contentType: contentTypeFor(aliased) };
    }
    // else fall through to the project-root path (git-clone node_modules layout)
  }

  const filePath = join(ctx.projectRoot, rel);
  // Guard against path traversal escaping the project root.
  const rootPrefix = ctx.projectRoot.endsWith(sep) ? ctx.projectRoot : ctx.projectRoot + sep;
  if (filePath !== ctx.projectRoot && !filePath.startsWith(rootPrefix)) return null;
  if (!ctx.fileExists(filePath)) return null;
  return { filePath, contentType: contentTypeFor(filePath) };
}
