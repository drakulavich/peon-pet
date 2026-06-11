# Intel (x86_64) support + build/publish pipeline

**Date:** 2026-06-11
**Status:** Approved (design)
**Author:** Anton Yakutovich

## Problem

peon-pet is currently Apple-Silicon-only (`darwin`/`arm64`). The lock is almost
entirely declarative — there is no architecture-specific application code. We want
to (1) make the package installable and runnable on Intel Macs and (2) add a
CI + npm publish pipeline modeled on
[`drakulavich/kesha-voice-kit`](https://github.com/drakulavich/kesha-voice-kit),
so artifacts are built and published with provenance from GitHub Actions.

## Why it is cheap

| Layer | Intel-specific risk | Why |
|---|---|---|
| `package.json` `cpu: ["arm64"]` | The actual install blocker | Makes `bunx`/`npm i` refuse to install on Intel. |
| `bun:ffi` layer (`src/shell/appkit.ts`) | None | Uses only `void/bool/cstring/f64/ptr` — no structs, no `sizeof`/offset math, no pointer-size assumptions. Both arches are LP64. |
| Native dylib (`native/peonshell.m`) | Trivial | A ~427-line AppKit shim. `build:native` runs `clang` on the host. |
| Renderer (three.js / WKWebView) | None | Runs in the system WebView — architecture-independent. |
| Bun runtime | None | Ships native macOS x64 and arm64 builds. |

The engineering cost is ~1 hour. The standing cost is the **support surface**: once
Intel is advertised, Intel bug reports follow.

## Goals

- Package installs and runs on Intel (`x64`) and Apple Silicon (`arm64`) macOS.
- The shipped native shim is a **universal2** Mach-O (both slices).
- CI verifies the build on both Apple Silicon and Intel runners.
- A release-gated npm publish workflow ships with provenance, mirroring
  kesha-voice-kit's conventions.

## Non-goals

- Linux / Windows support (remains an explicit non-goal).
- Full automated GUI-on-Intel verification (see "Known limitation" below).
- Changing the runtime behavior of the pet.

## Part 1 — Intel (x86_64) support

### 1.1 Universal2 dylib

`package.json` `scripts.build:native`:

```diff
- clang -framework Cocoa -framework WebKit -dynamiclib -fobjc-arc -o native/libpeonshell.dylib native/peonshell.m
+ clang -arch arm64 -arch x86_64 -framework Cocoa -framework WebKit -dynamiclib -fobjc-arc -o native/libpeonshell.dylib native/peonshell.m
```

clang on an Apple Silicon runner cross-compiles the x86_64 slice from the macOS SDK
(both slices present). `start`, `dev`, and `prepack` all already call this script,
so local Intel clones also produce a working native binary. The dylib roughly
doubles in size (still tiny — it is a thin shim).

### 1.2 Widen the CPU guard

`package.json`:

```diff
- "cpu": ["arm64"],
+ "cpu": ["arm64", "x64"],
```

### 1.3 Docs

- `CLAUDE.md`: "Apple Silicon macOS only (`darwin`/`arm64`)" → "Apple Silicon **and
  Intel** macOS (`darwin`/`arm64`+`x64`)".
- `README.md`: "Requires **Apple Silicon macOS**" → "Requires **macOS (Apple Silicon
  or Intel)**".

### 1.4 `bin/peon-pet` comment

The launcher comment says "prebuilt **arm64** native shim ships in the package" —
update to "universal". The existing missing-dylib compile fallback needs no logic
change; it already covers any install where the prebuilt binary is absent.

## Part 2 — `ci.yml` (verification)

Trigger: `push` and `pull_request`. Matrix over two macOS runners:

- `macos-14` (Apple Silicon)
- `macos-13` (Intel)

Steps per runner:

1. Checkout.
2. `oven-sh/setup-bun@v2`.
3. `bun install`.
4. `bun test` — headless suite (uses `FakeShell`; no window, no GPU).
5. `bun run build:native`.
6. Assert the dylib is universal2: `file native/libpeonshell.dylib` must report
   **both** `arm64` and `x86_64`. Fail the job otherwise.

### Known limitation (stated, not hidden)

`bun test` exercises `FakeShell`, not `appkit.ts`, so CI proves the x86_64 slice
**compiles and is a well-formed universal2 Mach-O** — it does NOT prove the slice
`dlopen`s into a live `WKWebView` on Intel. Full GUI-on-Intel verification requires
a physical Intel Mac and is out of scope. This is an accepted gap.

## Part 3 — `npm-publish.yml` (modeled on kesha-voice-kit)

Reuses kesha-voice-kit's skeleton and security posture:

- Triggers: `release: { types: [published] }` + `workflow_dispatch` with a `tag`
  input. Publishing a GitHub release (draft → published) is the manual gate.
- Permissions: `contents: read`, `id-token: write` (unlocks npm provenance via OIDC).
- Resolve tag through `env:` (never direct `${{ }}` interpolation in `run:`) —
  GHA injection hardening.
- Checkout at the resolved tag.
- `actions/setup-node@v6` with `node-version: 22`, `registry-url:
  https://registry.npmjs.org`.
- **Verify `package.json#version` matches the tag** (strip leading `v`). Abort on
  mismatch.
- **Idempotent guard:** `npm view <name>@<version>` — skip publish if already on npm.
- **dist-tag split:** SemVer prerelease (`vX.Y.Z-beta.N`, version contains `-`) →
  `beta`; stable → `latest`.
- `npm publish --provenance --access public --tag <dist-tag>` with
  `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.

### Deliberate deviation from kesha-voice-kit

kesha-voice-kit publishes on `ubuntu-latest` because its Rust native artifacts are
prebuilt in a separate macOS job and bundled before publish. peon-pet's `prepack`
**compiles the dylib at pack time** with `-framework Cocoa -framework WebKit`, which
is **macOS-only**. Therefore the publish job runs on **`macos-14`**, where:

1. `npm publish` triggers `prepack`, which runs `build:native` (universal2 dylib) +
   `vendor:three`.
2. `npm publish --provenance` ships the freshly built universal tarball.

Provenance / OIDC attestation works on macOS runners. The split-job alternative
(build-on-macos → upload artifact → publish-on-ubuntu) adds moving parts for no
benefit here and is explicitly not chosen.

### Secret required

`NPM_TOKEN` — an npm automation token with publish rights to
`@drakulavich/peon-pet`, stored as a repo secret. (Out-of-band setup step; noted in
the plan, not automatable from the workflow.)

## Decisions

1. **Committed dylib stays tracked.** `native/libpeonshell.dylib` remains in git and
   in `package.json#files`. `prepack` rebuilds it as universal2 at publish time, so
   the committed copy is not the published authority — but keeping it tracked means a
   raw `bunx` from a git install still works without clang present. No gitignore
   change.
2. **Release flow = GitHub release as manual gate.** Draft → publish triggers the npm
   workflow. First release is `v0.1.0` (matches current `package.json#version`).
3. **Publish runs on `macos-14`** (see deviation above).

## Affected files

- `package.json` — `build:native` script, `cpu` array.
- `CLAUDE.md` — platform line.
- `README.md` — requirements line.
- `bin/peon-pet` — comment only.
- `.github/workflows/ci.yml` — new.
- `.github/workflows/npm-publish.yml` — new.

## Testing / acceptance

- `bun test` green on both `macos-14` and `macos-13`.
- `file native/libpeonshell.dylib` shows both `arm64` and `x86_64` on both runners.
- A `workflow_dispatch` dry conceptual run: version/tag guard and idempotency guard
  behave (validated by reading, since a real publish is a one-shot side effect).
- Local `bun run start` on the dev (Apple Silicon) machine still launches the pet
  after the `build:native` change.
