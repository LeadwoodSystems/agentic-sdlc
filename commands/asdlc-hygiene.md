---
description: Run the ASDLC hygiene audit (stale merged branches, stale remote sprint branches, stale worktrees, default branch, untriaged issues, milestone/sprint version sync, failing scheduled workflows)
argument-hint: [declared-trunk] [current-sprint-version]
---

Run the read-only ASDLC hygiene audit and report findings. This command never
auto-fixes anything — fixes (which branch to delete, which milestone to assign)
are judgment calls for the human/agent to make after seeing the report.

Arguments: **$ARGUMENTS** — `<declared-trunk> <current-sprint-version>` (e.g. `main v0.12`).
If omitted, infer the declared trunk from `CLAUDE.md`'s branch-discipline line and the
current sprint version from the newest file in `docs/superpowers/plans/`.

Run:
```bash
node scripts/asdlc/gh-hygiene.js <declared-trunk> <current-sprint-version>
```

Present the seven findings (stale merged branches, stale remote sprint branches, stale
worktrees, default branch, untriaged issues, milestone/sprint version sync, failing
scheduled workflows) as a short report. Each check is isolated, so a failure in one still leaves the
others reported: if a `gh`-based check (untriaged issues, milestone/version sync, or
failing scheduled workflows) could not run — e.g. `gh` isn't authenticated, there's no
GitHub remote, or the network is unavailable — the tool still reports the git-based
findings rather than failing outright. Note which check(s) could not run and why, rather
than treating it as a hard failure. **Stale remote sprint branches** is a third category:
a `git` command (`git ls-remote`), not a `gh` one, but one that still needs the network to
reach `origin` — so `could not check (…)` on that line is the same honest degradation as
on a `gh`-based line, not a bug in the audit.

**Untriaged issues** is fetched with an explicit cap; if the `Untriaged issues` line ends
in `TRUNCATED: …`, the repo had at least that many open issues and the list is bounded, not
complete — do not treat it as the whole worklist.

**Issues carrying a `kind/` label are exempt from `no-execution-profile`** — an epic or a
decision ticket is never executed directly, so no execution class could ever be assigned to
it and the finding could never be cleared. The exemption is scoped to that one reason: a
`kind/`-labelled issue is still reported for `no-labels` and `no-milestone`. Epics trade the
profile check for `epic-without-open-sub-issues`, which fires when nothing open sits under
the tracker — either it is finished and should be closed, or it was never decomposed. The
check reads the open-issue list, so an epic whose sub-issues have all been closed will be
flagged; the reason is named for what was measured rather than asserting the epic has no
children at all.

**Stale worktrees** are reported per worktree with the reasons that flagged it —
`branch-merged`, `uncommitted-changes`, `older-than-<N>d`, or `missing-directory`. Read
them together, don't collapse them: a merged, clean, recent worktree is routine cleanup,
while `uncommitted-changes` means unrecoverable work is sitting in a directory nobody is
looking at. That is the case this check was written for — an orphan worktree survived a
week at 1.15 GB holding 14 uncommitted files, invisible to the branch check (the branch
was checked out, so nothing about it looked stale) and to `git status` in the main tree.

**Failing scheduled workflows** are reported by workflow name with the conclusion of its most
recent completed `schedule`-event run. A scheduled workflow fails silently by construction —
nobody is waiting on its output — so it can stay broken for months, and the first symptom is
usually an absent report that everyone assumed was clean. Treat a finding here as a real red,
not as noise: nothing else is watching this tier.

For any finding, suggest — but do not run without confirmation — the fix:
`git branch -d <branch>` for stale (local) branches, `git push origin --delete <branch>`
for stale remote sprint branches, `node
scripts/asdlc/finish-sprint.js <sprint-id> <sha>` (which retires the worktree *before*
deleting the branch) or `git worktree remove <path>` for stale worktrees, `gh api
repos/{owner}/{repo} -X PATCH -f default_branch=<trunk>` for a default-branch mismatch,
`gh issue edit <n> --add-label <label>` / `--milestone <name>` for untriaged issues,
`/profile-issue <n>` for any issue reported as `no-execution-profile` (missing one of the
`complexity/`, `risk/`, `execution/` routing labels), `gh issue edit <n> --add-label kind/epic` for a tracker still sitting on that worklist,
decomposition (or closing it) for `epic-without-open-sub-issues`, and `gh run view --log-failed` for a
failing scheduled workflow.

**Never `--force` a worktree removal on the user's behalf.** A worktree flagged
`uncommitted-changes` holds the only copy of that work; surface the file list and let the
human decide.
