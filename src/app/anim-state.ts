// Sprite-atlas animation config + UV math.
// Ported verbatim from lib/anim-state.js (logic unchanged).

export const ATLAS_COLS = 6;
export const ATLAS_ROWS = 6;

export interface AnimConfig {
  row: number;
  frames: number;
  fps: number;
  loop: boolean;
}

export const ANIM_CONFIG: Record<string, AnimConfig> = {
  sleeping: { row: 0, frames: 6, fps: 3, loop: true },
  waking: { row: 1, frames: 6, fps: 8, loop: false },
  typing: { row: 2, frames: 6, fps: 8, loop: false },
  alarmed: { row: 3, frames: 6, fps: 8, loop: false },
  celebrate: { row: 4, frames: 6, fps: 8, loop: false },
  annoyed: { row: 5, frames: 6, fps: 8, loop: false },
};

export interface UV {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * Compute UV coordinates for a given animation frame.
 * Matches the Three.js convention: v=0 is bottom, v=1 is top.
 *
 * Returns { u0, u1, v0, v1 } where:
 *   TL = (u0, v1), TR = (u1, v1), BL = (u0, v0), BR = (u1, v0)
 */
export function computeUVs(animName: string, frame: number): UV {
  const { row } = ANIM_CONFIG[animName];
  const u0 = frame / ATLAS_COLS;
  const u1 = (frame + 1) / ATLAS_COLS;
  const v0 = (ATLAS_ROWS - 1 - row) / ATLAS_ROWS; // bottom of this row
  const v1 = (ATLAS_ROWS - row) / ATLAS_ROWS; // top of this row
  return { u0, u1, v0, v1 };
}
