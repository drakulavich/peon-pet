// Per-character asset maps: canonical asset name → bundled filename.
// Ported verbatim from main.js BUNDLED_CHARS.

export type CharacterAssetMap = Record<string, string>;

export const BUNDLED_CHARS: Record<string, CharacterAssetMap> = {
  orc: {
    "sprite-atlas.png": "orc-sprite-atlas.png",
    "borders.png": "orc-borders.png",
    "bg.png": "bg-pixel.png",
    "dock-icon.png": "orc-dock-icon.png",
  },
  capybara: {
    "sprite-atlas.png": "capybara-sprite-atlas.png",
    "borders.png": "capybara-borders.png",
    "dock-icon.png": "capybara-dock-icon.png",
  },
  "hello-kitty": {
    "sprite-atlas.png": "hello-kitty-sprite-atlas.png",
    "borders.png": "hello-kitty-borders.png",
    "dock-icon.png": "hello-kitty-dock-icon.png",
  },
};

export const DEFAULT_CHARACTER = "orc";

/** Bundled filename for a character's asset, with orc fallback then identity. */
export function bundledFilename(character: string, assetName: string): string {
  const charMap = BUNDLED_CHARS[character] || {};
  return charMap[assetName] || BUNDLED_CHARS.orc[assetName] || assetName;
}
