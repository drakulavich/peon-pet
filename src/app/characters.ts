// Per-character asset maps: canonical asset name → bundled filename.
// Only orc is bundled; other skins come from the user's character directory
// (see asset-resolver) and fall back to orc per-asset when absent.

export type CharacterAssetMap = Record<string, string>;

export const BUNDLED_CHARS: Record<string, CharacterAssetMap> = {
  orc: {
    "sprite-atlas.png": "orc-sprite-atlas.png",
    "borders.png": "orc-borders.png",
    "bg.png": "bg-pixel.png",
    "dock-icon.png": "orc-dock-icon.png",
  },
};

export const DEFAULT_CHARACTER = "orc";

/** Bundled filename for a character's asset, with orc fallback then identity. */
export function bundledFilename(character: string, assetName: string): string {
  const charMap = BUNDLED_CHARS[character] || {};
  return charMap[assetName] || BUNDLED_CHARS.orc[assetName] || assetName;
}
