---
description: Start an ASDLC sprint — scaffold its plan and kick off brainstorm→plan
argument-hint: [sprint-id] [short name]
---

Start a new sprint in this project's Agentic SDLC.

Sprint: **$ARGUMENTS** (if empty, infer the next sprint id from the newest file in
`docs/handoffs/` and ask the user for a short name).

Do this:
1. **Run the sprint gate** — `node scripts/asdlc/new-sprint.js <sprint-id> <slug>`. If it
   refuses (unmatched-plan or unmerged-branch), surface the exact reason to the user and
   **stop** — do not proceed to brainstorming until it's resolved, unless the user
   explicitly asks to override with `--force` (and understands why the gate exists).
2. **Load context** — read `CLAUDE.md` and the **latest** `docs/handoffs/` file to
   understand current state and the suggested next steps. Do NOT read all of history.
3. **Brainstorm the scope** with the user. REQUIRED SUB-SKILL: superpowers:brainstorming.
4. **Fill in the plan** at the path `new-sprint.js` created (seeded from
   `references/plan-template.md`). REQUIRED SUB-SKILL: superpowers:writing-plans.
5. **Confirm the plan** with the user before touching code. Then build test-first
   (REQUIRED SUB-SKILL: superpowers:test-driven-development).

Keep the plan concise: context (why), scope (in/out), dependency-ordered tasks, the
test plan, and the evidence to capture for the handoff. Stop after the plan is approved.
