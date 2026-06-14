# peon-pet — Baseline Specifications

This directory is the **baseline spec corpus**: it captures how peon-pet *actually
behaves today*, one capability per directory, so future work can be proposed as
OpenSpec change deltas against a trustworthy reference instead of tribal knowledge.

> **Disclaimer (living document).** These specs describe the current state and are
> updated whenever behavior changes — note the codebase is mid-migration off the
> former Node/Electron shell. If a spec and the code disagree, the code is the bug
> *or* the spec is stale — either way, open an issue; don't silently trust one side.

> **Status.** The corpus is being established. Capabilities are extracted into
> `specs/<name>/spec.md` as they are written; the table below lists the planned set
> and links each one once its spec lands. Until then, `CLAUDE.md` and the change
> proposals under `openspec/changes/` are the closest record.

## How to read these specs

Every spec follows the same shape:

- **Purpose** — what the capability does and for whom.
- **Non-Goals** — what it deliberately does *not* do (so nobody "fixes" that).
- **Requirements** — verifiable `SHALL` contracts, each with at least one happy-path
  and one error/edge **Scenario** in WHEN/THEN form.
- **Technical Notes** — constants, tables, and `file:line` traceability refs, kept
  out of the requirement text so contracts stay readable.
- **Open Issues** — known gaps, tracked by GitHub issue where one exists.

Terminology is canonical: every term of art (Session, Sub-agent, NativeShell, …) is
defined once in [GLOSSARY.md](GLOSSARY.md) and used verbatim everywhere else.

## Spec authoring — Sobolev's "correct user stories" lens

Requirements are written as correct, BDD-style user stories, applying
[Sobolev's engineering guide](https://dev.to/wemake-services/engineering-guide-to-writing-correct-user-stories-1i7f),
which maps onto OpenSpec's Requirement + Scenario = Gherkin. A requirement is not
"done" until it satisfies these (the IEEE-830 attributes in practice):

1. **Enumerate all outcomes, not just the happy path.** Every requirement carries
   scenarios for success **and** the failure / invalid-input / edge cases.
2. **Specific roles, not "the user."** Name the concrete persona (below) the behavior
   serves, never a generic "user/system."
3. **User value over implementation.** The requirement states the observable outcome;
   mechanisms (FFI calls, file layouts) live in the scenarios / Technical Notes.
4. **Verifiable ⇒ a test.** Each scenario is expressible as a `bun test` case (or a
   named manual smoke step when it crosses the FFI boundary).
5. **First-line SHALL (validator gotcha).** Lead with `The system SHALL …` so the
   keyword lands on the **first line** of the first plain paragraph — the validator
   scans that line. If `SHALL` wraps to line 2, the line starts with bold `**…**`, or
   the name carries a `[Must]` tag, validation fails. Put priority + role on a
   trailing line: `_Priority: Must. Role: a user upgrading from the Electron build._`
6. **Ubiquitous language.** Use the [Glossary](GLOSSARY.md) terms consistently — one
   term per concept, no synonyms drifting across proposal / design / spec / code.

## Personas

Specs name these concrete roles instead of a generic "user":

- **Vlad, the Claude Code power user** — runs long, multi-Session Claude Code work
  with Sub-agents and glances at the orc for session dots and mini-pets. Cares about
  accurate Active-session and Sub-agent display and correct Hot/Warm states.
- **Mira, the skin author** — installs or builds a custom Character (sprite atlas,
  borders, bg, dock-icon). Cares about asset resolution and the character-selection
  contract.
- **Dana, the shell contributor** — works on the NativeShell / AppKitShell FFI seam.
  Cares about the FakeShell test boundary, Work-area / Primary-display correctness,
  and keeping the renderer untouched.

## Capabilities

| Spec | Covers |
|---|---|
| session-tracking | Watching Session JSONL transcripts, Active detection, Hot/Warm dot states |
| sub-agents | Foreground vs background Sub-agents, mini-pets |
| window-shell | NSPanel placement, float-over-all, click-through vs hover-capture (NativeShell) |
| characters | Character/skin selection and asset resolution |
| rendering | The Three.js renderer surface and the shell↔renderer boundary |

*(Links are added as each `spec.md` is written; rows without a link are not yet
extracted — see Status above.)*

## Validation

```bash
openspec spec list                    # enumerate capabilities
openspec validate --specs --strict    # structural validation — must exit 0
```

These commands require the standalone **OpenSpec CLI**, installed separately (not a
peon-pet dependency). The specs themselves are plain Markdown and reviewable without it.
