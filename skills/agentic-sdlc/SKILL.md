---
name: agentic-sdlc
description: Use when driving a large, multi-session software build with an AI agent and you need to retain context, handoffs, and history across many sprints — bootstrapping a project's workflow, starting a sprint, checkpointing before a commit, or writing a resume-ready handoff. Symptoms it addresses — a bloated CLAUDE.md, lost state between sessions, drift across status files, "where were we?" at session start.
---

# Agentic SDLC — spec-driven, checkpoint-gated build loop

## Overview
A method for building software across many AI sessions without losing context, handoffs,
or history. Core principle: **keep persistent context thin, push history to disk, and make
every sprint resume-ready from a written handoff.** Proven across 100+ sprints on one
product. This skill orchestrates existing `superpowers` skills — it does not replace them.

> Script names below (`checkpoint-hooks.js`, `new-sprint.js`, `finish-sprint.js`,
> `archive-sprint-docs.js`, `gh-hygiene.js`, `facts.js`, `asdlc-lint.js`) are the
> plugin's reference implementation.
> A project may ship a ported equivalent instead — e.g. GAW's Windows build uses
> PowerShell (`scripts/asdlc/checkpoint-hooks.ps1`, `new-sprint.ps1`, `finish-sprint.ps1`,
> `archive-sprint-docs.ps1`, `gh-hygiene.ps1`). Check `scripts/asdlc/README.md` for the
> actual filenames in use before running one that doesn't exist.

Two rules make it work:
1. **Thin persistent context.** The repo's `CLAUDE.md` holds ONLY durable rules +
   architecture (target <200 lines). Running history lives in `docs/STATUS.md`; the
   current state lives in the **latest** `docs/handoffs/` file. Never grow `CLAUDE.md`
   with per-sprint narrative — a bloated `CLAUDE.md` degrades instruction-following and
   re-bloats after `/compact`.
2. **Checkpoint every sprint:** plan (before) → build test-first → verify with evidence →
   handoff (after) → commit → STOP for approval → `/clear`. One unit of work per checkpoint.

## The loop (per sprint)
0. **If starting from an existing tracked issue that's architectural, old, or hasn't
   been touched since filed** → `/verify-issue [id]` first. Adversarially checks the
   issue's claims against the current codebase before it becomes a plan, so the plan
   isn't built against a stale premise. Skip for small, self-evidently-current fixes.
   Then `/profile-issue [id]` to decide *how* to execute it — the two are complementary:
   `/verify-issue` asks "is this issue still true?", `/profile-issue` asks "what's the
   cheapest resource that can reliably do it?".
1. **Plan first** → `docs/superpowers/plans/`. REQUIRED SUB-SKILL: superpowers:brainstorming, then superpowers:writing-plans.
2. **Build test-first.** REQUIRED SUB-SKILL: superpowers:test-driven-development.
3. **Verify with real evidence** (commands run, live output, test counts — not assertions). REQUIRED SUB-SKILL: superpowers:verification-before-completion.
4. **Adversarial review for risky/security work** — fan out reviewers by dimension, verify/refute each finding, fix the real ones. REQUIRED SUB-SKILL: superpowers:requesting-code-review.
5. **Handoff** → an evidence-bearing `docs/handoffs/<sprint>.md` so a fresh session resumes exactly here (`/handoff`).
6. **Checkpoint** (`/checkpoint`) → run targeted tests (changed files + dependents, capped at ~3 min — not the full suite), confirm the handoff exists, run `scripts/asdlc/checkpoint-hooks.js` to append `docs/STATUS.md` and update `CLAUDE.md`'s pointer, stage the commit. Then **STOP for approval** and **`/clear`** before the next sprint. After the PR merges, run `scripts/asdlc/finish-sprint.js` to flip the STATUS entry to merged and clean up the branch.

## Commands
- `/bootstrap-asdlc` — scaffold this workflow (including `scripts/asdlc/`) into a new repo.
- `/verify-issue [id]` — adversarially check a tracked issue against the current
  codebase before it becomes a plan (research → draft → independent fact-check →
  correct → push with the tracker's own sequencing conventions). See
  `references/issue-verification-methodology.md`.
- `/profile-issue [id]` — assess a tracked issue and attach an **ASDLC Execution
  Profile**: complexity, risk, blast radius, and the cheapest execution class that can
  reliably do each phase (plan / build / verify / review). Records the *class*, never a
  model name — the model resolves from `.asdlc/policy/execution-classes.yaml`, so a
  model-lineup change is a one-line config edit rather than a backlog relabel. See
  `references/execution-profiles.md`.
- `/sprint [name]` — start a sprint: run the `new-sprint.js` gate, scaffold its plan, kick off brainstorm→plan.
- `/checkpoint` — non-blocking gate: targeted tests (<=3min) + handoff-exists + STATUS/pointer script, then stage.
- `/handoff` — generate the handoff doc from the template.
- `/asdlc-hygiene [trunk] [version]` — on-demand read-only audit: stale branches, stale
  worktrees, default-branch drift, untriaged issues, milestone/version sync.

## State model (single source of truth)
- `CLAUDE.md` — durable rules + architecture only (<200 lines). Its "current state"
  line lives between `<!-- asdlc:current-state:auto -->` markers, owned by
  `scripts/asdlc/checkpoint-hooks.js` — never hand-edit that span. Its operating rules
  carry **stable slugs, not numbers**: cite `#git`, never "rule 2", so a retired rule can
  be deleted instead of embalmed in its slot to keep old citations resolving.
- `.asdlc/facts.json` + the `<!-- asdlc:facts:auto -->` span in `CLAUDE.md` — every count,
  timing and port the file asserts, declared as a **command to run** rather than a number
  to type. `scripts/asdlc/facts.js` measures them and rewrites the span (never hand-edit
  it); `facts.js --check` reports staleness without writing. A command that fails records
  `**UNMEASURED**` with the reason — a stale number that looks freshly measured is worse
  than none.
- `scripts/asdlc/asdlc-lint.js` — the durable-context lint: fails on an absent or stale
  facts block, a retired rule left in a numbered slot, an over-long rule paragraph, or two
  declared facts that contradict each other. Run it wherever the test suite runs.
- `docs/STATUS.md` — append-only running history, machine-generated only (never
  hand-edited); newest at the bottom.
- **One sprint = one worktree = one session.** A branch is checked out in exactly one tree
  at a time, so the worktree — not the session — is the safe unit of concurrency.
  `new-sprint.js` refuses to start over a stale worktree, `finish-sprint.js` removes it
  before deleting the branch, `gh-hygiene.js` audits for orphans. See
  `references/state-model.md`.
- `docs/handoffs/<sprint>.md` — **the** current-state source; read the latest to resume.
- Naming for both plans and handoffs: `vMAJOR.MINOR-sN-<slug>.md`. When a milestone
  closes, run `scripts/asdlc/archive-sprint-docs.js <milestone>` to keep the live
  directories from growing unbounded.
- `.asdlc/policy/execution-classes.yaml` — the execution-class → model mapping and
  default phase routing. Human/agent-read only; no script parses it (which is why it can
  be YAML while the machine-readable execution profiles are JSON).
- Per-project specifics (stack, gotchas, domain recipes) → `CLAUDE.md` + path-scoped
  `.claude/rules/*.md` (loads only when touching matching files).

## Context hygiene
`/clear` between sprints and after two failed corrections. Delegate exploration/review to
subagents — they report ~1–2k-token summaries, keeping the main window clean. Prefer
just-in-time retrieval (read the latest handoff, not all history).

## Common mistakes
- Hand-editing `CLAUDE.md`'s current-state pointer or `docs/STATUS.md` → let
  `checkpoint-hooks.js`/`finish-sprint.js` own both; this is the exact drift observed
  in real multi-hundred-sprint usage.
- Tracking state in multiple hand-synced files → drift. The latest handoff is authoritative.
- Skipping the handoff "to save time" → the next session can't resume; this is the one step never to cut.
- Letting milestones drift from the sprint version scheme, or branches pile up unmerged
  → run `/asdlc-hygiene` periodically.
- **Running two sessions in one working tree** to get parallelism → they fight over HEAD.
  Give each sprint its own worktree; that is what makes them independent. And retire the
  worktree when the sprint ends — an orphan holds uncommitted work nobody can see (a
  1.15 GB one survived a week in GAW with 14 uncommitted files, invisible to every check
  that existed at the time, which is why `findStaleWorktrees` now exists).
- Typing a test count, timing or port into `CLAUDE.md` → it is wrong within weeks and
  reads as authoritative. Declare it in `.asdlc/facts.json` and let `facts.js` measure it.
- Hard-blocking hooks for routine actions → prefer non-blocking helper commands and keep the human-approval checkpoints; they are a feature, not friction. The `new-sprint.js` gate is the deliberate exception — it hard-blocks starting a new sprint over an uncommitted one, because that specific failure mode was observed eroding under momentum in practice.
