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
6. **Checkpoint** (`/checkpoint`) → run tests, confirm the handoff exists, update `docs/STATUS.md`, stage the commit. Then **STOP for approval** and **`/clear`** before the next sprint.

## Commands
- `/bootstrap-asdlc` — scaffold this workflow into a new repo.
- `/verify-issue [id]` — adversarially check a tracked issue against the current
  codebase before it becomes a plan (research → draft → independent fact-check →
  correct → push with the tracker's own sequencing conventions). See
  `references/issue-verification-methodology.md`.
- `/sprint [name]` — start a sprint: scaffold its plan, kick off brainstorm→plan.
- `/checkpoint` — non-blocking gate: tests + handoff-exists + STATUS reminder, then stage.
- `/handoff` — generate the handoff doc from the template.

## State model (single source of truth)
- `CLAUDE.md` — durable rules + architecture only (<200 lines).
- `docs/STATUS.md` — append-only running history; newest at the bottom.
- `docs/handoffs/<sprint>.md` — **the** current-state source; read the latest to resume.
- Per-project specifics (stack, gotchas, domain recipes) → `CLAUDE.md` + path-scoped
  `.claude/rules/*.md` (loads only when touching matching files).

See `references/state-model.md` for the full model and the generalize-vs-per-project split;
`references/` also holds the plan, handoff, and thin-`CLAUDE.md` templates.

## Context hygiene
`/clear` between sprints and after two failed corrections. Delegate exploration/review to
subagents — they report ~1–2k-token summaries, keeping the main window clean. Prefer
just-in-time retrieval (read the latest handoff, not all history).

## Common mistakes
- Letting `CLAUDE.md` accumulate a changelog → move it to `docs/STATUS.md`.
- Tracking state in multiple hand-synced files → drift. The latest handoff is authoritative.
- Skipping the handoff "to save time" → the next session can't resume; this is the one step never to cut.
- Hard-blocking hooks for routine actions → prefer non-blocking helper commands and keep the human-approval checkpoints; they are a feature, not friction.
