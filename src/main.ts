// peon-pet entrypoint (Bun + AppKit). Composition root: wires the AppKit shell,
// the asset resolver, the JSONL watcher, and the session tracker so the orc
// reacts to Claude Code events. Port of main.js's orchestration (main window;
// sub-agent windows / dock menu / remote relay land in later phases).
//
//   bun run build:native && bun run src/main.ts

import { join, basename } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { AppKitShell } from "./shell/appkit.ts";
import { resolveAsset } from "./app/asset-resolver.ts";
import { DEFAULT_CHARACTER } from "./app/characters.ts";
import { cornerPosition, WIN_SIZE, type Corner } from "./app/window-position.ts";
import {
  createSessionTracker,
  buildSessionStates,
  isValidSessionId,
  EVENT_TO_ANIM,
} from "./app/session-tracker.ts";
import { JsonlWatcher, type SessionEvent } from "./app/jsonl-watcher.ts";
import { WindowInteraction } from "./app/window-interaction.ts";

const PROJECT_ROOT = join(import.meta.dir, "..");
const ASSETS_DIR = join(PROJECT_ROOT, "renderer", "assets");
const ASSET_NAMES = ["bg.png", "sprite-atlas.png", "borders.png", "dock-icon.png"];
const DEV = process.argv.includes("--dev");

const HOT_MS = 30 * 1000; // actively working
const WARM_MS = 2 * 60 * 1000; // open but idle
const PRUNE_MS = 10 * 60 * 1000; // drop cold sessions
const MAX_DOTS = 10;

interface PetConfig {
  character?: string;
  corner?: Corner;
}

function loadConfig(): PetConfig {
  const p = join(homedir(), "Library", "Application Support", "peon-pet", "peon-pet-config.json");
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

const cfg = loadConfig();
const character = cfg.character || DEFAULT_CHARACTER;

// Resolve the character assets in TS, then hand absolute paths to the shell.
const assetCtx = {
  character,
  projectRoot: PROJECT_ROOT,
  assetsDir: ASSETS_DIR,
  userCharDir: null,
  fileExists: existsSync,
};
const assets = ASSET_NAMES.flatMap((name) => {
  const r = resolveAsset(`peon-asset://${name}`, assetCtx);
  return r ? [{ name, filePath: r.filePath }] : [];
});

const shell = new AppKitShell({ projectRoot: PROJECT_ROOT, assets, verbose: DEV });

const { width, height } = shell.getPrimaryWorkArea();
const { x, y } = cornerPosition(cfg.corner, width, height);
const win = shell.createWindow({ width: WIN_SIZE, height: WIN_SIZE, x, y });
win.loadURL("peon-asset://app/renderer/index.html");
win.show();

// Hover → click-through toggling (drag wiring lands with the message bridge).
const interaction = new WindowInteraction(shell, win, { draggable: true });
const pumpHandle = shell.startPumping(16);
const hoverHandle = setInterval(() => interaction.tick(), 50);

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

// Heartbeat: keep sessions with pending tools hot so the orc stays awake.
const heartbeat = setInterval(() => {
  const now = Date.now();
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
  win.destroy();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`peon-pet running (character: ${character}). Ctrl-C to quit.`);
