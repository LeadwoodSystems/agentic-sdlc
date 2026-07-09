# State model & the generalize-vs-per-project split

## The three tiers of memory (keep them separate)

| Tier | Lives in | Loaded | Holds | Never holds |
|---|---|---|---|---|
| **Durable** | `CLAUDE.md` (<200 lines) | every session, in full | architecture invariants, operating rules, stack, run/verify, gotchas | per-sprint narrative, history, changelogs |
| **History** | `docs/STATUS.md` | on demand (linked, not auto-loaded) | append-only running log, oldest→newest | live "current state" |
| **Current state** | latest `docs/handoffs/*.md` | read at session start to resume | status, what shipped, evidence, follow-ups, next entry points | anything already captured durably |

**Rule:** exactly one source of truth for current state — the newest handoff. Do not
hand-sync the same status into `CLAUDE.md` + memory + a handoff; that drifts (the classic
symptom: the test count in `CLAUDE.md` disagrees with reality).

## The "would removing this cause a mistake?" test
Every line in `CLAUDE.md` must pass it. History fails it — history is not instruction.
Move anything that fails to `STATUS.md` or a handoff.

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
