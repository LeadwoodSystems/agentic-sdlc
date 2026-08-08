# agentic-sdlc · Project Guide (read first)

**This file is the resume point** — durable rules + architecture only, kept thin on
purpose (target <200 lines). A fresh session reads this, then the **latest** handoff in
`docs/handoffs/` (current state), to continue where the last one stopped. Full history is
in `docs/STATUS.md`; don't grow this file with per-sprint narrative.

This repo **is** the ASDLC plugin. It dogfoods its own methodology: the scripts under
`scripts/asdlc/` are the same ones it ships to consumers, and this file is written from
`skills/agentic-sdlc/references/claude-md-skeleton.md`. When the two disagree, that is a
bug in the skeleton — fix it there first.

**Specs & records**
- **HOW we build:** `docs/superpowers/specs/` (durable design decisions), `docs/*.md` (proposals).
- **Per-sprint plans:** `docs/superpowers/plans/`. **Per-sprint handoffs (with evidence):** `docs/handoffs/`.

---

## Where the build is
<!-- asdlc:current-state:auto -->
**Current state:** gh-hygiene exempts an explicit kind/ allowlist from the profile worklist and holds epics to an open-sub-issue check instead, and the README is reordered onto epic #11's information architecture with all 82 technical claims verified preserved — see [handoff](docs/handoffs/v0.3-s2-issue-kinds-and-readme.md)
<!-- /asdlc:current-state:auto -->

To resume, read the **latest** `docs/handoffs/` file (single source of truth). Full
running history: `docs/STATUS.md`. Branch discipline: one sprint = one branch
`sprint/vX.Y-sN`, squash-merged to `main` via PR.

**Next initiative (not yet started):** Capability Layer & Public Maturity — 47 issues on
one milestone, build sequence and reasoning in
[docs/2026-08-07-capability-layer-roadmap.md](docs/2026-08-07-capability-layer-roadmap.md).
Epic 1 (#11) is profiled and ready; Epics 2–6 are not.

> The text between the markers above is owned by `scripts/asdlc/checkpoint-hooks.js` —
> it is rewritten on every `/checkpoint`. Never hand-edit between the markers; if they're
> missing, add them back rather than letting the script warn and skip.

## Measured facts
<!-- asdlc:facts:auto -->
<!-- Measured by `node scripts/asdlc/facts.js` from .asdlc/facts.json. Do not hand-edit: your numbers will be overwritten, and `--check` will fail until they are. -->

- asdlc unit tests: **335**
- asdlc unit tests passing: **335**
- node: **v24.11.1**
<!-- /asdlc:facts:auto -->

> Everything between those markers is owned by `scripts/asdlc/facts.js`, which runs the
> commands declared in `.asdlc/facts.json` and rewrites the span. **Never hand-edit it** —
> your numbers are overwritten on the next run, and `facts.js --check` (and
> `scripts/asdlc/asdlc-lint.js`) fail until they match reality. Put every count, timing
> and port here rather than typing it into the prose below: a command that fails records
> `**UNMEASURED**` with the reason, so the file can be out of date but never confidently
> wrong.

---

## Architecture map (durable invariants)

A Claude Code **plugin**, not an application. Four surfaces, and the split between them is
the design:

- **`skills/agentic-sdlc/`** — the method as prose. `SKILL.md` is the loop; `references/`
  holds the templates and the state model. Read by an agent, never parsed.
- **`commands/`** — slash commands (`/sprint`, `/checkpoint`, `/handoff`, `/verify-issue`,
  `/profile-issue`, `/asdlc-hygiene`, `/bootstrap-asdlc`). Prose the agent executes.
- **`scripts/asdlc/`** — the bookkeeping and gates. **Judgment-heavy steps stay prose;
  scripts only take over bookkeeping and gating.** That line is from
  `docs/superpowers/specs/2026-07-22-loop-hardening-design.md` and it decides what may
  become a script.
- **`.asdlc/`** — machine-read config: `policy/execution-classes.yaml` (class → model,
  agent-read only) and `facts.json` (the measured-facts manifest).

**Marker spans are the integration seam.** Three files own a `<!-- asdlc:*:auto -->` span
and rewrite only what is between the markers, leaving the rest of the document
byte-identical: `checkpoint-hooks.js` (current-state), `facts.js` (measured facts),
`lib/profile-block.js` (execution profiles on GitHub issues). Markers are **unversioned** —
the version lives in the payload, because a versioned marker stops matching its own
earlier span and appends a duplicate.

## How we work (operating rules)

> **Rules get stable slugs, not numbers** — each heading's text *is* its slug, cited as
> `#checkpoint`. Keep each under ~120 words; `asdlc-lint.js` fails on an over-long rule
> and on a tombstone left holding a numbered slot.

### checkpoint
Checkpoint after every sprint: plan (before) → TDD → verify with evidence → handoff
(after) → commit → STOP for approval → `/clear` before the next sprint.

### git
One sprint = one branch `sprint/vX.Y-sN` = one worktree = one session. A branch is checked
out in exactly one tree at a time, so two sessions sharing a directory fight over HEAD.
PRs are **squash-merged**, which is why merged-ness is tested by
`lib/branch-status.js` (merged-PR lookup, then a two-dot tree comparison) and never by
`git log <trunk>..<branch>` — that is never empty after a squash-merge.
`finish-sprint.js` retires the worktree before deleting the branch.

### review
Adversarial multi-agent review is **offered, never required**. When a diff or issue
warrants one — security-sensitive surface, wide blast radius — the command proposes it and
states the rough cost, and the human or agent decides. **Its absence is never a gap to
record in a handoff.**

### zero-dependencies
`scripts/asdlc/` uses Node core only — no `package.json`, no lockfile, no install step. A
plugin that needs `npm install` before its gate runs is a plugin whose gate gets skipped.
This is why the execution-profile payload is JSON (both `JSON.parse` and
`ConvertFrom-Json` are built in) while agent-read config may be YAML.

### runner-injection
Every function that shells out takes `{ runner = run }` from `lib/exec.js`, so tests stub
it instead of touching a real repo. The whole suite depends on this seam — preserve it in
new code. `run()` trims output, has no stdin, and attaches `err.status`/`err.stderr` so a
caller can tell a *result* signalled through an exit code (`git diff --quiet` → 1) from a
real failure (→ 128).

### ports-are-prose
Anything countable — test totals, timings, versions — belongs in the facts span, measured.
If you find yourself typing a number into this file, add it to `.asdlc/facts.json` instead.

## Stack & layout

Node (core only) + Markdown. No build step, no runtime dependencies.

```
skills/agentic-sdlc/{SKILL.md,references/}   the method
commands/*.md                                slash commands
scripts/asdlc/                               every gate and bookkeeping script (see the dir)
scripts/asdlc/lib/                           shared seams: exec, marker spans, git state
scripts/asdlc/test/                          node:test suite (+ helpers/fixture-repo.js)
.asdlc/{policy/,facts.json}                  machine-read config
docs/{superpowers/,handoffs/,STATUS.md}      plans, specs, handoffs, history
```

## Run / verify

```bash
node --test "scripts/asdlc/test/**/*.test.js"   # the whole suite (~25s)
node scripts/asdlc/facts.js                     # re-measure the facts span
node scripts/asdlc/facts.js --check             # non-zero if the span is stale
node scripts/asdlc/asdlc-lint.js                # lint this file
node scripts/asdlc/gh-hygiene.js main v0.2      # stale local/remote branches, worktrees, triage, milestones, scheduled workflows
```

**Shell:** PowerShell is canonical on the development machine; the Bash tool is retired
there (Git-for-Windows MSYS dies with `add_item (...) failed, errno 1`). See
`docs/2026-08-04-shell-strategy.md`. Never round-trip source files through a shell.

## Conventions & gotchas

- **`docs/STATUS.md` is machine-generated.** Written only by `checkpoint-hooks.js`
  (append) and `finish-sprint.js` (flip awaiting-merge → merged). Fix a wrong entry by
  re-running the script that owns it, never by typing into the file.
- **`core.autocrlf` is on** — files on disk are CRLF. Anything that rewrites a document
  must detect and preserve the dominant line ending (`lib/marker-block.js`,
  `lib/profile-block.js` both do).
- **Plans and handoffs share one naming scheme:** `vMAJOR.MINOR-sN-<slug>.md`. The
  `new-sprint.js` gate pairs them by slug — a file that predates the convention reports as
  `unmatched-plan` forever.
- **This repo has no CI and no open issues.** The suite is the only gate, and
  `/profile-issue` therefore cannot be dogfooded here — it is validated against GAW.

> Keep this file **thin** — durable rules/architecture only. Log per-sprint progress in
> the latest `docs/handoffs/` and `docs/STATUS.md`, not here. Prune any line that wouldn't
> cause a mistake if removed.
