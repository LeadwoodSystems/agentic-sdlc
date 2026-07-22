# State model & the generalize-vs-per-project split

## The three tiers of memory (keep them separate)

| Tier | Lives in | Loaded | Holds | Never holds |
|---|---|---|---|---|
| **Durable** | `CLAUDE.md` (<200 lines) | every session, in full | architecture invariants, operating rules, stack, run/verify, gotchas | per-sprint narrative, history, changelogs |
| **History** | `docs/STATUS.md` | on demand (linked, not auto-loaded) | append-only running log, oldest→newest, **machine-generated only** | live "current state", hand-typed narrative |
| **Current state** | latest `docs/handoffs/*.md` | read at session start to resume | status, what shipped, evidence, follow-ups, next entry points | anything already captured durably |

**Rule:** exactly one source of truth for current state — the newest handoff. Do not
hand-sync the same status into `CLAUDE.md` + memory + a handoff; that drifts (the classic
symptom: the test count in `CLAUDE.md` disagrees with reality).

## The "would removing this cause a mistake?" test
Every line in `CLAUDE.md` must pass it. History fails it — history is not instruction.
Move anything that fails to `STATUS.md` or a handoff.

## STATUS.md is machine-generated, never hand-edited
`docs/STATUS.md` is written only by `scripts/asdlc/checkpoint-hooks.js` (append) and
`scripts/asdlc/finish-sprint.js` (flip awaiting-merge → merged). If an entry is wrong,
fix it by re-running the script that owns it, not by typing into the file — hand-editing
is exactly how this file grew into an unmaintainable, out-of-order wall of narrative in
real usage. Each entry is one line: date, sprint id, one-line summary, a link to the
handoff, and a status field.

## Naming and archival
Plans and handoffs share a canonical naming scheme: `vMAJOR.MINOR-sN-<slug>.md`. `new-sprint.js`
creates these files by concatenating `sprintId` and `slug` parameters, but does not validate
that `sprintId` matches the `vMAJOR.MINOR-sN` format — callers must ensure this naming
discipline. When a milestone closes, run `scripts/asdlc/archive-sprint-docs.js <milestone>` to
move that milestone's files into `docs/handoffs/archive/<milestone>/` and
`docs/superpowers/plans/archive/<milestone>/` — the live directories should only ever hold
the current milestone's worth of files.

## Milestones track the sprint version scheme
If sprints are versioned `vX.Y-sN`, a milestone named `vX.Y` should exist for the
duration of that version's sprints. `scripts/asdlc/gh-hygiene.js` flags drift between
the two schemes — run it periodically, not just at bootstrap.

## Generalizes (belongs in this plugin) vs per-project (stays in the repo)
- **Plugin (project-agnostic):** the sprint loop, this state model, the doc layers
  (build-spec → plan → handoff), the plan/handoff templates, the adversarial-review-by-
  dimension pattern, context hygiene, and delegation to `superpowers` skills.
- **Repo (project-specific):** architecture, stack, run commands, gotchas, domain recipes.
  Put durable ones in `CLAUDE.md`; put "only-relevant-when-editing-X" ones in path-scoped
  `.claude/rules/*.md` (YAML `paths:` frontmatter → loads only when matching files are touched).

## Document layers (the pipeline)
```
docs/build_*/         WHAT to build   (product spec: PRD/TRD/API/DB/…)     — source of truth
docs/<specs>/         HOW to build    (durable design decisions)
docs/…/plans/*.md     per-sprint PLAN (written BEFORE the work)
docs/handoffs/*.md    per-sprint HANDOFF (written AFTER, with evidence)   — current state
docs/STATUS.md        running history (append-only)
CLAUDE.md             durable resume point (thin)
```
This maps onto GitHub Spec-Kit (Spec→Plan→Tasks→Implement) and AWS Kiro
(steering vs specs). You get the same benefits without the tooling lock-in.
