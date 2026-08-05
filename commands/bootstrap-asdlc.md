---
description: Scaffold the Agentic SDLC workflow into a new (or existing) repo
argument-hint: [project name]
---

Set up the Agentic SDLC in this repository so future sessions retain context, handoffs,
and history. Project: **$ARGUMENTS** (if empty, infer from the repo/dir name).

**First, inspect** the repo — is there already a `CLAUDE.md`, `docs/`, or a git history?
Never overwrite existing content; if a file exists, propose a diff and ask before changing it.

Then scaffold (create only what's missing), using the `agentic-sdlc` skill's templates:
1. **`CLAUDE.md`** — from `references/claude-md-skeleton.md`. Fill in stack, run/verify,
   and branch discipline from what you can detect in the repo; keep it under ~200 lines,
   durable content only. Two spans in it are **machine-owned — never hand-edit between the
   markers**: the "Where the build is" line between `<!-- asdlc:current-state:auto -->`
   (owned by `scripts/asdlc/checkpoint-hooks.js`) and the "Measured facts" block between
   `<!-- asdlc:facts:auto -->` (owned by `scripts/asdlc/facts.js`). Copy both marker pairs
   in even though they start empty; a missing span makes the owning script warn and skip.
   Operating rules go in with **stable slugs, not numbers** (`#checkpoint`, `#git`) so a
   retired rule can be deleted rather than left in place to keep old citations resolving.
   If a bloated `CLAUDE.md` already exists, offer to split its running narrative into
   `docs/STATUS.md` (see the state model) rather than editing in place.
2. **`docs/STATUS.md`** — a header explaining it's append-only and machine-generated only
   (never hand-edited — corrections happen by re-running `checkpoint-hooks.js`/
   `finish-sprint.js`). (Reference: `references/state-model.md`.)
3. **`docs/handoffs/_TEMPLATE.md`** — from `references/handoff-template.md`.
4. **`docs/superpowers/plans/`** — create the dir (with a `.gitkeep` if empty) and drop a
   copy of `references/plan-template.md` alongside as `_TEMPLATE.md`.
5. **`.gitignore`** — ensure test/coverage artifacts are ignored if the stack warrants it.
6. **`scripts/asdlc/`** — copy **every** `.js` file the plugin ships under
   `scripts/asdlc/`, including the `lib/` subdirectory and excluding `test/` (skip any
   that already exist). Deliberately a derivation, not a list: an enumeration here went
   stale once already, and a sprint shipped a tool no consumer could receive. These
   require only Node on PATH — no `npm install` step.
7. **`.asdlc/facts.json`** — the manifest of numbers `CLAUDE.md` is allowed to assert.
   Seed it with whatever the repo already claims about itself; each entry is a `label`, a
   `command` **argv array** (not a shell string — commands run with `shell: false`), and
   an optional `capture` regex whose group 1 is the value. Without `capture` the last line
   of stdout is recorded, which is right for `node -v` and wrong for a test runner:
   ```json
   {
     "schema": "asdlc-facts/v1",
     "facts": [
       { "label": "unit tests", "command": ["node", "--test", "test/**/*.test.js"],
         "capture": "tests (\\d+)" }
     ]
   }
   ```
   Then run `node scripts/asdlc/facts.js` once to fill the block, and tell the user to
   re-run it (or `--check` it in CI, alongside `node scripts/asdlc/asdlc-lint.js`) rather
   than ever editing the numbers by hand.
8. **`.asdlc/policy/execution-classes.yaml`** — the execution-class → model mapping and
   default phase routing used by `/profile-issue`. Copy the plugin's copy as a starting
   point and re-point the `model:` values at whatever the project actually uses; the
   classes themselves (`fast`/`standard`/`deep`/`deterministic`) don't change. Nothing
   parses this file — it's read by the agent, so keep it readable rather than terse.
9. Optionally, **`.claude/rules/`** — suggest path-scoped rule files for any procedural
   recipes (adding a command/connector/migration) that only matter when editing certain
   paths, so they don't sit in `CLAUDE.md` all session.

Finish by explaining the loop to the user (`/sprint` → build → `/handoff` → `/checkpoint`
→ approve → `/clear`, with `/asdlc-hygiene` available any time for a hygiene audit) and
confirm nothing was overwritten.
