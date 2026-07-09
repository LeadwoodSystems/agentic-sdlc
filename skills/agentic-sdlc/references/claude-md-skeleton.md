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
**Current state:** <one line>. To resume, read the **latest** `docs/handoffs/` file
(single source of truth). Full running history: `docs/STATUS.md`. Branch discipline: <…>.

---

## Architecture map (durable invariants)
<The few things a session needs WITHOUT opening a handoff. For a subsystem's full design,
read its handoff. Keep to invariants, not history.>

## How we work (operating rules)
1. **Checkpoint after every sprint:** plan (before) → TDD → verify with evidence → handoff
   (after) → commit → STOP for approval → `/clear` before the next sprint.
2. **Git:** <branch/commit/push discipline>.
3. **Security-sensitive work gets an adversarial multi-agent review** before handoff.
4. <project-specific rules…>

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
