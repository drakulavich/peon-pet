# Intel Support + Build/Publish Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@drakulavich/peon-pet` installable and runnable on Intel macOS by shipping a universal2 native shim, and add GitHub Actions CI + provenance npm-publish pipelines modeled on kesha-voice-kit.

**Architecture:** The arm64 lock is declarative, not technical — no app code is arch-specific. We change one clang invocation to emit a universal2 (`arm64` + `x86_64`) dylib, widen the `cpu` guard, update docs, then add two workflows: `ci.yml` (test + universal-build assertion on Apple Silicon and Intel runners) and `npm-publish.yml` (release-gated publish on a macOS runner, because `prepack` compiles the dylib with macOS-only frameworks).

**Tech Stack:** Bun, clang (universal2 cross-compile from the macOS SDK), GitHub Actions, npm provenance (OIDC).

**Reference design:** `docs/superpowers/specs/2026-06-11-intel-support-and-publish-pipeline-design.md`

---

## File Structure

- `package.json` — `build:native` clang flags + `cpu` array. (modify)
- `CLAUDE.md` — platform line. (modify)
- `README.md` — requirements + native-shim wording. (modify)
- `bin/peon-pet` — comments only (no logic change). (modify)
- `.github/workflows/ci.yml` — push/PR verification on macOS arm64 + Intel. (create)
- `.github/workflows/npm-publish.yml` — release-gated provenance publish on macOS. (create)

No source (`src/**`, `native/**`) logic changes — the FFI layer is already arch-agnostic.

---

## Task 1: Universal2 native build

**Files:**
- Modify: `package.json` (`scripts.build:native`)

- [ ] **Step 1: Edit the `build:native` script to emit a universal2 dylib**

In `package.json`, change the `build:native` script. Current:

```json
    "build:native": "clang -framework Cocoa -framework WebKit -dynamiclib -fobjc-arc -o native/libpeonshell.dylib native/peonshell.m",
```

New (adds `-arch arm64 -arch x86_64`):

```json
    "build:native": "clang -arch arm64 -arch x86_64 -framework Cocoa -framework WebKit -dynamiclib -fobjc-arc -o native/libpeonshell.dylib native/peonshell.m",
```

- [ ] **Step 2: Rebuild and verify both slices are present**

Run:

```bash
bun run build:native && file native/libpeonshell.dylib
```

Expected output contains a fat/universal header listing BOTH architectures, e.g.:

```
native/libpeonshell.dylib: Mach-O universal binary with 2 architectures: [x86_64 ...] [arm64 ...]
```

(If it still reports a single `arm64` slice, the flags didn't take — recheck Step 1.)

- [ ] **Step 3: Verify the app still launches on this (Apple Silicon) machine**

Run:

```bash
bun run start
```

Expected: the orc pet window appears (the universal dylib loads its arm64 slice natively). Stop it with Ctrl-C after confirming.

- [ ] **Step 4: Confirm the headless suite still passes**

Run:

```bash
bun test
```

Expected: all tests pass (the suite uses `FakeShell`, so this is unaffected, but it confirms nothing regressed).

- [ ] **Step 5: Commit**

```bash
git add package.json native/libpeonshell.dylib
git commit -m "build(native): compile libpeonshell.dylib as universal2 (arm64 + x86_64)"
```

---

## Task 2: Widen the CPU guard

**Files:**
- Modify: `package.json` (`cpu`)

- [ ] **Step 1: Add `x64` to the `cpu` array**

In `package.json`, current:

```json
  "cpu": [
    "arm64"
  ],
```

New:

```json
  "cpu": [
    "arm64",
    "x64"
  ],
```

- [ ] **Step 2: Verify package.json is still valid JSON**

Run:

```bash
bun -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('valid')"
```

Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(pkg): allow install on Intel macOS (cpu: arm64 + x64)"
```

---

## Task 3: Update documentation and launcher comments

**Files:**
- Modify: `CLAUDE.md:10`
- Modify: `README.md:24-25`
- Modify: `bin/peon-pet:2-3`, `bin/peon-pet:11-12`

- [ ] **Step 1: Update `CLAUDE.md` platform line**

`CLAUDE.md` line 10, current:

```
**Apple Silicon macOS only** (`darwin`/`arm64`); Linux/Windows are explicit non-goals.
```

New:

```
**Apple Silicon and Intel macOS** (`darwin`/`arm64`+`x64`); Linux/Windows are explicit non-goals.
```

- [ ] **Step 2: Update `README.md` requirements + shim wording**

`README.md` line 24, current:

```
Requires **Apple Silicon macOS**, **[Bun](https://bun.sh)**, and **peon-ping** running.
```

New:

```
Requires **macOS (Apple Silicon or Intel)**, **[Bun](https://bun.sh)**, and **peon-ping** running.
```

`README.md` line 25, current:

```
A prebuilt native shim ships in the package — no Xcode needed. Pass `--character <name>`
```

New:

```
A prebuilt universal (arm64 + x86_64) native shim ships in the package — no Xcode needed. Pass `--character <name>`
```

- [ ] **Step 3: Update `bin/peon-pet` comments**

`bin/peon-pet` lines 2-3, current:

```js
// peon-pet launcher. Runs the Bun + AppKit entrypoint. Requires Bun on macOS
// (Apple Silicon); the prebuilt arm64 native shim ships in the package.
```

New:

```js
// peon-pet launcher. Runs the Bun + AppKit entrypoint. Requires Bun on macOS
// (Apple Silicon or Intel); the prebuilt universal native shim ships in the package.
```

`bin/peon-pet` lines 11-12, current:

```js
// The package ships a prebuilt arm64 dylib. If it's missing (deleted, or a forced
// non-arm64 install), try to compile it — needs Apple's clang (Xcode CLT).
```

New:

```js
// The package ships a prebuilt universal (arm64 + x86_64) dylib. If it's missing
// (deleted, or a source-only install), try to compile it — needs Apple's clang (Xcode CLT).
```

- [ ] **Step 4: Verify the launcher still parses**

Run:

```bash
bun build bin/peon-pet --target=bun > /dev/null && echo "parses ok"
```

Expected: `parses ok` (comment-only edits must not break the file).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md bin/peon-pet
git commit -m "docs: note Intel macOS support and universal native shim"
```

---

## Task 4: CI workflow (`ci.yml`)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the CI workflow**

Create `.github/workflows/ci.yml` with exactly this content:

```yaml
name: "✅ CI"

on:
  push:
    branches: ["**"]
  pull_request:

jobs:
  test:
    name: test (${{ matrix.runner }})
    runs-on: ${{ matrix.runner }}
    strategy:
      fail-fast: false
      matrix:
        # macos-14 = Apple Silicon (arm64); macos-13 = Intel (x86_64).
        runner: [macos-14, macos-13]
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.13"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run headless test suite
        run: bun test

      - name: Build native shim
        run: bun run build:native

      # The dylib must be a universal2 binary carrying BOTH slices, regardless of
      # which runner architecture compiled it. `file` prints one combined line for
      # a fat binary; assert both arch tokens appear.
      - name: Assert universal2 dylib (arm64 + x86_64)
        run: |
          info=$(file native/libpeonshell.dylib)
          echo "$info"
          echo "$info" | grep -q "arm64"  || { echo "::error::dylib missing arm64 slice"  >&2; exit 1; }
          echo "$info" | grep -q "x86_64" || { echo "::error::dylib missing x86_64 slice" >&2; exit 1; }
          echo "universal2 OK"
```

- [ ] **Step 2: Confirm `bun install --frozen-lockfile` works locally (lockfile present)**

Run:

```bash
ls bun.lock bun.lockb 2>/dev/null; bun install --frozen-lockfile && echo "frozen install ok"
```

Expected: `frozen install ok`. If it errors that no lockfile exists, run `bun install` once, then `git add bun.lock* && git commit -m "chore: add bun lockfile"` BEFORE relying on `--frozen-lockfile` in CI (the workflow needs a committed lockfile).

- [ ] **Step 3: Validate the workflow YAML syntax**

Run:

```bash
bun -e "const s=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!s.includes('macos-13')||!s.includes('macos-14')) throw new Error('missing runner'); console.log('ci.yml looks structurally ok')"
```

Expected: `ci.yml looks structurally ok`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: test + universal-build assertion on Apple Silicon and Intel runners"
```

---

## Task 5: npm publish workflow (`npm-publish.yml`)

**Files:**
- Create: `.github/workflows/npm-publish.yml`

- [ ] **Step 1: Create the publish workflow**

Create `.github/workflows/npm-publish.yml` with exactly this content. It mirrors
kesha-voice-kit's skeleton (safe tag resolution via `env:`, version-matches-tag
guard, idempotent `npm view` check, beta/latest dist-tag split, provenance) but
runs on `macos-14` because `prepack` compiles the dylib with macOS-only frameworks.

```yaml
name: "📦 npm Publish"

# Fires once a GitHub release leaves draft (the manual gate). Stable releases
# publish to npm's `latest` dist-tag; SemVer prereleases (vX.Y.Z-beta.N) publish
# to `beta` so `bunx @drakulavich/peon-pet@latest` users do not get unstable builds.
#
# Runs on macOS (not ubuntu like kesha-voice-kit) because `npm publish` triggers
# this package's `prepack`, which compiles native/libpeonshell.dylib via clang with
# `-framework Cocoa -framework WebKit` — macOS-only. macos-14 (Apple Silicon) can
# cross-compile the x86_64 slice from the SDK, producing the universal2 tarball.
on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      tag:
        description: "Tag to publish (must already exist and have a published GitHub release)"
        required: true

# id-token: write unlocks npm provenance attestation via GitHub's OIDC provider.
permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: macos-14
    steps:
      # Resolve tag through env vars, never direct ${{ }} interpolation in run:,
      # to avoid shell injection from a crafted tag while id-token: write is held.
      - name: Resolve tag
        id: tag
        env:
          EVENT_NAME: ${{ github.event_name }}
          INPUT_TAG: ${{ inputs.tag }}
          RELEASE_TAG: ${{ github.event.release.tag_name }}
        run: |
          if [ "$EVENT_NAME" = "workflow_dispatch" ]; then
            echo "tag=$INPUT_TAG" >> "$GITHUB_OUTPUT"
          else
            echo "tag=$RELEASE_TAG" >> "$GITHUB_OUTPUT"
          fi

      - name: Checkout at tag
        uses: actions/checkout@v6
        with:
          ref: ${{ steps.tag.outputs.tag }}

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.13"

      # npm provenance requires npm >= 9.5; Node 22 ships npm 10.x. registry-url
      # configures the auth line that NODE_AUTH_TOKEN consumes during npm publish.
      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: "22"
          registry-url: "https://registry.npmjs.org"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      # Refuse to publish if package.json#version does not match the release tag.
      - name: Verify package.json version matches tag
        env:
          TAG: ${{ steps.tag.outputs.tag }}
        run: |
          expected="${TAG#v}"
          actual=$(node -p "require('./package.json').version")
          if [ "$expected" != "$actual" ]; then
            echo "::error::Tag $TAG implies version $expected but package.json says $actual" >&2
            exit 1
          fi
          echo "package.json version $actual matches tag $TAG — OK"

      # Idempotent guard: skip publish (no-op) if this version is already on npm.
      - name: Check npm registry for prior publish
        id: registry
        run: |
          name=$(node -p "require('./package.json').name")
          version=$(node -p "require('./package.json').version")
          if npm view "$name@$version" version >/dev/null 2>&1; then
            echo "already_published=true" >> "$GITHUB_OUTPUT"
            echo "$name@$version already on npm — publish step will be skipped."
          else
            echo "already_published=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Resolve npm dist-tag
        id: dist_tag
        run: |
          version=$(node -p "require('./package.json').version")
          if [[ "$version" == *-* ]]; then
            echo "tag=beta" >> "$GITHUB_OUTPUT"
            echo "$version is a prerelease — dist-tag beta."
          else
            echo "tag=latest" >> "$GITHUB_OUTPUT"
            echo "$version is stable — dist-tag latest."
          fi

      # npm publish runs prepack (build:native + vendor:three), producing the
      # universal2 dylib and vendored three.js inside the published tarball.
      - name: Publish to npm with provenance
        if: steps.registry.outputs.already_published == 'false'
        run: npm publish --provenance --access public --tag "$NPM_DIST_TAG"
        env:
          NPM_DIST_TAG: ${{ steps.dist_tag.outputs.tag }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Sanity-check the version-match logic against the current package**

This mirrors what the workflow does for a `v0.1.0` tag. Run:

```bash
TAG="v0.1.0"; expected="${TAG#v}"; actual=$(node -p "require('./package.json').version"); [ "$expected" = "$actual" ] && echo "match: $actual" || echo "MISMATCH expected=$expected actual=$actual"
```

Expected: `match: 0.1.0`

- [ ] **Step 3: Validate the workflow references the publish gate correctly**

Run:

```bash
bun -e "const s=require('fs').readFileSync('.github/workflows/npm-publish.yml','utf8'); for (const k of ['runs-on: macos-14','id-token: write','--provenance','NPM_TOKEN','prepack']) if(!s.includes(k)) throw new Error('missing: '+k); console.log('npm-publish.yml looks structurally ok')"
```

Expected: `npm-publish.yml looks structurally ok`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/npm-publish.yml
git commit -m "ci: release-gated npm publish with provenance on macOS runner"
```

---

## Task 6: Manual setup note + final verification

**Files:**
- None (operational checklist)

- [ ] **Step 1: Document the out-of-band `NPM_TOKEN` requirement**

The publish workflow needs a repo secret that cannot be created from the workflow.
Surface this to the user (do NOT attempt to set it programmatically):

> Add an npm **automation** access token with publish rights to
> `@drakulavich/peon-pet` as repo secret `NPM_TOKEN`
> (GitHub → repo Settings → Secrets and variables → Actions → New repository secret).
> Without it, the publish step fails at `npm publish`.

- [ ] **Step 2: Full local verification pass**

Run all three in sequence:

```bash
bun run build:native && file native/libpeonshell.dylib | grep -q x86_64 && echo "STEP1 universal ok"
bun test 2>&1 | tail -1
bun -e "const p=require('./package.json'); if(!p.cpu.includes('x64')) throw new Error('cpu not widened'); console.log('STEP3 cpu ok')"
```

Expected: `STEP1 universal ok`, a passing test summary line, and `STEP3 cpu ok`.

- [ ] **Step 3: Confirm the two workflows are present and committed**

Run:

```bash
git ls-files .github/workflows
```

Expected:

```
.github/workflows/ci.yml
.github/workflows/npm-publish.yml
```

- [ ] **Step 4: Push the branch and confirm CI triggers**

Run:

```bash
git push -u origin "$(git branch --show-current)"
```

Then tell the user to watch the **✅ CI** run on GitHub Actions — it should run the
`macos-14` and `macos-13` matrix legs green. The publish workflow only fires when a
GitHub release is published (or via manual `workflow_dispatch`), so it will not run
on this push.

---

## Self-Review

**Spec coverage:**
- Universal2 dylib → Task 1 ✓
- Widen `cpu` → Task 2 ✓
- Docs (`CLAUDE.md`, `README.md`, `bin/peon-pet` comment) → Task 3 ✓
- `ci.yml` (macos-14 + macos-13, test + universal assertion) → Task 4 ✓
- `npm-publish.yml` (release-gated, provenance, dist-tag split, version guard, idempotency, macOS deviation) → Task 5 ✓
- `NPM_TOKEN` out-of-band secret + final verification → Task 6 ✓
- Known limitation (FakeShell, no live GUI-on-Intel check) → documented in spec; CI asserts the build artifact, which is the verifiable part ✓

**Placeholder scan:** No TBD/TODO; every code/YAML block is complete and literal.

**Type/identifier consistency:** Script name `build:native`, secret `NPM_TOKEN`, env `NPM_DIST_TAG`, runner labels `macos-14`/`macos-13`, and dylib path `native/libpeonshell.dylib` are used identically across all tasks.

**Note on lockfile:** Task 4 Step 2 guards the `--frozen-lockfile` assumption — if no committed lockfile exists yet, it must be added before CI relies on it.
