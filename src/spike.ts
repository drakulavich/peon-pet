// Phase 4 FFI spike — proves bun:ffi → AppKit can put a transparent,
// click-through, always-on-top panel in the bottom-left corner.
//
//   bun run build:native       # compile native/libpeonshell.dylib
//   bun run src/spike.ts        # open the window (blocks in the AppKit run loop)
//   bun run src/spike.ts --check  # headless: bind FFI + create panel, no run loop
//
// On macOS you should see a translucent orange square bottom-left that floats
// over other windows and passes clicks through to whatever is beneath it.

import { dlopen, FFIType } from "bun:ffi";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DYLIB = join(import.meta.dir, "..", "native", "libpeonshell.dylib");

if (!existsSync(DYLIB)) {
  console.error(`Native shim not found: ${DYLIB}\nBuild it first:  bun run build:native`);
  process.exit(1);
}

const { symbols: shim } = dlopen(DYLIB, {
  peon_init: { args: [], returns: FFIType.void },
  peon_make_panel: {
    args: [FFIType.f64, FFIType.f64, FFIType.f64, FFIType.f64],
    returns: FFIType.ptr,
  },
  peon_panel_show: { args: [FFIType.ptr], returns: FFIType.void },
  peon_panel_set_ignore_mouse: { args: [FFIType.ptr, FFIType.bool], returns: FFIType.void },
  peon_panel_set_origin: { args: [FFIType.ptr, FFIType.f64, FFIType.f64], returns: FFIType.void },
  peon_work_height: { args: [], returns: FFIType.f64 },
  peon_run: { args: [], returns: FFIType.void },
});

const SIZE = 200;
const MARGIN = 20;

shim.peon_init();
console.log("✓ peon_init: NSApplication ready");

// Bottom-left corner: AppKit origin is bottom-left, so x=margin, y=margin.
const panel = shim.peon_make_panel(MARGIN, MARGIN, SIZE, SIZE);
if (!panel) {
  console.error("✗ peon_make_panel returned null");
  process.exit(1);
}
console.log(`✓ peon_make_panel: NSPanel created at (${MARGIN}, ${MARGIN}) ${SIZE}×${SIZE}`);
console.log(`✓ peon_work_height (primary): ${shim.peon_work_height()}px`);

if (process.argv.includes("--check")) {
  // Headless plumbing check — prove FFI binds and the panel is created without
  // entering the (blocking, GUI) run loop. Used in CI / non-interactive shells.
  console.log("✓ FFI plumbing OK (--check: skipping run loop)");
  process.exit(0);
}

shim.peon_panel_show(panel);
console.log("✓ peon_panel_show: window ordered front. Look bottom-left.");
console.log("  Ctrl-C to quit.");
shim.peon_run(); // blocks
