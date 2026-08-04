---
description: Run the ASDLC hygiene audit (stale branches, default-branch drift, untriaged issues, milestone/sprint version sync)
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

Present the four findings (stale branches, default-branch mismatch, untriaged issues,
milestone/version sync) as a short report. If a `gh`-based check (untriaged issues or
milestone/version sync) could not run — e.g. `gh` isn't authenticated, there's no
GitHub remote, or the network is unavailable — the tool still reports the git-based
findings (stale branches, default-branch check) rather than failing outright; note
which check(s) could not run and why, rather than treating it as a hard failure.

For any finding, suggest — but do not run without confirmation — the fix:
`git push origin --delete <branch>` for stale branches, `gh api repos/{owner}/{repo}
-X PATCH -f default_branch=<trunk>` for a default-branch mismatch, `gh issue edit <n>
--add-label <label>` / `--milestone <name>` for untriaged issues, and `/profile-issue <n>`
for any issue reported as `no-execution-profile` (missing one of the `complexity/`,
`risk/`, `execution/` routing labels).
