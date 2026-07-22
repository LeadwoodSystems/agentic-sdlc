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
    // Git's real error for this specific case is:
    //   fatal: ref refs/remotes/origin/HEAD is not a symbolic ref
    // Since this is a read-only audit tool, we handle *that specific* failure
    // gracefully and return a clear "unknown" state rather than crashing.
    // Any other failure (corrupted .git, git missing, permission denied, wrong
    // cwd, etc.) is unexpected and must not be silently swallowed.
    if (/is not a symbolic ref/i.test(err.message)) {
      return { ok: false, actual: '<unknown>' };
    }
    throw err;
  }

  const actual = ref.replace('refs/remotes/origin/', '');
  return { ok: actual === declaredTrunk, actual };
}

module.exports = { findStaleBranches, checkDefaultBranch };
