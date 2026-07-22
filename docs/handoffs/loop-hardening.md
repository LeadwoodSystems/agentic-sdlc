# Loop Hardening — Handoff

**Date:** 2026-07-22
**Branch / commit:** `worktree-loop-hardening` @ `6af6afc` (plus this handoff's own commit on top)
**Status:** complete

> Note on file naming: this handoff predates the naming convention it introduces
> (`vMAJOR.MINOR-sN-<slug>.md`) — this plan built that convention, it wasn't built
> under it. It's filed at `docs/handoffs/loop-hardening.md` per the task brief.
> Everything from the *next* sprint onward should use the `vX.Y-sN-<slug>` scheme.

## Goal

Replace the mechanical/checkable parts of the agentic-sdlc state model — STATUS.md
bookkeeping, CLAUDE.md's current-state pointer, sprint-start gating, branch/milestone
hygiene, doc archival — with deterministic Node scripts, so drift observed over 100+
sprints of real usage (stale pointers, a 215KB hand-typed STATUS.md, un-deleted
branches, milestone/version scheme divergence) becomes structurally harder rather than
just discouraged in prose. Full rationale: `docs/superpowers/specs/2026-07-22-loop-hardening-design.md`.

## Scope delivered

- **Five Node scripts** under `scripts/asdlc/` (plain CommonJS, no external deps,
  all git/gh calls routed through one injectable `run()` helper in `lib/exec.js` so
  tests can stub them):
  - `new-sprint.js` — hard gate at sprint start (`checkGate`: blocks on an unmatched
    newest plan or an unmerged `sprint/*` branch; `--force` overrides with a loud
    warning) + `createSprint` (branch + seeded plan file from `_TEMPLATE.md`).
  - `checkpoint-hooks.js` — `appendStatusEntry` (append-only STATUS.md line writer,
    sanitizes newline/CR injection in every interpolated field) + `updateClaudeMdPointer`
    (rewrites only the text strictly between `<!-- asdlc:current-state:auto -->` /
    `<!-- /asdlc:current-state:auto -->` markers, byte-for-byte untouched elsewhere;
    throws loudly if markers are missing or if the summary text itself contains marker
    text, rather than silently corrupting the file).
  - `finish-sprint.js` — `markMerged` (flips one STATUS.md line's status field),
    `deleteBranch` (local + remote delete, with a scoped `-D` fallback only for the
    known squash-merge case — not a blanket force-delete), `checkMilestone` (reports,
    does not auto-assign, missing/mismatched milestones via `gh issue view`).
  - `gh-hygiene.js` — read-only audit: `findStaleBranches`, `checkDefaultBranch`
    (compares `origin/HEAD` to CLAUDE.md's declared trunk), `findUntriagedIssues`
    (no labels / no milestone), `checkMilestoneVersionSync` (milestone titles vs.
    current sprint version scheme), aggregated by `runHygieneAudit` with per-check
    failure isolation (one failing `gh` call doesn't take down the git-based checks).
  - `archive-sprint-docs.js` — `archiveMilestone` moves one milestone's handoffs/plans
    into per-type `archive/<milestone>/` subdirectories, with input validation against
    path traversal (`..`, path separators, non-alphanumeric characters) on the
    user-supplied `milestoneVersion` string.
- **Full test suite**: 63 tests across 7 files under `scripts/asdlc/test/`
  (`lib/exec.test.js`, `new-sprint.test.js`, `checkpoint-hooks.test.js`,
  `finish-sprint.test.js`, `gh-hygiene.test.js`, `archive-sprint-docs.test.js`,
  `end-to-end.test.js`), all run against throwaway git fixture repos created under
  the OS temp dir — never against a real project. See evidence table below.
- **New `/asdlc-hygiene` command** (`commands/asdlc-hygiene.md`) — thin wrapper
  around `gh-hygiene.js`; reports findings, suggests fixes, never auto-fixes (branch
  deletion and milestone assignment are judgment calls).
- **Nine documentation updates** to reflect the new scripted model:
  `README.md`, `skills/agentic-sdlc/SKILL.md`, `commands/bootstrap-asdlc.md`,
  `commands/sprint.md`, `commands/checkpoint.md`,
  `skills/agentic-sdlc/references/state-model.md`,
  `skills/agentic-sdlc/references/claude-md-skeleton.md`,
  `skills/agentic-sdlc/references/plan-template.md`,
  `skills/agentic-sdlc/references/handoff-template.md`. Also fixed a pre-existing
  internal-drift bug where `/verify-issue` was missing from README's command table
  despite being documented in SKILL.md and `commands/`.

Nearly every task went through at least one review-and-fix round; real bugs caught
along the way included: numeric (not lexicographic) plan-version sorting in the
sprint gate, `git for-each-ref`/porcelain branch-name parsing edge cases, path
traversal on user-supplied `milestoneVersion`/`sprintId`/`slug` strings, incomplete
newline/CR sanitization (initially only on `summary`, not all fields), an unscoped
`-D` force-delete fallback that would have silently force-deleted branches for any
`-d` failure reason (narrowed to the specific squash-merge case), an unscoped
`checkDefaultBranch` catch that swallowed real git errors alongside the expected
missing-`origin/HEAD` case, and a couple of documentation overclaims that
contradicted more careful wording introduced elsewhere in the same doc set.

## How to run / verify

```bash
# Full test suite (recursive — the test/ tree has a lib/ subdirectory)
node --test "scripts/asdlc/test/**/*.test.js"

# Individual scripts, run standalone from repo root
node scripts/asdlc/new-sprint.js <sprint-id> <slug> [--force]
node scripts/asdlc/checkpoint-hooks.js <sprint-id> <date> <handoff-rel-path> <summary...>
node scripts/asdlc/finish-sprint.js <sprint-id> <sha> [issue-numbers...]
node scripts/asdlc/gh-hygiene.js <declared-trunk> <current-sprint-version>
node scripts/asdlc/archive-sprint-docs.js <milestone>

# Doc cross-check (should find /verify-issue and /asdlc-hygiene in all three locations)
grep -rn "verify-issue\|asdlc-hygiene" README.md skills/agentic-sdlc/SKILL.md commands/
```

## Acceptance criteria → evidence

| Criterion | Result | Evidence |
|---|---|---|
| Full test suite passes, 0 failures | ✅ | `node --test "scripts/asdlc/test/**/*.test.js"` → `tests 63`, `pass 63`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0` |
| Each of the 5 scripts has dedicated coverage | ✅ | 7 test files, one per script + `lib/exec.js` + a chained `end-to-end.test.js` (bootstrap seed → `new-sprint` → `checkpoint-hooks`) |
| `/verify-issue` appears everywhere it should | ✅ | `README.md:45` (command table), `skills/agentic-sdlc/SKILL.md:25,37` (loop step 0 + Commands section), `commands/verify-issue.md` exists |
| `/asdlc-hygiene` appears everywhere it should | ✅ | `README.md:49,102` (command table + Common mistakes), `skills/agentic-sdlc/SKILL.md:44,71` (Commands section + Common mistakes), `commands/asdlc-hygiene.md` exists |
| No external npm dependencies | ✅ | `scripts/asdlc/` contains only `.js` files under CommonJS `require`; no `package.json`/`node_modules` added |
| All git/gh calls stubbable | ✅ | every script function accepts `{ runner = run }` and every test that touches git/gh either uses a real fixture repo or an injected stub runner |
| Path-traversal-safe on user input | ✅ | `archiveMilestone` rejects `..`/path-separator/non-alphanumeric `milestoneVersion` (see `archive-sprint-docs.test.js`); `createSprint` rejects invalid `sprintId`/`slug` (see `new-sprint.test.js`) |

## Key decisions & trade-offs

- **Explicit `<sprint-id>` CLI argument instead of auto-inference.** `new-sprint.js`
  and `finish-sprint.js` take the sprint id as an argument rather than trying to
  compute "the next one" from existing files. Auto-inference is exactly the kind of
  implicit-state logic that drifts silently; an explicit argument is one extra
  keystroke in exchange for the script's output always being exactly what was asked
  for, not a guess.
- **HTML-comment markers for the CLAUDE.md pointer, not a fixed line number/regex
  on content.** `<!-- asdlc:current-state:auto -->` / `<!-- /asdlc:current-state:auto -->`
  bound the exact span `updateClaudeMdPointer` may touch. This survives arbitrary
  reformatting of the rest of CLAUDE.md and, deliberately, throws rather than
  silently no-op'ing if the markers are missing or edited away — a missing marker is
  a loud failure, not a silently-stale pointer (the original failure mode this design
  targets).
- **Per-check failure isolation in `runHygieneAudit`.** The four hygiene checks run
  independently; a `gh`-based check failing (e.g. `gh` not authenticated) doesn't
  prevent the git-based checks from still reporting. An audit tool that fails
  entirely because one of four checks errored would defeat its own purpose.
- **Scoped `-d`/`-D` fallback for squash-merged branches in `deleteBranch`.** Plain
  `git branch -d` refuses to delete a branch git can't prove is merged, which is
  true for squash-merged branches even though they're safely done. The fallback to
  `-D` is scoped specifically to that detected case (not a blanket catch-all), and a
  genuine `-d` failure for an unrelated reason (e.g. actually unmerged) still
  propagates instead of being silently forced through.

## Deferred / known gaps

- **The gaw repo retrofit is explicitly out of scope for this plan and was not
  attempted.** Applying this scripted model to the real `gaw` (Governed_Autonomous_Workers)
  project that motivated this work — rebuilding its 215KB STATUS.md, fixing its
  CLAUDE.md self-contradiction, real branch/milestone cleanup via `gh-hygiene.js`,
  archiving pre-v0.9 docs — is tracked separately as its own isolated action (see the
  design spec's "Future work" section for the concrete steps), specifically so as
  not to disturb gaw's own active concurrent session. Nothing in `C:\Users\User\Documents\gaw`
  was touched by this plan.
- **`gh` CLI availability/auth is assumed, not verified upfront** by `finish-sprint.js`
  and `gh-hygiene.js`. Both fail with a clear per-check error rather than a raw stack
  trace if `gh` isn't installed/authenticated (see failure-isolation tests), but there's
  no preflight "is `gh` even on PATH" check.
- **Node as a new hard runtime dependency** for the plugin (previously needed nothing
  beyond Claude Code + `superpowers` + a GitHub-based repo) — an accepted trade-off
  per the design's risk section, not a gap, but worth restating: these scripts require
  Node on PATH.
- **`--force` on `new-sprint.js` is a raw override, not audited.** It bypasses the
  gate with a warning printed to the console, but nothing logs that an override
  happened anywhere persistent (e.g. STATUS.md). If `--force` gets misused
  repeatedly, there's currently no scripted way to notice that pattern after the
  fact.

## Next sprint

- **Goal:** either (a) pick up the gaw repo retrofit (in its own isolated worktree,
  per the design's "Future work" steps 1–5), or (b) start using this scripted model
  for real on the next agentic-sdlc-plugin sprint itself, exercising `/sprint` →
  `/checkpoint` → `finish-sprint.js` end-to-end on a live change rather than fixture
  repos.
- **Entry points:** `scripts/asdlc/` for the scripts themselves;
  `docs/superpowers/specs/2026-07-22-loop-hardening-design.md` for the retrofit's
  "Future work" section if picking up gaw.
- **Suggested first actions:** if resuming gaw work, first confirm gaw's
  `sprint/v0.12-s3`/`v0.12-s4` state has settled (per the design doc) before creating
  any new worktree there; if continuing plugin work, run `/bootstrap-asdlc` against
  a fresh scratch repo to dry-run the full scaffold end-to-end as a sanity check
  before relying on it in a real project.
