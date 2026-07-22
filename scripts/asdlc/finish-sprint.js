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
 * Strategy: try `git branch -d` first (safe delete). If it fails (e.g., due to
 * squash-merge), fall back to `git branch -D` (force delete).
 */
function deleteBranch(cwd, branchName, { runner = run } = {}) {
  // Try safe delete first
  try {
    runner('git', ['branch', '-d', branchName], { cwd });
  } catch (err) {
    // If safe delete fails, try force delete
    // This handles the squash-merge case where ancestry isn't recognized
    runner('git', ['branch', '-D', branchName], { cwd });
  }

  // Check if remote branch exists and delete it
  // If there's no remote or the branch doesn't exist remotely, this will fail silently
  try {
    const remote = runner('git', ['ls-remote', '--heads', 'origin', branchName], { cwd });
    if (remote.length > 0) {
      runner('git', ['push', 'origin', '--delete', branchName], { cwd });
    }
  } catch (err) {
    // No remote exists or branch isn't on remote; silently continue
    // This is expected in local-only testing scenarios
  }
}

module.exports = { markMerged, deleteBranch };
