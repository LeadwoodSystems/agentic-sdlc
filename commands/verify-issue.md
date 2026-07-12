---
description: Adversarially verify a tracked issue against the current codebase before sprinting on it
argument-hint: [issue-id]
---

Adversarially check whether issue **$ARGUMENTS** still matches the codebase as it exists
right now, before it becomes sprint work. Issues drift: they get written speculatively
(architecture wishlists), get overtaken by later sprints, or reference entities that were
renamed, merged, or never built the way the issue assumed. Planning a sprint against a
stale issue wastes the sprint. This command exists to catch that **before** `/sprint`,
not after.

Use it when an issue is: architectural/speculative rather than a small direct fix; older
relative to the project's pace (a lot has shipped since it was filed); explicitly flagged
by the user as needing a codebase-alignment check; or about to be picked up for
implementation and hasn't been touched since it was filed. Don't run it on every issue —
it's a multi-pass research effort, reserve it for issues about to become real work.

Do this:

1. **Read the issue in full** — title, body, labels, linked issues/PRs, whatever the
   tracker attaches (milestone, project status, blocked-by/blocking relationships).

2. **Research the codebase directly against every factual/technical claim the issue
   makes** — don't skim, read the actual files. For each entity, API, pattern, or
   architectural assumption the issue names, find out: does it exist? Under what name?
   Does it already do what the issue assumes needs building? Has something the issue
   depends on changed since it was filed (check recent commits/branches touching the
   same files)? Cross-check against the project's own durable docs (`CLAUDE.md`,
   `docs/STATUS.md`, the latest `docs/handoffs/` entry) for anything that contradicts
   the issue's premise.

3. **Draft an adapted version of the issue**, grounded in what you actually found:
   - An "already exists as" table/section mapping each proposed thing to its real
     counterpart in the codebase, with file:line citations — don't let scope balloon
     for infrastructure that's already built.
   - A "does NOT do" / cut-scope section listing what you removed or deferred and
     **why** (YAGNI risk, speculative for a single-customer/single-provider system,
     overlaps another open issue, no real target to build against yet, etc.).
   - Real Non-Goals, Acceptance Criteria, and Test Coverage sections rewritten against
     the actual codebase shape, not the original's illustrative pseudocode/interfaces.
   - A Sequencing section identifying genuine blocking relationships to other open
     issues (based on real file/logic overlap you found in step 2, not assumed) and a
     milestone recommendation (or an explicit "leave unassigned, this is blocked"
     call).
   Write the draft to a scratch file — don't push yet.

4. **Adversarially fact-check the draft against the repo**, independent of the drafting
   pass — dispatch a fresh reviewer (a subagent with no memory of why you wrote what you
   wrote) whose only job is to try to refute every claim in the draft against the actual
   current code, report CONFIRMED / WRONG / NEEDS-CORRECTION per claim with file:line
   evidence, and flag anything the draft got backwards, overstated, or missed (a simpler
   existing mechanism it should have used instead of proposing something new, a claim
   that's technically true but misleading, a dependency risk that's overstated or
   understated). This step is what makes it *adversarial* — drafting and fact-checking
   must not share the same blind spots, so don't skip it or merge it into step 3.

5. **Incorporate every correction** the adversarial pass surfaced. Don't cherry-pick —
   if a claim was wrong, fix it in the draft; if a citation was imprecise, correct it;
   if a dependency claim was overstated, soften it to match the evidence.

6. **Apply the project's own sequencing conventions** — whatever labels, milestones,
   project-board columns, and blocking-relationship mechanism the tracker already uses
   for other issues (inspect a few comparable existing issues first; don't invent a new
   taxonomy). Push the corrected issue back to the tracker.

The test: could someone pick up this issue today and build exactly what it now says,
without hitting a "wait, that doesn't exist" or "wait, this was already built"
surprise in the first hour? If not, the verification pass wasn't thorough enough.

See `references/issue-verification-methodology.md` (in the `agentic-sdlc` skill) for the
detailed drafting structure and a reusable adversarial-reviewer prompt template.
