---
description: Run the ASDLC hygiene audit (stale branches, stale worktrees, default-branch drift, untriaged issues, milestone/sprint version sync)
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

Present the five findings (stale branches, stale worktrees, default-branch mismatch,
untriaged issues, milestone/version sync) as a short report. Each check is isolated, so a
failure in one still leaves the others reported: if a `gh`-based check (untriaged issues
or milestone/version sync) could not run — e.g. `gh` isn't authenticated, there's no
GitHub remote, or the network is unavailable — the tool still reports the git-based
findings rather than failing outright. Note which check(s) could not run and why, rather
than treating it as a hard failure.

**Stale worktrees** are reported per worktree with the reasons that flagged it —
`branch-merged`, `uncommitted-changes`, `older-than-<N>d`, or `missing-directory`. Read
them together, don't collapse them: a merged, clean, recent worktree is routine cleanup,
while `uncommitted-changes` means unrecoverable work is sitting in a directory nobody is
looking at. That is the case this check was written for — an orphan worktree survived a
week at 1.15 GB holding 14 uncommitted files, invisible to the branch check (the branch
was checked out, so nothing about it looked stale) and to `git status` in the main tree.

Also check the health of scheduled workflows, which the audit script does not cover:

```bash
gh run list --limit 40 --json name,event,conclusion,createdAt,headBranch
```

Report any workflow whose **most recent `schedule`-event run** did not conclude
`success`. A scheduled workflow fails silently by construction — nobody is waiting on its
output — so it can stay broken for months, and the first symptom is usually an absent
report that everyone assumed was clean.

For any finding, suggest — but do not run without confirmation — the fix:
`git push origin --delete <branch>` for stale branches, `node
scripts/asdlc/finish-sprint.js <sprint-id> <sha>` (which retires the worktree *before*
deleting the branch) or `git worktree remove <path>` for stale worktrees, `gh api
repos/{owner}/{repo} -X PATCH -f default_branch=<trunk>` for a default-branch mismatch,
`gh issue edit <n> --add-label <label>` / `--milestone <name>` for untriaged issues, and
`/profile-issue <n>` for any issue reported as `no-execution-profile` (missing one of the
`complexity/`, `risk/`, `execution/` routing labels).

**Never `--force` a worktree removal on the user's behalf.** A worktree flagged
`uncommitted-changes` holds the only copy of that work; surface the file list and let the
human decide.
