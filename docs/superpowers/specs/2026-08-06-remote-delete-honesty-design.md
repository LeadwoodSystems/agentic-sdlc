# Remote-delete honesty — design

**Date:** 2026-08-06 · **Sprint:** v0.2-s8 · **Status:** approved

## The defect

`finish-sprint.js` reports that it deleted a sprint branch "local + remote if present"
when it has deleted only the local one. Observed live on 2026-08-06: `sprint/v0.2-s7`
survived on GitHub after a `finish-sprint.js` run that exited 0, and was removed by hand.

The cause is `finish-sprint.js:104-119`:

```js
let remote = '';
try {
  remote = runner('git', ['ls-remote', '--heads', 'origin', branchName], { cwd });
} catch (err) {
  return;
}
```

The comment above it names the case it means to tolerate — *"If there's no `origin` remote
at all (e.g. local-only testing scenarios), that's fine to swallow since there's nothing to
delete."* The code does not implement that. `git ls-remote` exits 128 for **every** reason
it can fail: no such remote, authentication refused, network unreachable, and — on this
development machine — the Git-for-Windows MSYS `add_item (…) failed, errno 1` crash
(`docs/2026-08-04-shell-strategy.md`). A bare `catch { return }` cannot distinguish an
expected absence from a genuine failure, so it treats all of them as "nothing to delete",
skips the `push --delete`, and returns to a caller that prints success.

The next comment in the file states the correct principle and is the one the code violates:
*"A genuine failure here (auth failure, branch protection, network issue) is an actionable
error and must propagate to the caller, not be swallowed."* That is true of `push --delete`,
which is not wrapped — but unreachable, because the swallow happens one step earlier.

**This recurs.** The MSYS failure is a standing condition on this machine, not an incident,
so every sprint that finishes here can leave the same debris.

## The second half: nothing detects it

Both cleanup gates scan local refs only:

- `new-sprint.js:88-95` — `for-each-ref refs/heads/sprint/*`
- `gh-hygiene.js:10-13` — `for-each-ref refs/heads/sprint/*`

The local branch **is** deleted successfully, so the surviving remote branch is invisible to
both. The prevention is broken and the detection was never built; `sprint/v0.2-s7` was found
by a human noticing it, which is the failure mode `/asdlc-hygiene` exists to remove.

## Design

### Part 1 — distinguish absence from failure

Ask a question that cannot fail for network, auth, or MSYS reasons:

```
git config --get remote.origin.url
```

A local config read. It cannot reach the network, so nothing about auth, connectivity or MSYS
can reach it — it is the question the existing comment was actually trying to ask.

Its exit code is discriminated the way `lib/branch-status.js:53-60` already discriminates
`git diff --quiet`'s: **exit 1 means the key is absent**, which is an answer. Anything else
(a corrupt config, not a git repository) is a broken invocation and propagates. Swallowing
those would rebuild the same defect one level down.

- **No `origin`** → return, having done nothing. The original intent, now implemented.
- **`origin` exists** → any failure of `ls-remote` or `push --delete` is genuine and is
  reported.

`deleteBranch` returns a result rather than throwing, following the pattern
`removeWorktreeForBranch` established at `finish-sprint.js:148-196` — *"Returns a reportable
result rather than throwing on the expected outcomes, so main() can print a specific
diagnostic instead of a stack trace"*:

```
{ remote: 'deleted' }
{ remote: 'absent' }     // origin exists, branch is not on it
{ remote: 'no-origin' }  // no origin configured
{ remote: 'failed', error }
```

The result describes the **remote** outcome only. There is no `local` field: the local delete
either succeeded or threw, so a returning `deleteBranch` has always done it, and a field that
is always `true` is a field a caller learns to skip reading.

`main()` on `failed` prints the underlying git error, names the branch that survives on the
remote, prints the literal command to finish by hand, and sets `process.exitCode = 1`.

Throwing was considered and rejected. By this point `markMerged` has rewritten `STATUS.md`
and the local branch is gone, so a throw produces a raw stack trace on a half-applied
finish — the exact outcome the `resolveSprintBranch` note (`finish-sprint.js:14-19`) records
as having already happened once, and was written to prevent recurring.

**The success line changes deliberately.** `Deleted branch ${branchName} (local + remote if
present)` is unconditional, and is the sentence that lied. The local delete and the remote
outcome are separately true and are reported separately.

Reordering `main()` so that nothing is half-done on failure (moving `deleteBranch` ahead of
`markMerged`) was considered and deferred: it is a real improvement, but it changes a step
order several existing tests assert on, and it is a different concern from the swallow.

### Part 2 — make the debris visible

`findStaleRemoteBranches(cwd, { trunk, runner })` in `gh-hygiene.js`:

1. `git ls-remote --heads origin "refs/heads/sprint/*"` → branch names and SHAs. Authoritative:
   never stale, and it sees branches pushed from any clone.
2. Filter with the existing `isBranchMerged` (`lib/branch-status.js`). "Stale" keeps exactly
   the local check's meaning — a merged PR, or work already in trunk — applied to a different
   ref space. A sprint in flight is unmerged and is therefore not reported.
3. Per-branch error isolation, mirroring `checkMilestone`'s per-issue handling
   (`finish-sprint.js:199-219`), so one unresolvable ref cannot blank the whole check.

Wired into `runHygieneAudit` as `staleRemoteBranches` through the existing `safeCheck`
(`gh-hygiene.js:264-281`), with its own report line and the `git push origin --delete`
remedy. It gets a separate line from `Stale merged branches` because the two findings need
different commands, and a merged line could not say which applied.

**Rejected: reading `refs/remotes/origin/sprint/*`.** Free and offline, but it reads a cache
only as fresh as the last `fetch --prune`. It reports branches already deleted on the remote
and misses ones pushed elsewhere. An audit that can be confidently wrong is what
`.asdlc/facts.json` exists to prevent.

**The network cost is acceptable and its failure is honest.** The audit already shells out to
`gh` three times. On a machine where git networking is broken, `safeCheck` degrades this one
to `could not check (…)` — which is the true answer, and the same signal Part 1 produces.

## Testing

TDD throughout, against the injected `runner` (`#runner-injection`). No test touches a real
remote.

| Test | What it pins |
|---|---|
| `origin` absent → `no-origin`, no `ls-remote`, no throw | the original intent survives the fix |
| `origin` present, `ls-remote` throws → `remote: 'failed'` | **the defect** |
| `origin` present, `push --delete` throws → `remote: 'failed'` | the same path's second half |
| `main()` on a failed remote → exit 1, branch named in output | the false success is gone end-to-end |
| `main()` on a clean run → exit 0, unchanged | no new noise on the happy path |
| `findStaleRemoteBranches` → merged reported, unmerged not | Part 2's core |
| one unresolvable ref → the other branches still reported | error isolation |

The five existing `deleteBranch` tests (`test/finish-sprint.test.js:173-345`) change shape
because the function returns a value, and keep their assertions.

Mutation manifest anchored on the new assertion messages, per `#review`.

## Out of scope

- Reordering `main()`'s steps (above).
- The carried-forward gaps in the v0.2-s7 handoff's *Deferred* section.
- Any `.ps1` port.
