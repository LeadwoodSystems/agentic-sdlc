const { run } = require('./lib/exec');

function findStaleBranches(cwd, { runner = run } = {}) {
  // Use git for-each-ref instead of git branch --list to avoid the `+` marker
  // (which marks branches checked out in other worktrees) and the `*` marker
  // (which marks the current branch). for-each-ref with --format=%(refname:short)
  // emits clean branch names without any prefix.
  const branches = runner(
    'git',
    ['for-each-ref', 'refs/heads/sprint/*', '--format=%(refname:short)'],
    { cwd },
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return branches.filter((branch) => {
    const unmerged = runner('git', ['log', `main..${branch}`, '--oneline'], { cwd });
    return unmerged.length === 0;
  });
}

function checkDefaultBranch(cwd, declaredTrunk, { runner = run } = {}) {
  let ref;
  try {
    ref = runner('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd });
  } catch (err) {
    // origin/HEAD doesn't exist (e.g., fresh clone, no remote, or fixture repo).
    // Since this is a read-only audit tool, we handle this gracefully.
    // Return a clear "unknown" state rather than crashing.
    return { ok: false, actual: '<unknown>' };
  }

  const actual = ref.replace('refs/remotes/origin/', '');
  return { ok: actual === declaredTrunk, actual };
}

module.exports = { findStaleBranches, checkDefaultBranch };
