# Loop Hardening — Design

**Date:** 2026-07-22
**Branch:** worktree-loop-hardening

## Context (why)

The agentic-sdlc concept has been exercised for ~100+ sprints in a real repo (`gaw` / Governed_Autonomous_Workers). That gave enough evidence to see where the concept, as currently prose-only, breaks down under real momentum:

- **State pointers drift.** CLAUDE.md's "current state" line and STATUS.md's summary header both went stale (CLAUDE.md ~11 sprints behind; STATUS.md still listed superseded programs as "in progress"), because they're hand-edited and hand-editing gets skipped under momentum.
- **STATUS.md violates its own rule.** The project's own documented rule is "reference, never mirror," but in practice STATUS.md became a 215KB wall of retyped narrative (one line was 18,249 characters), fell out of chronological order, and lagged actual merge state ("awaiting sign-off" on sprints already merged).
- **CLAUDE.md self-contradicted** — one section said `main` is trunk, an un-updated rule elsewhere still said commit to the retired `build/v0.1`.
- **File accumulation, no archival.** 199 handoffs + 187 plans, three different naming schemes over the project's life, nothing ever pruned.
- **Milestone tracking lapsed** — three sprint cycles (v0.10–v0.12) ran with no milestone assigned; the milestone version scheme (v0.1–v1.0) diverged from the sprint version scheme (v0.9–v0.12); no due dates on any milestone.
- **Branch hygiene decayed** — 7+ stale merged branches never deleted; a real incident where GitHub's default branch stayed on the retired `build/v0.1`, causing duplicate PRs.
- **Process eroded under momentum** — a new sprint worktree was created while the prior sprint was still uncommitted, directly bending the "checkpoint and STOP" rule, which today is worded as purely advisory/non-blocking.
- **The gaps got filled anyway, just informally** — the gaw repo independently built `scripts/asdlc/{new-sprint,finish-sprint,gh-hygiene,gh-project}.ps1` to cover exactly what the generic plugin left as prose convention. Real usage re-invented the automation the concept should have shipped.

Goal of this design: hold the same loop's spirit (plan → build TDD → verify → adversarial review → handoff → checkpoint → stop) but replace the mechanical/checkable parts of the state model with deterministic scripts, so drift of this kind becomes structurally harder, not just discouraged in prose. Judgment-heavy steps (plan, build, verify, adversarial review) stay prose — scripts only take over bookkeeping and gating.

## Scope

**In:**
- New `scripts/asdlc/*.js` (Node, no external deps) shipped by the plugin and scaffolded by `/bootstrap-asdlc`.
- Updates to `/sprint`, `/checkpoint`, and `/bootstrap-asdlc` to invoke those scripts.
- New `/asdlc-hygiene` command wrapping the hygiene audit.
- `state-model.md`, `claude-md-skeleton.md`, `plan-template.md`, `handoff-template.md` updated to reflect: auto-generated STATUS.md, a non-hand-edited CLAUDE.md pointer line, one canonical file-naming scheme, milestone/sprint version-sync rule, and archival-by-milestone.
- README fixed to include `/verify-issue` (existing internal drift).

**Out (this pass):**
- The actual gaw repo retrofit (STATUS.md rebuild, CLAUDE.md fix, branch cleanup, milestone backfill) — deferred to a separate, later isolated action so as not to disturb gaw's active concurrent session (uncommitted `sprint/v0.12-s3` work, freshly created `v0.12-s4` worktree). Section "Future work" below records the plan for when that's picked up.
- Any change to the plan/build/verify/adversarial-review prose steps themselves — those are out of scope; only the bookkeeping/gating layer changes.

## Approach

Add a `scripts/asdlc/` directory of small, dependency-free Node scripts that shell out to `git`/`gh`. Commands that today tell Claude to hand-edit state files instead tell it to run a script. This makes the previously-prose "STATUS.md references, never mirrors" and "keep CLAUDE.md's current-state pointer accurate" rules structurally enforced rather than aspirational.

### Scripts (all under `scripts/asdlc/`, invoked via `node scripts/asdlc/<name>.js`)

1. **`new-sprint.js <slug>`** — Hard gate at sprint start. Refuses (non-zero exit, specific message) if either:
   - the newest plan file in `docs/superpowers/plans/` has no matching handoff in `docs/handoffs/` yet, or
   - a sprint branch exists that is ahead of `main` and not yet merged.

   A `--force` flag overrides for intentionally-parallel work. On success: creates `sprint/vX.Y-sN` branch, seeds `docs/superpowers/plans/vX.Y-sN-<slug>.md` from the template.

2. **`checkpoint-hooks.js`** — Run at the end of `/checkpoint`, after the human-reviewed commit is staged.
   - Appends one line to `docs/STATUS.md`: sprint id, date, one-line summary (pulled from the handoff's title/goal), link to the handoff file, status `awaiting-merge`. Never retypes narrative; never touches existing lines (append-only, and it enforces order by always appending at the end).
   - Rewrites the single "current state" line in `CLAUDE.md` (marked with an HTML comment identifying it as script-owned) to point at the new handoff. This is the one line in CLAUDE.md that's no longer hand-edited.

3. **`finish-sprint.js <sprint-id>`** — Run once a sprint's PR merges.
   - Flips that STATUS.md entry's status from `awaiting-merge` to `merged` + commit SHA.
   - Deletes the local and remote sprint branch.
   - Checks the merged issue(s)' milestone against the current sprint version; if missing/mismatched, prints a prompt for the human/agent to assign one (does not auto-assign — milestone choice is a judgment call).

4. **`gh-hygiene.js`** — On-demand audit, also usable as an `/asdlc-hygiene` command or in CI. Reports (does not fix):
   - stale merged branches still present,
   - whether `origin/HEAD` matches the trunk branch declared in CLAUDE.md,
   - issues with no labels or no milestone,
   - milestones whose version scheme has drifted from the current sprint version scheme,
   - milestones with no due date (informational only — not everyone wants due dates).

5. **`archive-sprint-docs.js <milestone>`** — Run manually at milestone close. Moves that milestone's handoffs/plans into `docs/handoffs/archive/<milestone>/` and `docs/superpowers/plans/archive/<milestone>/`, keeping the live directories to the current milestone's worth of files.

### Naming scheme (canonicalized)

Both plans and handoffs: `vMAJOR.MINOR-sN-<slug>.md`. This is documented explicitly in `plan-template.md`/`handoff-template.md` rather than left as "match the project's existing convention."

### Template/reference changes

- `claude-md-skeleton.md`: the "Where the build is" line gets an HTML comment marking it script-owned (`<!-- auto-updated by scripts/asdlc/checkpoint-hooks.js, do not hand-edit -->`).
- `state-model.md`: STATUS.md's description changes from "append-only running log" (implicitly hand-written) to "append-only, machine-generated only — never hand-edited; corrections happen by re-running the script, not by typing into the file." Adds the milestone/sprint version-sync rule and the canonical naming scheme as first-class rules, not per-project conventions.
- `plan-template.md` / `handoff-template.md`: naming convention section added.

### Command changes

- `/bootstrap-asdlc`: also scaffolds `scripts/asdlc/*.js` (skip-if-exists, same non-destructive posture as today for all other files).
- `/sprint`: first step becomes running `new-sprint.js`; if it refuses, surface the reason and stop rather than proceeding.
- `/checkpoint`: last step becomes running `checkpoint-hooks.js` instead of instructing hand-edits to STATUS.md/CLAUDE.md.
- New `/asdlc-hygiene`: thin command wrapping `gh-hygiene.js`, reports findings, does not auto-fix (fixes are judgment calls — e.g. deciding which milestone).
- README: add `/verify-issue` to the command table/layout (fixes existing internal drift where SKILL.md/commands/ include it but README omits it).

## Test plan (TDD — write these first)

Since these are the plugin's first real scripts, each gets a small test run against a throwaway git repo fixture created in a temp directory (never against gaw or any real project):

- `new-sprint.js`: fails with a specific message when an unmerged sprint branch exists; fails when the newest plan has no matching handoff; succeeds and creates the expected branch/file when neither condition holds; `--force` bypasses both checks.
- `checkpoint-hooks.js`: given a fixture repo with one handoff, produces exactly one well-formed STATUS.md line (correct fields, appended at the end) and rewrites only the marked pointer line in CLAUDE.md, leaving the rest of the file untouched.
- `finish-sprint.js`: flips a fixture STATUS.md line's status field and deletes a fixture branch; correctly detects and reports a missing/mismatched milestone via a stubbed `gh` call.
- `gh-hygiene.js`: against a fixture with a known stale branch, mismatched `origin/HEAD`, and an unlabeled issue (stubbed `gh` responses), reports all three findings and nothing else.
- `archive-sprint-docs.js`: given a fixture with mixed-milestone files, moves only the targeted milestone's files into `archive/<milestone>/`, leaves others in place.

## Verification (evidence to capture for the handoff)

- Each script's test suite passing (command + output pasted into the handoff).
- A full dry-run of `/bootstrap-asdlc` → `/sprint` → `/checkpoint` against a fresh scratch repo, with the resulting STATUS.md/CLAUDE.md/plan/handoff files shown to confirm the new behavior (single-line STATUS entry, unchanged-except-pointer CLAUDE.md).
- README/SKILL.md/commands cross-check confirming `/verify-issue` now appears everywhere it should.

## Risks / open questions

- **Node as a new hard dependency.** The plugin previously required nothing beyond Claude Code + `superpowers` + a GitHub-based repo. Shipping Node scripts adds a runtime dependency. Mitigation: scripts are plain Node with no npm install step (no `package.json`/`node_modules` needed), so the bar is just "Node is on PATH," which is common but not universal — worth flagging to the user as an accepted tradeoff rather than silently assumed.
- **`gh` CLI availability/auth** is assumed by `finish-sprint.js` and `gh-hygiene.js` (both need to query issues/milestones). If `gh` isn't installed/authenticated, these scripts should fail with a clear message, not a stack trace.
- **`--force` override on `new-sprint.js`** could be mis-used to silently re-normalize the exact bad behavior this design is meant to prevent. Mitigation: the command should still print a loud warning and require the flag to be explicit, never inferred.

## Future work (deferred, not in this pass)

Once this design is implemented and merged, retrofit gaw as the first real validation, in its own isolated worktree, only after confirming gaw's active concurrent session (sprint/v0.12-s3 / v0.12-s4) has settled:

1. Re-run `/bootstrap-asdlc` to scaffold the new scripts (skip-if-exists is safe).
2. One-time STATUS.md rebuild: parse the existing file's sprint identifiers, regenerate in the new one-line-per-entry format, reconciling merged-vs-awaiting status against real git/gh state, replacing the 215KB version.
3. Fix CLAUDE.md's contradiction directly (remove the stale rule referencing `build/v0.1`, correct the current-state pointer to the real latest handoff).
4. Run `gh-hygiene.js` for real: delete stale branches, fix `origin/HEAD`, retro-assign v0.10–v0.12 to a milestone, triage issue #105.
5. One-time archive pass: move pre-v0.9 handoffs/plans into `archive/`.
