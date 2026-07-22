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

  lines[idx] = lines[idx].replace('status: awaiting-merge', `status: merged (${sha})`);
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

module.exports = { markMerged, deleteBranch };
