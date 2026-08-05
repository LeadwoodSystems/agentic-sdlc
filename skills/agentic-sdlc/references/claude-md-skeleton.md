# <Project> · Project Guide (read first)

**This file is the resume point** — durable rules + architecture only, kept thin on
purpose (target <200 lines). A fresh session reads this, then the **latest** handoff in
`docs/handoffs/` (current state), to continue where the last one stopped. Full history is
in `docs/STATUS.md`; don't grow this file with per-sprint narrative.

**Specs & records**
- **WHAT to build:** `docs/build_*/` (product spec, source of truth).
- **HOW we build:** `docs/<specs>/` (durable design decisions).
- **Per-sprint plans:** `docs/…/plans/`. **Per-sprint handoffs (with evidence):** `docs/handoffs/`.

---

## Where the build is
<!-- asdlc:current-state:auto -->
**Current state:** <one line>.
<!-- /asdlc:current-state:auto -->

To resume, read the **latest** `docs/handoffs/` file (single source of truth). Full
running history: `docs/STATUS.md`. Branch discipline: <…>.

> The text between the markers above is owned by `scripts/asdlc/checkpoint-hooks.js` —
> it is rewritten on every `/checkpoint`. Never hand-edit between the markers; if they're
> missing (e.g. an older `CLAUDE.md`), add them back rather than letting the script warn
> and skip.

## Measured facts
<!-- asdlc:facts:auto -->
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
<The few things a session needs WITHOUT opening a handoff. For a subsystem's full design,
read its handoff. Keep to invariants, not history.>

## How we work (operating rules)

> **Rules get stable slugs, not numbers.** Each rule below is a subheading whose text
> *is* its slug, so it is cited as `#checkpoint` or `#git` — the heading's own anchor —
> and never as "rule 2". Numbering looks tidier and costs more: once "rule 6" appears in
> a merged PR, deleting rule 4 silently re-points every historical citation at the wrong
> text. GAW hit exactly that and had to leave a retired rule embalmed in slot 4 so old
> references still resolved. With slugs a dead rule is simply deleted, and a stale
> citation fails loudly — there is no `#adversarial-review` — instead of quietly
> resolving to whatever moved into its place. Keep each rule under ~120 words;
> `scripts/asdlc/asdlc-lint.js` fails on an over-long rule and on a tombstone left
> holding a numbered slot.
>
> **A rule that cannot always be satisfied is written as an offer, not a mandate.**
> `#review` below used to read *"Security-sensitive work gets an adversarial multi-agent
> review before handoff"* — the exact rule GAW, this template's main consumer, retired in
> v0.13-s2. It fired on a large share of sprints and collided with sessions configured not
> to spawn subagents, "producing a merge-blocking decision every time instead of a
> review". The template had drifted from the lesson its own biggest user had already
> learned. Watch for that shape in any rule phrased as *always*: a mandate that cannot be
> met is not a quality bar, it is a ritual with a false-negative record.

### checkpoint
Checkpoint after every sprint: plan (before) → TDD → verify with evidence → handoff
(after) → commit → STOP for approval → `/clear` before the next sprint.

### git
<branch/commit/push discipline>. One sprint = one worktree = one session — a branch is
checked out in exactly one tree at a time, so two sessions sharing a directory fight over
HEAD. `scripts/asdlc/finish-sprint.js` retires the worktree before deleting the branch.

### review
Adversarial multi-agent review is **offered, never required**. When a diff or issue
warrants one — security-sensitive surface, auth, data handling, wide blast radius — the
command proposes it and states the rough cost, and the human or agent decides. **Its
absence is never a gap to record in a handoff.**

### <your-rule>
<project-specific rules — e.g. `spine-first`, `no-network-in-tests`. One slug each,
appended; never renumbered.>

## Stack & layout
<one-liner + tree>

## Run / verify
```bash
# how to run the app + the tiered test commands (inner-loop vs full checkpoint)
```

## Conventions & gotchas
- <the non-obvious things that cause mistakes if unknown>

> Keep this file **thin** — durable rules/architecture only. Log per-sprint progress in
> the latest `docs/handoffs/` and `docs/STATUS.md`, not here. Prune any line that wouldn't
> cause a mistake if removed.
