// peon-pet entrypoint (Bun + AppKit). Composition root: wires the AppKit shell,
// the asset resolver, the JSONL watcher, and the session tracker so the orc
// reacts to Claude Code events. Port of main.js's orchestration.
//
//   bun run build:native && bun run src/main.ts [--character <name>] [--corner <c>]

import { join, basename } from "node:path";
import { existsSync } from "node:fs";
import { AppKitShell } from "./shell/appkit.ts";
import { resolveAsset } from "./app/asset-resolver.ts";
import { DEFAULT_CHARACTER } from "./app/characters.ts";
import { cornerPosition, WIN_SIZE } from "./app/window-position.ts";
import { configDir, loadConfig } from "./app/config.ts";
import { argValue, safeCharacter, safeCorner } from "./app/cli.ts";
import {
  createSessionTracker,
  buildSessionStates,
  isValidSessionId,
  EVENT_TO_ANIM,
} from "./app/session-tracker.ts";
import { JsonlWatcher, type SessionEvent } from "./app/jsonl-watcher.ts";
import { WindowInteraction } from "./app/window-interaction.ts";
import { SubAgentManager, SUB_AGENT_SIZE } from "./app/sub-agent-manager.ts";
import { acquireSingleInstance } from "./app/single-instance.ts";
import type { WindowHandle } from "./shell/types.ts";

// Single-instance guard: bail if another peon-pet is already running.
if (!(await acquireSingleInstance())) {
  console.log("peon-pet is already running.");
  process.exit(0);
}

const PROJECT_ROOT = join(import.meta.dir, "..");
const ASSETS_DIR = join(PROJECT_ROOT, "renderer", "assets");
const ASSET_NAMES = ["bg.png", "sprite-atlas.png", "borders.png", "dock-icon.png"];
const DEV = process.argv.includes("--dev");

const HOT_MS = 30 * 1000; // actively working
const WARM_MS = 2 * 60 * 1000; // open but idle
const PRUNE_MS = 10 * 60 * 1000; // drop cold sessions
const MAX_DOTS = 10;

const cfg = loadConfig();
// Precedence: CLI flag > config file > default (each validated in cli.ts).
const character =
  safeCharacter(argValue(process.argv, "--character")) || safeCharacter(cfg.character) || DEFAULT_CHARACTER;
const corner = safeCorner(argValue(process.argv, "--corner")) || safeCorner(cfg.corner);
const userCharDir = join(configDir(), "characters", character);

// Published packages vendor three.js here (npm hoists the real `three` elsewhere);
// a git clone has no vendor dir, so three resolves from node_modules as usual.
const VENDORED_THREE = join(PROJECT_ROOT, "renderer", "vendor", "three", "build");
const threeBuildDir = existsSync(VENDORED_THREE) ? VENDORED_THREE : null;

// Resolve the character assets in TS, then hand absolute paths to the shell.
// User-installed files under userCharDir take precedence over bundled ones.
const assetCtx = {
  character,
  projectRoot: PROJECT_ROOT,
  assetsDir: ASSETS_DIR,
  userCharDir,
  threeBuildDir,
  fileExists: existsSync,
};
const assets = ASSET_NAMES.flatMap((name) => {
  const r = resolveAsset(`peon-asset://${name}`, assetCtx);
  return r ? [{ name, filePath: r.filePath }] : [];
});

const RENDERER_URL = "peon-asset://app/renderer/index.html";
const shell = new AppKitShell({ projectRoot: PROJECT_ROOT, assets, threeBuildDir, verbose: DEV });

const { width, height } = shell.getPrimaryWorkArea();
const { x, y } = cornerPosition(corner, width, height);
const win = shell.createWindow({ width: WIN_SIZE, height: WIN_SIZE, x, y });
win.loadURL(RENDERER_URL);
win.show();

const pumpHandle = shell.startPumping(16);

// Per-window hover→click-through (+ drag for the main window). Pruned as windows die.
// Also keeps the sub-agent stack glued above the pet while it is dragged.
const interactions: { it: WindowInteraction; win: WindowHandle }[] = [];
interactions.push({ it: new WindowInteraction(shell, win, { draggable: true }), win });
let lastPetPos = win.getPosition();
const hoverHandle = setInterval(() => {
  for (let i = interactions.length - 1; i >= 0; i--) {
    if (interactions[i].win.isDestroyed()) interactions.splice(i, 1);
    else interactions[i].it.tick();
  }
  const petPos = win.getPosition();
  if (petPos.x !== lastPetPos.x || petPos.y !== lastPetPos.y) {
    lastPetPos = petPos;
    subAgents.reposition();
  }
}, 50);

// ── Sub-agent mini-windows ────────────────────────────────────────────────────
let petVisible = true;
const subAgents = new SubAgentManager(shell, {
  anchor: () => win.getPosition(),
  onWindowCreated: (subWin) => {
    subWin.loadURL(RENDERER_URL);
    if (petVisible) subWin.show();
    else subWin.hide();
    interactions.push({ it: new WindowInteraction(shell, subWin, { draggable: false }), win: subWin });
    // Configure as a 100px sub-agent once the page has loaded.
    setTimeout(() => {
      if (subWin.isDestroyed()) return;
      subWin.evaluateJS(
        `window.__peonEmit('peon-config', ${JSON.stringify({ size: SUB_AGENT_SIZE, subAgent: true })})`,
      );
      subWin.evaluateJS(
        `window.__peonEmit('peon-event', ${JSON.stringify({ anim: "waking", event: "SessionStart" })})`,
      );
    }, 500);
  },
});

// ── Dock icon + Hide/Show/Quit menu ───────────────────────────────────────────
const dockIcon = assets.find((a) => a.name === "dock-icon.png");
if (dockIcon) shell.setDockIcon(dockIcon.filePath);

function buildDockMenu(): void {
  shell.setDockMenu([
    { id: "toggle", label: petVisible ? "Hide Pet" : "Show Pet" },
    { separator: true },
    { id: "quit", label: "Quit" },
  ]);
}
buildDockMenu();
shell.onDockMenuClick((id) => {
  if (id === "quit") return shutdown();
  if (id === "toggle") {
    petVisible = !petVisible;
    for (const w of [win, ...subAgents.liveWindows()]) petVisible ? w.show() : w.hide();
    buildDockMenu();
  }
});

// ── Native → renderer ─────────────────────────────────────────────────────────
function emit(channel: string, data: unknown): void {
  win.evaluateJS(`window.__peonEmit(${JSON.stringify(channel)}, ${JSON.stringify(data)})`);
}

// ── Session tracking (port of main.js) ────────────────────────────────────────
const tracker = createSessionTracker();
const sessionCwds = new Map<string, string>();

function sendSessionUpdate(now: number): void {
  const sessions = buildSessionStates(tracker.entries(), now, HOT_MS, WARM_MS, MAX_DOTS).map((s) => {
    const cwd = sessionCwds.get(s.id) || null;
    return { ...s, cwd, name: cwd ? basename(cwd) : null };
  });
  emit("session-update", { sessions });
}

function handleSessionEvent({ sessionId, event, cwd, timestamp }: SessionEvent): void {
  if (!isValidSessionId(sessionId)) return;
  const now = Date.now();

  if (event === "SessionCwd") {
    if (cwd) {
      sessionCwds.set(sessionId, cwd);
      sendSessionUpdate(now);
    }
    return;
  }

  if (event === "SessionSeen") {
    // File existed at startup: register with the file's mtime, no animation.
    tracker.update(sessionId, timestamp || now);
    if (cwd) sessionCwds.set(sessionId, cwd);
  } else {
    if (event === "SessionStart") {
      // Deduplicate /resume: replace a lone session seen <5s ago.
      const existing = tracker.entries();
      const isNew = !existing.some(([id]) => id === sessionId);
      if (isNew && existing.length === 1) {
        const [oldId, oldTime] = existing[0];
        if (now - oldTime < 5000) tracker.remove(oldId);
      }
    }
    tracker.update(sessionId, now);
    if (cwd) sessionCwds.set(sessionId, cwd);
  }

  tracker.prune(now - PRUNE_MS);
  for (const id of sessionCwds.keys()) {
    if (!tracker.entries().some(([sid]) => sid === id)) sessionCwds.delete(id);
  }

  sendSessionUpdate(now);

  const anim = EVENT_TO_ANIM[event];
  if (anim) {
    emit("peon-event", { anim, event });
    if (DEV) console.log(`→ orc: ${anim} (${event}) — ${tracker.entries().length} session(s)`);
  }
}

const watcher = new JsonlWatcher();
watcher.on("session-event", handleSessionEvent);
watcher.on("subagent-event", ({ parentToolId, event }: { parentToolId: string; event: string }) => {
  if (event === "SubagentStart") subAgents.create(parentToolId);
  else if (event === "SubagentStop") subAgents.destroy(parentToolId);
});

// Heartbeat: keep sessions with pending tools hot, and sweep stale sub-agents.
const heartbeat = setInterval(() => {
  const now = Date.now();
  subAgents.sweepExpired();
  if (tracker.entries().length === 0) return;
  for (const id of watcher.getActiveSessionIds()) tracker.update(id, now);
  sendSessionUpdate(now);
}, 5000);

// Start watching once the renderer has had a moment to define window.__peonEmit.
setTimeout(() => watcher.start(), 800);

// Graceful shutdown.
function shutdown(): void {
  clearInterval(pumpHandle);
  clearInterval(hoverHandle);
  clearInterval(heartbeat);
  watcher.stop();
  subAgents.destroyAll();
  win.destroy();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`peon-pet running (character: ${character}). Ctrl-C to quit.`);
