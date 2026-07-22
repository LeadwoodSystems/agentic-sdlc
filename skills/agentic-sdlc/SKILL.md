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
- `/sprint [name]` — start a sprint: run the `new-sprint.js` gate, scaffold its plan, kick off brainstorm→plan.
- `/checkpoint` — non-blocking gate: targeted tests (<=3min) + handoff-exists + STATUS/pointer script, then stage.
- `/handoff` — generate the handoff doc from the template.
- `/asdlc-hygiene [trunk] [version]` — on-demand read-only audit: stale branches, default-branch drift, untriaged issues, milestone/version sync.

## State model (single source of truth)
- `CLAUDE.md` — durable rules + architecture only (<200 lines). Its "current state"
  line lives between `<!-- asdlc:current-state:auto -->` markers, owned by
  `scripts/asdlc/checkpoint-hooks.js` — never hand-edit that span.
- `docs/STATUS.md` — append-only running history, machine-generated only (never
  hand-edited); newest at the bottom.
- `docs/handoffs/<sprint>.md` — **the** current-state source; read the latest to resume.
- Naming for both plans and handoffs: `vMAJOR.MINOR-sN-<slug>.md`. When a milestone
  closes, run `scripts/asdlc/archive-sprint-docs.js <milestone>` to keep the live
  directories from growing unbounded.
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
- Hard-blocking hooks for routine actions → prefer non-blocking helper commands and keep the human-approval checkpoints; they are a feature, not friction. The `new-sprint.js` gate is the deliberate exception — it hard-blocks starting a new sprint over an uncommitted one, because that specific failure mode was observed eroding under momentum in practice.
