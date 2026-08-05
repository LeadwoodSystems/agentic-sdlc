// Is a branch's work already in trunk?
//
// This lives in one place because `gh-hygiene.js` (report) and `new-sprint.js`
// (gate) both need the answer, and both previously held their own copy of the
// same broken test — `git log <trunk>..<branch>` being empty. That test is blind
// to a squash-merge: the squashed commit on trunk is a *different* commit, so
// the branch's originals still show as "not in trunk" forever.
//
// NOT USED: `git cherry <trunk> <branch>`, the obvious candidate and the one the
// source hardening doc proposed. Measured on this repo against a real
// squash-merged branch, it reported all 7 commits as `+` (unmerged). A
// squash-merge produces ONE commit whose patch-id equals the *combined* diff, so
// no individual branch commit is ever patch-equivalent to anything on trunk.
// Adopting it would have reproduced the very bug this module exists to fix.

const { run } = require('./exec');

function isBranchMerged(cwd, branch, { trunk = 'main', runner = run } = {}) {
  // Primary: a merged PR on this head branch is authoritative — it is a
  // recorded fact about the remote, independent of how trunk has moved since.
  try {
    const out = runner(
      'gh',
      ['pr', 'list', '--state', 'merged', '--head', branch, '--json', 'number'],
      { cwd },
    );
    const prs = JSON.parse(out);
    if (Array.isArray(prs) && prs.length > 0) return true;
  } catch {
    // Swallowed deliberately, and for ANY reason: gh not installed, not
    // authenticated, no GitHub remote, network down, or output that isn't JSON
    // (a banner/warning on stdout). None of those are statements about the
    // branch, so none may propagate — they just mean "ask git instead".
  }
  // Note the control flow: a gh call that SUCCEEDS and returns an empty array
  // is a genuine "no merged PR" answer, yet it still falls through to the tree
  // comparison, because a branch can be merged without ever having had a PR.

  // Fallback: two-dot diff. Exit 0 => the two trees are identical => everything
  // the branch contains is already in trunk.
  //
  // Honest failure mode: this is a snapshot comparison, not a history one. The
  // moment trunk advances past the merge, the trees diverge and this answers
  // "not merged" for a branch that genuinely was — a false NEGATIVE. That is
  // the safe direction for both consumers: a report-only audit merely fails to
  // suggest a cleanup, and a gate errs toward blocking rather than toward
  // letting a live branch be discarded. Whenever a GitHub remote exists the
  // primary path covers this case anyway.
  try {
    runner('git', ['diff', '--quiet', trunk, branch], { cwd });
    return true;
  } catch (err) {
    // `git diff --quiet` signals its RESULT through the exit code: 1 means
    // "the trees differ", which is an answer. Anything else — notably 128 for
    // a bad ref or "not a git repository" — is a broken invocation and must
    // fail loudly. Reporting a misconfigured repo as "not merged" would render
    // the audit silently useless (`Stale merged branches: none`, always) and
    // is exactly what gh-hygiene.test.js asserts against.
    if (err.status === 1) return false;
    throw err;
  }
}

module.exports = { isBranchMerged };
