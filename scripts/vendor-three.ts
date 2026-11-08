// Copy three.js's build files into the package so the published tarball is
// self-contained (npm strips node_modules + hoists `three` elsewhere). The
// renderer requests `node_modules/three/build/*`; the asset layer redirects
// those to renderer/vendor/three/build/* when present. Run at `prepack`.

import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const src = join(ROOT, "node_modules", "three", "build");
const dst = join(ROOT, "renderer", "vendor", "three", "build");
// three.module.js imports three.core.js from the same dir — both are required.
const files = ["three.module.js", "three.core.js"];

mkdirSync(dst, { recursive: true });
for (const f of files) {
  const s = join(src, f);
  if (!existsSync(s)) {
    console.error(`vendor-three: missing ${s} — run \`bun install\` first.`);
    process.exit(1);
  }
  copyFileSync(s, join(dst, f));
  console.log(`vendored ${f}`);
}
