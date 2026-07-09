---
description: Generate an evidence-bearing ASDLC handoff so a fresh session can resume
argument-hint: [sprint-id] [short name]
---

Write the handoff for this sprint so a fresh session resumes exactly here.

Sprint: **$ARGUMENTS** (if empty, infer from the plan you executed).

Do this:
1. Use the template at the `agentic-sdlc` skill's `references/handoff-template.md`.
2. Fill it from what actually happened this sprint — **evidence, not claims**: the exact
   run/verify commands, real test counts/output, files touched, key decisions + why,
   deferrals with where they pick up, and concrete next-sprint entry points.
3. Write it to `docs/handoffs/<sprint-id>-<slug>.md` (match the project's existing naming).
4. Draft the one-line `docs/STATUS.md` entry for this sprint (newest at the bottom).

The test: could a fresh session with clean context read ONLY this handoff (plus the thin
`CLAUDE.md`) and continue correctly? If not, add what's missing. Keep it to what the next
session needs — don't restate anything already durable in `CLAUDE.md`.
