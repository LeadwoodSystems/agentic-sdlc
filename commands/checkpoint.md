---
description: ASDLC sprint checkpoint — run targeted tests (<=3min), confirm handoff exists, update STATUS, stage (non-blocking)
argument-hint: [sprint-id]
---

Run the end-of-sprint checkpoint gate. This is a **non-blocking helper**: report the
result of each check, but never refuse or hard-block — the human decides whether to
proceed. Preserve the human-approval checkpoint.

Sprint: **$ARGUMENTS** (if empty, infer from the plan/handoff you have been working on).

Run these checks and report a pass/fail summary:
1. **Tests** — find the project's test command in `CLAUDE.md` (§ Run / verify) and run
   **targeted tests only**: the files/modules touched this sprint plus their direct
   dependents (use the project's impact-selection/filter flag — e.g. `--changed`,
   `-run`, path-scoped args). Do **not** run the full suite here; that cost belongs in CI,
   not the per-sprint gate. If targeted selection isn't possible for this project and the
   full suite must run, time-box it — if it won't finish in ~3 minutes, stop it, say so,
   and report the tests that did complete. Report the actual result (counts, failures) —
   evidence, not assertions. REQUIRED SUB-SKILL: superpowers:verification-before-completion.
2. **Mutation evidence (offered, never required)** — if this sprint added tests that a
   handoff will *cite as evidence* for an acceptance criterion or as guarding a named
   regression, offer to author a manifest and run:
   ```bash
   node scripts/asdlc/mutate.js <manifest.json> --dry-run   # check every anchor first
   node scripts/asdlc/mutate.js <manifest.json>
   ```
   Paste the Markdown table it prints into the handoff. **Every `GREEN` must be resolved in
   writing as HOLLOW (fix the test) or INERT (fix the mutation)** — an undecided GREEN is an
   unfinished thought, and read naively it manufactures a false "this test is weak" finding.
   State the rough cost when offering: the practice measured 30% of test wall-clock on the
   sprint it came from, so it is scoped to cited tests, not applied to every test. See
   `references/test-mutation-evidence.md`. **Its absence is never a gap to record in a
   handoff** — like `#review`, the human or agent decides.
3. **Handoff exists** — check `docs/handoffs/` for a file matching this sprint. If missing,
   say so and offer to run `/handoff`. The handoff is the one step never to skip.
4. **Update STATUS + CLAUDE.md pointer** — run:
   ```bash
   node scripts/asdlc/checkpoint-hooks.js <sprint-id> <date> <handoff-rel-path> <one-line summary>
   ```
   This appends the STATUS.md entry and rewrites only the marked pointer span in
   `CLAUDE.md`. Report what it printed; if it warns that the marker pair is missing,
   say so and offer to add the markers (see `references/claude-md-skeleton.md`) rather
   than hand-editing the file.
5. **Stage** — show `git status`; stage the sprint's changes (`git add`) on the working
   branch. Do **not** commit or push automatically — present the proposed commit and
   **STOP for the user's approval** (respect the project's git rules).

End with a short checklist: ✅/❌ tests · handoff · STATUS+pointer script ran · staged.
(Mutation evidence is optional — report it if it ran, and say nothing if it did not.)
Then remind: on approval, commit, then run
`node scripts/asdlc/finish-sprint.js <sprint-id> <sha> [issue-numbers...]` once the PR
merges, then `/clear` before the next sprint.
