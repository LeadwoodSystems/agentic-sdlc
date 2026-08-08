# Findings from running v0.3-s3 end to end

**Date:** 2026-08-08
**Source:** sprint v0.3-s3 (`#18`, `#21`), merged as `d800bda` and `fb7be41`.
**Status:** proposal — no sprint ran to produce this file. Precedent:
`docs/2026-08-07-capability-layer-roadmap.md`.

Six findings surfaced while running one sprint through the full loop: plan → TDD →
review → handoff → checkpoint → PR → merge → `finish-sprint`. Four are defects in this
repo's own scripts. Two are methodology gaps that cost real rework.

Each is written to stand alone as a GitHub issue: symptom, evidence, root cause, proposed
solution. The suggested title and labels are at the end of each.

---

## 1. `finish-sprint.js` cannot delete the remote branch on a Windows/MSYS host

**Symptom.** `finish-sprint.js` exits 1 on its last step, every time, on the development
machine.

**Evidence.** Verbatim, from the v0.3-s3 run:

```
Marked v0.3-s3 as merged (d800bda) in docs/STATUS.md.
Deleted local branch sprint/v0.3-s3.
Could not delete sprint/v0.3-s3 on origin: git push origin --delete sprint/v0.3-s3 failed: 0 [main] sh (1728) C:\Program Files\Git\usr\bin\sh.exe: *** fatal error - add_item ("\??\C:\Program Files\Git", "/", ...) failed, errno 1
      1 [main] sh (19380) C:\Program Files\Git\usr\bin\sh.exe: *** fatal error - add_item ("\??\C:\Program Files\Git", "/", ...) failed, errno 1
error: unable to read askpass response from 'c:\Users\User\AppData\Roaming\Code\User\globalStorage\vscode.git\askpass\70789581cae28aa7\askpass.sh'
fatal: could not read Username for 'https://github.com': terminal prompts disabled
The REMOTE branch still exists. Finish by hand:
    git push origin --delete sprint/v0.3-s3
```

**Root cause.** The remote delete shells out to `git push origin --delete <branch>`, which
routes through git's credential/askpass path. On this host that path spawns an MSYS shell
(which dies with the `add_item` crash documented in `docs/2026-08-04-shell-strategy.md`)
and then falls back to a VS Code askpass helper that cannot prompt, because the runner
attaches no stdin. The push therefore cannot authenticate, regardless of whether the user
is authenticated to GitHub — and they are: `gh auth token` works, and the same delete
succeeds immediately through an explicit token header.

This is not a transient failure and retrying does not help. It is the single git operation
in the whole ASDLC toolchain that writes to a remote, so it is the only place this bites.

**Proposed solution.** Prefer `gh` for the remote delete, falling back to `git push`:

```js
// gh carries its own auth and never touches git's credential/askpass path.
gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/<branch>
```

`gh` is already a hard dependency of `gh-hygiene.js` and `/profile-issue`, so this adds no
new tooling and does not touch `#zero-dependencies` (which governs npm packages, not CLIs
already in use). Keep the `git push` path as the fallback for a repo without `gh`, and
keep the existing "finish by hand" message for when both fail.

The escape hatch in the user's global notes — building a `basic` auth header from
`gh auth token` — also works and is what unblocked this run, but it is more code and it
hardcodes the GitHub host.

> **Title:** `finish-sprint.js` remote branch delete fails through git's askpass path
> **Labels:** `bug`

---

## 2. `finish-sprint.js` mutates state before its most failure-prone step

**Symptom.** When step 3 fails, the operator is left in a half-finished state with a
non-zero exit, and the run cannot simply be repeated.

**Evidence.** The order in the v0.3-s3 run was: flip `docs/STATUS.md` to `merged` →
delete the local branch → attempt the remote delete → fail → exit 1. The two mutations
that succeeded are exactly the two that are hard to tell apart from "already done" on a
re-run.

**Root cause.** The only network operation, and the only step that can fail for reasons
outside the repo, runs last — after two local mutations have already landed. Ordering is
backwards relative to risk.

**Proposed solution.** Either:

- **Reorder** so the remote delete runs first, and the local mutations only follow a
  success; or
- **Make each step idempotent and report a per-step summary**, exiting non-zero once at
  the end. `STATUS.md` flipping is already effectively idempotent (flipping an
  already-`merged` entry is a no-op); local branch deletion needs a
  "already absent" branch.

The second is preferable: it keeps the useful property that a partial run still records
the merge, while making a re-run safe. The current behaviour is defensible for a human
reading the output — it says exactly what to do by hand — but it is a trap for anything
that wraps the script and checks the exit code.

Related: this interacts with finding 1. Fixing 1 makes 2 much rarer but does not make it
safe.

> **Title:** `finish-sprint.js` is not safe to re-run after a partial failure
> **Labels:** `bug`

---

## 3. `finish-sprint.js` writes `docs/STATUS.md` into whatever branch is checked out

**Symptom.** The `STATUS.md` flip landed as an uncommitted edit on an unrelated branch.

**Evidence.** In the v0.3-s3 run the script was invoked while `HEAD` was on
`docs/v0.3-s3-residual-touchups` — a follow-up branch, not the sprint branch and not
`main`. The script deleted `sprint/v0.3-s3` and wrote the `awaiting-merge → merged` flip
into the working tree of the branch that happened to be current. The edit had to be
committed onto that follow-up branch and carried to `main` through a second PR.

**Root cause.** The script edits `docs/STATUS.md` in the current working tree without
asserting which branch that is. Its implicit assumption is that the operator is on the
trunk, which is the normal case — but nothing checks it, and the script itself deletes the
one branch you might plausibly have been on.

**Why it matters more than it looks.** `docs/STATUS.md` is machine-owned; the whole point
of the state model is that its history cannot drift. An unnoticed flip written onto a
feature branch either gets lost when that branch is discarded, or silently rides a PR that
has nothing to do with the sprint being closed. Both are the drift the file exists to
prevent.

**Proposed solution.** Before writing, resolve the current branch and compare it to the
trunk argument. If they differ, either refuse with a clear message naming both, or proceed
and state loudly which branch received the edit. Refusing is more in keeping with
`new-sprint.js`'s gate, which is the repo's one deliberate hard block; but this script is
otherwise advisory, so a loud warning plus the branch name may fit better. Worth deciding
explicitly rather than by omission.

> **Title:** `finish-sprint.js` should assert the trunk is checked out before writing STATUS.md
> **Labels:** `bug`

---

## 4. `mutate.js --dry-run` requires a clean tree, which makes the natural authoring order impossible

**Symptom.** A plan step order of *write manifest → dry-run the anchors → run for real →
commit* cannot be executed.

**Evidence.** `scripts/asdlc/mutate.js:282` calls `assertCleanTree(cwd, { runner })` in the
first line of `runCli`'s `try` block, gated only by `--allow-dirty` — never by
`--dry-run`. The dry-run branch is reached later, inside `runMutations`. A newly written, untracked manifest file
therefore makes the tree dirty and blocks even a dry run. v0.3-s3's implementer had to
commit the manifest before it had ever been validated, and disclosed the deviation; a
reviewer read the source and confirmed the reordering was forced rather than a shortcut.

**Root cause.** The clean-tree guard exists so that a real mutation run can prove its
reverts are clean. `--dry-run` does not apply mutations to disk, so it does not need that
guarantee — but it inherits the guard because the check runs before the branch.

**Proposed solution.** Skip `assertCleanTree` when `--dry-run` is set, so anchors can be
validated before the manifest is committed. If there is a reason the guard must hold for
dry runs too, then document the precondition in
`skills/agentic-sdlc/references/test-mutation-evidence.md` so plans stop being written
against an order the tool cannot execute.

Either fix is small; the current state is the worst of the two, because the constraint is
real but written down nowhere.

> **Title:** `mutate.js --dry-run` should not require a clean working tree
> **Labels:** `bug`, `documentation`

---

## 5. Nothing checks that a mutation manifest's anchors still resolve

**Symptom.** Editing a line that a manifest anchors on silently invalidates committed
mutation evidence.

**Evidence.** v0.3-s3's `WIDEDIAGRAM` mutation anchored on a specific `README.md` line. A
review then required that exact line to be reworded. `lib/apply-mutation.js:39-40` returns
`ANCHOR-MISS` when an anchor no longer matches — loud *if the harness is re-run*, and
completely silent if it is not. The manifest is a committed artifact that a handoff cites
as evidence; nothing in the suite notices when it stops corresponding to reality.

The same hazard applies to `AMBIGUOUS-ANCHOR`: v0.3-s3's `FENCEPLAIN` anchors on the
string ` ```text `, and is valid *only* because exactly one such fence exists in
`README.md`. That invariant was verified by hand, once, at implementation time.

**Root cause.** Mutation manifests are checked only when someone chooses to run the
harness, which is a deliberate, occasional act because it is expensive. Between runs, the
evidence can rot without any signal.

**Proposed solution.** Add a cheap test — no mutation, no test execution — that walks every
manifest under `docs/mutation-manifests/` and asserts each `find` string occurs **exactly
once** in its target file. That is a file read and a substring count per mutation, costs
milliseconds, and converts both `ANCHOR-MISS` and `AMBIGUOUS-ANCHOR` from
discovered-on-next-run into caught-at-commit.

This generalises beyond documentation: the same rot happens when a refactor moves a line
of code a manifest anchors on.

> **Title:** Add a test that every mutation manifest's anchors still resolve uniquely
> **Labels:** `enhancement`, `testing`

---

## 6. A wording fix scoped to one location left the same defect in place elsewhere

**Symptom.** A factual error was found, ruled on, and fixed — and shipped anyway, in a
second location in the same file.

**Evidence.** v0.3-s3's walkthrough credited `/checkpoint` with producing "a staged
commit". It does not; it stages changes and stops (`commands/checkpoint.md:45-47`). The
error was caught by an independent re-walk, escalated, and ruled on. The fix instruction
named the table cell — `README.md:119` — and said to change only that cell. The identical
phrase at `README.md:47`, inside the diagram, was untouched, so the branch carried the
corrected and uncorrected wording 72 lines apart. The final whole-branch review caught it
as a Critical.

Two further pre-existing occurrences (`README.md:76`, `README.md:142`) and two in the
sprint's own design spec were found later still.

**Root cause.** Two compounding scoping errors:

1. The blind re-walk that found the defect was scoped to the walkthrough's rows, so it
   structurally could not see the diagram.
2. The fix instruction was scoped to the location where the defect was *reported*, not to
   the defect itself. Nobody searched the file for the phrase.

**Proposed solution.** A rule in
`skills/agentic-sdlc/references/` — most plausibly alongside the review guidance:

> When a review finds a **wording** defect, the fix is scoped to the phrase, not to the
> location. Search the repository for the phrase before dispatching the fix, and list every
> occurrence in the fix instruction — including the ones deliberately left alone, with the
> reason.

The general form is worth stating too: a per-task review verifies a task against its brief
and cannot see across tasks, so a class of defect that recurs in another task's output is
invisible to it by construction. That is what the whole-branch review is *for*, and it is
an argument against skipping it when tasks look individually clean.

Related: the sprint's own design spec still prescribed the wrong wording after the README
was fixed, and was corrected only in a follow-up. `docs/superpowers/specs/` holds durable
design decisions that later sessions re-derive from, so a spec left uncorrected reintroduces
the defect. Correcting a spec should also record *why* it changed — a silently fixed spec
teaches nothing.

> **Title:** Scope wording fixes to the phrase, not the reported location
> **Labels:** `documentation`, `process`

---

## Suggested sequencing

1 and 3 are the ones that bite every sprint on this host and both touch
`finish-sprint.js`; doing them together is one small change to one file with one set of
tests. 4 is a one-line guard. 5 is the highest value per line of code — it closes a silent
evidence-rot path for every future sprint. 2 is worth doing but is mostly mitigated by 1.
6 is prose and can land with any of them.

None of these blocked v0.3-s3. All of them cost time in it.
