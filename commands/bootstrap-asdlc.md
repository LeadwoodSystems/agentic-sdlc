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
   durable content only. The "Where the build is" line sits between
   `<!-- asdlc:current-state:auto -->` markers — `scripts/asdlc/checkpoint-hooks.js` owns
   that span from here on; never hand-edit between the markers. If a bloated `CLAUDE.md`
   already exists, offer to split its running narrative into `docs/STATUS.md` (see the
   state model) rather than editing in place.
2. **`docs/STATUS.md`** — a header explaining it's append-only and machine-generated only
   (never hand-edited — corrections happen by re-running `checkpoint-hooks.js`/
   `finish-sprint.js`). (Reference: `references/state-model.md`.)
3. **`docs/handoffs/_TEMPLATE.md`** — from `references/handoff-template.md`.
4. **`docs/superpowers/plans/`** — create the dir (with a `.gitkeep` if empty) and drop a
   copy of `references/plan-template.md` alongside as `_TEMPLATE.md`.
5. **`.gitignore`** — ensure test/coverage artifacts are ignored if the stack warrants it.
6. **`scripts/asdlc/*.js`** — copy the plugin's hygiene/bookkeeping scripts
   (`new-sprint.js`, `checkpoint-hooks.js`, `finish-sprint.js`, `gh-hygiene.js`,
   `archive-sprint-docs.js`, and `lib/exec.js`) into the repo (skip any that already
   exist). These require only Node on PATH — no `npm install` step.
7. Optionally, **`.claude/rules/`** — suggest path-scoped rule files for any procedural
   recipes (adding a command/connector/migration) that only matter when editing certain
   paths, so they don't sit in `CLAUDE.md` all session.

Finish by explaining the loop to the user (`/sprint` → build → `/handoff` → `/checkpoint`
→ approve → `/clear`, with `/asdlc-hygiene` available any time for a hygiene audit) and
confirm nothing was overwritten.
