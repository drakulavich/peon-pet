// Corner placement math for the pet window.
// Ported verbatim from lib/window-position.js (logic unchanged).

export const WIN_SIZE = 200;
export const WIN_MARGIN = 20;

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface Point {
  x: number;
  y: number;
}

/**
 * Position the window in the requested screen corner, in a top-left-origin
 * coordinate space. Unknown / undefined corners default to bottom-left.
 */
export function cornerPosition(
  corner: Corner | string | undefined,
  width: number,
  height: number,
): Point {
  const right = width - WIN_SIZE - WIN_MARGIN;
  const bottom = height - WIN_SIZE - WIN_MARGIN;
  switch (corner) {
    case "top-left":
      return { x: WIN_MARGIN, y: WIN_MARGIN };
    case "top-right":
      return { x: right, y: WIN_MARGIN };
    case "bottom-right":
      return { x: right, y: bottom };
    default:
      return { x: WIN_MARGIN, y: bottom }; // bottom-left
  }
}
