---
description: ASDLC sprint checkpoint — run tests, confirm handoff exists, update STATUS, stage (non-blocking)
argument-hint: [sprint-id]
---

Run the end-of-sprint checkpoint gate. This is a **non-blocking helper**: report the
result of each check, but never refuse or hard-block — the human decides whether to
proceed. Preserve the human-approval checkpoint.

Sprint: **$ARGUMENTS** (if empty, infer from the plan/handoff you have been working on).

Run these checks and report a pass/fail summary:
1. **Tests** — find the project's test command in `CLAUDE.md` (§ Run / verify) and run the
   appropriate tier (inner-loop/impact selection for iteration; the FULL suite for a real
   checkpoint). Report the actual result (counts, failures) — evidence, not assertions.
   REQUIRED SUB-SKILL: superpowers:verification-before-completion.
2. **Handoff exists** — check `docs/handoffs/` for a file matching this sprint. If missing,
   say so and offer to run `/handoff`. The handoff is the one step never to skip.
3. **STATUS updated** — check that `docs/STATUS.md` (or the project's history file) has a
   line for this sprint; if not, draft the one-line entry and ask to append it.
4. **CLAUDE.md still thin** — flag if `CLAUDE.md` has grown per-sprint narrative that
   belongs in STATUS/handoff.
5. **Stage** — show `git status`; stage the sprint's changes (`git add`) on the working
   branch. Do **not** commit or push automatically — present the proposed commit and
   **STOP for the user's approval** (respect the project's git rules).

End with a short checklist: ✅/❌ tests · handoff · STATUS · thin CLAUDE.md · staged.
Then remind: on approval, commit, then `/clear` before the next sprint.
