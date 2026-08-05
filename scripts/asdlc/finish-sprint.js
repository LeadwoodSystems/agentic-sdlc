const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./lib/exec');

/**
 * markMerged(cwd, sprintId, sha)
 * Finds the STATUS.md line containing `**${sprintId}**` and `status: awaiting-merge`,
 * and rewrites just that line's trailing status to `status: merged (${sha})`.
 * Throws if no matching line is found.
 */
function markMerged(cwd, sprintId, sha) {
  const statusPath = path.join(cwd, 'docs/STATUS.md');
  const lines = fs.readFileSync(statusPath, 'utf8').split('\n');

  const idx = lines.findIndex(
    (l) => l.includes(`**${sprintId}**`) && l.includes('status: awaiting-merge')
  );
  if (idx === -1) {
    throw new Error(`No awaiting-merge entry found for ${sprintId} in docs/STATUS.md.`);
  }

  const sanitizedSha = sha.replace(/[\r\n]/g, ' ');
  lines[idx] = lines[idx].replace('status: awaiting-merge', `status: merged (${sanitizedSha})`);
  fs.writeFileSync(statusPath, lines.join('\n'));
}

/**
 * deleteBranch(cwd, branchName, { runner = run } = {})
 * Deletes the local branch, and the remote branch if it exists.
 *
 * SQUASH-MERGE HANDLING:
 * This plugin promotes squash-merge PRs (one clean commit per sprint).
 * When a PR is squash-merged, GitHub creates a NEW commit on main with a different
 * SHA than any commit on the sprint branch. Therefore, `git branch -d` (which checks
 * ancestry) will fail — git doesn't recognize the branch as "merged" because the
 * commits have different SHAs.
 *
 * However, `finish-sprint.js` is only called AFTER human/agent confirms the sprint's
 * PR actually merged. This precondition means the branch's work is safely captured
 * elsewhere (in main, via the merged PR). Given that, a fallback to `git branch -D`
 * (force delete) is appropriate and safe: the only risk with force delete is losing
 * unmerged work, but we have the precondition that the work IS merged.
 *
 * Strategy: try `git branch -d` first (safe delete). If it fails specifically
 * because git reports the branch as "not fully merged" (the squash-merge case),
 * fall back to `git branch -D` (force delete). Any other failure (branch not
 * found, branch checked out elsewhere, etc.) is re-thrown as-is so the original
 * diagnostic message isn't discarded.
 */
function deleteBranch(cwd, branchName, { runner = run } = {}) {
  // Try safe delete first
  try {
    runner('git', ['branch', '-d', branchName], { cwd });
  } catch (err) {
    // Only fall back to force delete for the known squash-merge case, where
    // git can't verify ancestry because the branch's commits were squashed
    // into a new commit on main. Any other failure reason should propagate.
    if (!/not fully merged/i.test(err.message)) {
      throw err;
    }
    runner('git', ['branch', '-D', branchName], { cwd });
  }

  // Check if a remote branch exists. If there's no `origin` remote at all
  // (e.g. local-only testing scenarios), that's fine to swallow since there's
  // nothing to delete.
  let remote = '';
  try {
    remote = runner('git', ['ls-remote', '--heads', 'origin', branchName], { cwd });
  } catch (err) {
    return;
  }

  // A genuine failure here (auth failure, branch protection, network issue)
  // is an actionable error and must propagate to the caller, not be swallowed.
  if (remote.length > 0) {
    runner('git', ['push', 'origin', '--delete', branchName], { cwd });
  }
}

/**
 * parseWorktrees(porcelain)
 * Turns `git worktree list --porcelain` output into
 * [{ path, branch: string|null }, …], in git's own order — which matters,
 * because git always emits the MAIN worktree first and that is the only way
 * the porcelain format identifies it.
 *
 * Records are separated by blank lines and each begins with a `worktree <path>`
 * line; a `branch <ref>` line follows only when the worktree has one checked
 * out (a detached worktree emits `detached` instead). Parsed line-by-line
 * rather than by splitting on blank lines so that CRLF-terminated output and a
 * missing trailing blank line are both non-issues. Paths arrive with forward
 * slashes even on Windows, and are passed back to git verbatim.
 */
function parseWorktrees(porcelain) {
  const entries = [];
  for (const rawLine of porcelain.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('worktree ')) {
      entries.push({ path: line.slice('worktree '.length), branch: null });
    } else if (line.startsWith('branch ') && entries.length > 0) {
      entries[entries.length - 1].branch = line.slice('branch '.length);
    }
  }
  return entries;
}

/**
 * removeWorktreeForBranch(cwd, branchName, { force = false, runner = run } = {})
 * Removes the linked worktree that has `branchName` checked out, if there is one.
 *
 * WHY THIS EXISTS: before it, finish-sprint.js cleaned up the branch and left
 * the worktree behind forever. One such orphan survived a week at 1.15 GB,
 * holding 14 uncommitted files nobody could see.
 *
 * The precondition is deleteBranch's (see its SQUASH-MERGE HANDLING note): the
 * caller has already confirmed the sprint's PR merged, so the *committed* work
 * is safely in trunk. That is what makes discarding the worktree safe — but it
 * says nothing about work that was never committed, hence the dirty check.
 *
 * Returns a reportable result rather than throwing on the expected outcomes, so
 * main() can print a specific diagnostic instead of a stack trace:
 *   { removed: true,  forced, path }
 *   { removed: false, reason: 'no-worktree' }
 *   { removed: false, reason: 'main-worktree', path }
 *   { removed: false, reason: 'dirty', path, changes: [...] }
 * A failure of git itself still propagates.
 */
function removeWorktreeForBranch(cwd, branchName, { force = false, runner = run } = {}) {
  const entries = parseWorktrees(runner('git', ['worktree', 'list', '--porcelain'], { cwd }));
  const index = entries.findIndex((e) => e.branch === `refs/heads/${branchName}`);
  if (index === -1) return { removed: false, reason: 'no-worktree' };

  const target = entries[index];
  // The main worktree is git's first record. `git worktree remove` refuses it
  // outright, so this guard exists to turn an opaque git error into a named
  // result — and it holds under --force, where git's own refusal does not.
  if (index === 0) return { removed: false, reason: 'main-worktree', path: target.path };

  // Status is per-worktree, so it must be asked of the worktree's own directory,
  // not of `cwd`.
  const changes = runner('git', ['status', '--porcelain'], { cwd: target.path })
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);

  // Report the changes rather than just their count: an operator deciding
  // whether to pass --force is deciding what to destroy, and needs to see it.
  if (changes.length > 0 && !force) {
    return { removed: false, reason: 'dirty', path: target.path, changes };
  }

  const args = force ? ['worktree', 'remove', '--force', target.path] : ['worktree', 'remove', target.path];
  runner('git', args, { cwd });
  return { removed: true, forced: force, path: target.path };
}

/**
 * checkMilestone(cwd, issueNumbers, { runner = run } = {})
 * For each issue number, runs `gh issue view <n> --json milestone` and returns
 * an array of { issue, milestone: string|null, error?: string }.
 *
 * If any `gh` call fails for a particular issue, that issue's result includes
 * an `error` property with the failure reason. Other issues continue processing.
 * This allows the caller (main()) to report per-issue failures without crashing
 * the whole CLI, since by the time milestone check runs, the core work
 * (markMerged + deleteBranch) is already complete and successful.
 */
function checkMilestone(cwd, issueNumbers, { runner = run } = {}) {
  return issueNumbers.map((issue) => {
    try {
      const out = runner('gh', ['issue', 'view', String(issue), '--json', 'milestone'], { cwd });
      const parsed = JSON.parse(out);
      return { issue, milestone: parsed.milestone ? parsed.milestone.title : null };
    } catch (err) {
      return { issue, milestone: null, error: err.message };
    }
  });
}

/**
 * main(argv = process.argv.slice(2), { runner = run } = {})
 * CLI entry point: node finish-sprint.js [--force] <sprint-id> <sha> [issue-numbers...]
 *
 * Accepts its arguments explicitly (rather than reading process.argv directly)
 * and an injectable `runner`, so it can be invoked directly from tests against
 * a fixture repo with a stubbed runner.
 *
 * Steps:
 * 1. Validate args (sprint-id, sha required)
 * 2. Call removeWorktreeForBranch(cwd, `sprint/${sprintId}`) — retire the worktree
 * 3. Call markMerged(cwd, sprintId, sha) — update docs/STATUS.md
 * 4. Call deleteBranch(cwd, `sprint/${sprintId}`) — clean up sprint branch
 * 5. If issue numbers provided, call checkMilestone and report missing milestones
 *
 * ORDER: the worktree must go before the branch — git refuses to delete a
 * branch that is checked out in another worktree, so the reverse order fails
 * outright. It also runs before markMerged, one step earlier than strictly
 * required, so that a refusal on a dirty worktree leaves the repo completely
 * untouched: had STATUS.md already been rewritten, the re-run after --force
 * would die in markMerged with "no awaiting-merge entry found".
 *
 * `--force` is accepted anywhere in argv and stripped before positional
 * parsing, so it can be typed in the natural leading position.
 *
 * The milestone check is advisory and wrapped in error handling so that
 * a failure to fetch milestone data (bad issue number, auth failure, network blip)
 * doesn't crash the process — the core work is already done at that point.
 * Any per-issue milestone-check errors are logged as warnings but don't exit
 * with non-zero status.
 */
function main(argv = process.argv.slice(2), { runner = run } = {}) {
  const force = argv.includes('--force');
  const [sprintId, sha, ...issueArgs] = argv.filter((a) => a !== '--force');
  if (!sprintId || !sha) {
    console.error('Usage: node finish-sprint.js [--force] <sprint-id> <sha> [issue-numbers...]');
    process.exit(1);
  }
  const cwd = process.cwd();
  const branchName = `sprint/${sprintId}`;

  const worktree = removeWorktreeForBranch(cwd, branchName, { force, runner });
  if (worktree.removed) {
    console.log(`Removed worktree ${worktree.path}${worktree.forced ? ' (forced)' : ''}.`);
  } else if (worktree.reason === 'dirty') {
    console.error(`Refusing to remove the worktree for ${branchName} — it has uncommitted changes:`);
    console.error(`  ${worktree.path}`);
    for (const change of worktree.changes) console.error(`    ${change}`);
    console.error('Commit or discard them, or re-run with --force to destroy them.');
    // Stop here rather than continuing: the branch is checked out in that
    // worktree, so deleteBranch would fail anyway — and its git error would
    // bury the file list above, which is the part the operator needs.
    process.exitCode = 1;
    return;
  } else if (worktree.reason === 'main-worktree') {
    console.warn(`${branchName} is checked out in the main worktree (${worktree.path}) — switch away before deleting it.`);
  }

  markMerged(cwd, sprintId, sha);
  console.log(`Marked ${sprintId} as merged (${sha}) in docs/STATUS.md.`);

  deleteBranch(cwd, branchName, { runner });
  console.log(`Deleted branch ${branchName} (local + remote if present).`);

  const issueNumbers = issueArgs.map(Number).filter((n) => !Number.isNaN(n));
  if (issueNumbers.length > 0) {
    const results = checkMilestone(cwd, issueNumbers, { runner });
    for (const result of results) {
      if (result.error) {
        console.warn(`Warning: Could not check milestone for issue #${result.issue}: ${result.error}`);
      } else if (!result.milestone) {
        console.warn(`Issue #${result.issue} has no milestone assigned — consider assigning one.`);
      }
    }
  }
}

module.exports = {
  markMerged,
  deleteBranch,
  parseWorktrees,
  removeWorktreeForBranch,
  checkMilestone,
  main,
};

if (require.main === module) {
  main();
}
