---
description: Start an ASDLC sprint — scaffold its plan and kick off brainstorm→plan
argument-hint: [sprint-id] [short name]
---

Start a new sprint in this project's Agentic SDLC.

Sprint: **$ARGUMENTS** (if empty, infer the next sprint id from the newest file in
`docs/handoffs/` and ask the user for a short name).

Do this:
1. **Load context** — read `CLAUDE.md` and the **latest** `docs/handoffs/` file to
   understand current state and the suggested next steps. Do NOT read all of history.
2. **Brainstorm the scope** with the user. REQUIRED SUB-SKILL: superpowers:brainstorming.
3. **Write the plan** to `docs/superpowers/plans/<date>-<sprint-id>-<slug>.md` using the
   template at the `agentic-sdlc` skill's `references/plan-template.md`. REQUIRED
   SUB-SKILL: superpowers:writing-plans.
4. **Confirm the plan** with the user before touching code. Then build test-first
   (REQUIRED SUB-SKILL: superpowers:test-driven-development).

Keep the plan concise: context (why), scope (in/out), dependency-ordered tasks, the
test plan, and the evidence to capture for the handoff. Stop after the plan is approved.
