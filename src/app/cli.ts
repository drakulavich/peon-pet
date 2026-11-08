// CLI argument parsing + validation for the entrypoint. Pure (argv is passed in)
// so it's unit-testable without touching process.argv.

import type { Corner } from "./window-position.ts";

/** First value after a flag, e.g. `argValue(argv, "--character")`. A following
 *  token that itself looks like a flag (`--…`) is treated as "no value". */
export function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

// A character name becomes a path segment (`characters/<name>/`), so restrict it
// to a safe slug — rejecting `..`, `/`, `\`, and leading dashes — so a bad value
// can't escape the characters directory. Defense in depth: it's a local,
// self-passed flag today, but this keeps it safe if it ever becomes external.
const SAFE_CHARACTER = /^[a-z0-9][a-z0-9-]*$/i;
export function safeCharacter(name: string | undefined): string | undefined {
  return name && SAFE_CHARACTER.test(name) ? name : undefined;
}

const CORNERS = new Set<Corner>(["top-left", "top-right", "bottom-left", "bottom-right"]);
export function safeCorner(c: string | undefined): Corner | undefined {
  return c && CORNERS.has(c as Corner) ? (c as Corner) : undefined;
}
