# Resource usage — before vs after (task 8.9, "Dana's scenario")

Measured on the same machine (macOS, Darwin 25, arm64), idle/sleeping orc, ~7s
after launch. "Before" = the pre-migration Electron build run from a git worktree
at commit `18718e7`; "after" = `bun run src/main.ts` on this branch.

## Headline

| Metric | Electron (before) | Bun + AppKit (after) | Δ |
| --- | --- | --- | --- |
| Runtime memory (Σ RSS) | **713.7 MB** / 6 procs | **439.7 MB** / 4 procs | **−38%** |
| Processes | 6 (main, GPU, network, 3× renderer) | 4 (bun + 3× WebKit XPC) | −2 |
| Per-app disk | **276 MB** bundled Chromium+Node | **76 KB** native shim | **−99.97%** |

## Detail

**Electron RSS** (our `node_modules/electron`, 6 processes): main 199.8 + gpu 121.5
+ network 41.2 + renderers 115.2/126.3/121.5 = **713.7 MB**.

**Bun RSS**: bun process 236.4 (includes the AppKit/WebKit frameworks dlopen'd for
FFI) + 3 newly-spawned system WebKit XPC helpers (95.0 + 94.7 + 13.6 = 203.3) =
**439.7 MB**.

**Disk**: Electron ships a full Chromium+Node runtime **per app** (276 MB). The Bun
build adds only the 76 KB `libpeonshell.dylib`; it reuses the OS's system WebKit
(0 added) and a single globally-installed Bun runtime (~60 MB shared across all Bun
projects, like having `node` installed once).

## Caveats (honest accounting)

- **RSS overcounts shared pages.** Both numbers include shared framework memory, so
  both are inflated; the comparison is directional, not exact.
- **Not yet at full window parity.** The Electron run had **3 renderer** processes
  (multiple windows); the Bun build currently runs the **main window only**
  (sub-agent mini-windows are Phase 6b), so part of the memory gap reflects fewer
  windows, not pure per-window overhead. Even normalized per window, system WebKit
  is lighter than a bundled Chromium renderer, and the **disk** win is unaffected
  by this and unambiguous.
- **WebKit helpers are system-shared.** Attributed only the 3 helpers that appeared
  after launch (snapshot diff), but the OS may share them more broadly.

## Takeaway

Dropping Electron removes a ~276 MB bundled browser per install and cuts idle
memory by roughly a third even before sub-agent windows are re-added. The disk and
process-count wins are unambiguous; the memory win is real but should be re-measured
at full window parity.
