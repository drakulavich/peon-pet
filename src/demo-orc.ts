// Phase 5a demo — the REAL orc renderer in a transparent WKWebView, served via
// the peon-asset:// scheme handler, asset paths resolved by the Phase-3 TS
// resolver. No Electron. This is the visual proof that the renderer is unchanged
// and runs in system WebKit over a click-through panel.
//
//   bun run build:native
//   bun run src/demo-orc.ts          # shows the orc bottom-left (Ctrl-C quits)
//   bun run src/demo-orc.ts --check  # headless: build webview panel, no run loop

import { dlopen, FFIType } from "bun:ffi";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { resolveAsset } from "./app/asset-resolver.ts";
import { DEFAULT_CHARACTER } from "./app/characters.ts";

const PROJECT_ROOT = join(import.meta.dir, "..");
const DYLIB = join(PROJECT_ROOT, "native", "libpeonshell.dylib");
const ASSETS_DIR = join(PROJECT_ROOT, "renderer", "assets");

if (!existsSync(DYLIB)) {
  console.error(`Native shim not found. Build it first:  bun run build:native`);
  process.exit(1);
}

const { symbols: shim } = dlopen(DYLIB, {
  peon_init: { args: [], returns: FFIType.void },
  peon_set_project_root: { args: [FFIType.cstring], returns: FFIType.void },
  peon_register_asset: { args: [FFIType.cstring, FFIType.cstring], returns: FFIType.void },
  peon_make_webview_panel: {
    args: [FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64],
    returns: FFIType.ptr,
  },
  peon_panel_load: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.void },
  peon_panel_show: { args: [FFIType.ptr], returns: FFIType.void },
  peon_primary_work_height: { args: [], returns: FFIType.f64 },
  peon_run: { args: [], returns: FFIType.void },
});

// bun:ffi passes C `const char*` args as null-terminated buffers, not JS strings.
const cstr = (s: string): Buffer => Buffer.from(s + "\0", "utf8");

const SIZE = 200;
const MARGIN = 20;
const CHARACTER = DEFAULT_CHARACTER;

// Host-form character assets the renderer requests (app.js + dock).
const ASSET_NAMES = ["bg.png", "sprite-atlas.png", "borders.png", "dock-icon.png"];

shim.peon_init();
shim.peon_set_project_root(cstr(PROJECT_ROOT));

// Resolve each character asset in TS (the tested precedence) and hand the
// absolute path to native, which serves the bytes.
const ctx = {
  character: CHARACTER,
  projectRoot: PROJECT_ROOT,
  assetsDir: ASSETS_DIR,
  userCharDir: null,
  fileExists: existsSync,
};
for (const name of ASSET_NAMES) {
  const resolved = resolveAsset(`peon-asset://${name}`, ctx);
  if (resolved) {
    shim.peon_register_asset(cstr(name), cstr(resolved.filePath));
    console.log(`  registered ${name} → ${resolved.filePath.replace(PROJECT_ROOT + "/", "")}`);
  } else {
    console.warn(`  ! no file for ${name}`);
  }
}

const panel = shim.peon_make_webview_panel(MARGIN, MARGIN, SIZE, SIZE);
if (!panel) {
  console.error("✗ peon_make_webview_panel returned null");
  process.exit(1);
}
console.log(`✓ WKWebView panel created (${SIZE}×${SIZE}) at bottom-left`);
console.log(`✓ work height: ${shim.peon_primary_work_height()}px`);

if (process.argv.includes("--check")) {
  console.log("✓ FFI + WKWebView plumbing OK (--check: skipping load + run loop)");
  process.exit(0);
}

shim.peon_panel_load(panel, cstr("peon-asset://app/renderer/index.html"));
shim.peon_panel_show(panel);
console.log("✓ loaded renderer/index.html — the orc should be sleeping bottom-left.");
console.log("  Ctrl-C to quit.");
shim.peon_run();
