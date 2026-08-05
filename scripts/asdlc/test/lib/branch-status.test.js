const test = require('node:test');
const assert = require('node:assert/strict');
const { isBranchMerged } = require('../../lib/branch-status');

// These are pure stubbed-runner tests: the stub intercepts every shell-out, so
// nothing ever touches a real repo and a plain cwd string is enough. (No
// makeFixtureRepo here — it would only buy a slower test with the same coverage.)
const CWD = '/repo';

function stubError(status, message = 'command failed') {
  const err = new Error(message);
  err.status = status;
  return err;
}

test('isBranchMerged returns true when a merged PR exists for the branch', () => {
  const runner = (cmd) => {
    if (cmd === 'gh') return JSON.stringify([{ number: 12 }]);
    throw new Error('git must not be consulted once gh answered authoritatively');
  };
  assert.equal(isBranchMerged(CWD, 'sprint/v0.2-s1', { runner }), true);
});

test('isBranchMerged asks gh for MERGED PRs on exactly this head branch', () => {
  // Asserted argv-exact on purpose. Dropping `--state merged` would make the
  // lookup match an *open* PR and report an in-flight branch as merged, which
  // is the entire correctness of the primary strategy; a future refactor must
  // not be able to lose it silently.
  const calls = [];
  const runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return '[]';
  };
  isBranchMerged(CWD, 'sprint/v0.2-s1', { runner });

  assert.deepEqual(calls[0], {
    cmd: 'gh',
    args: [
      'pr', 'list',
      '--state', 'merged',
      '--head', 'sprint/v0.2-s1',
      '--json', 'number',
    ],
    opts: { cwd: CWD },
  });
});

test('isBranchMerged falls back to the tree comparison when gh finds no PR', () => {
  // A gh call that SUCCEEDS with an empty array is a real "no merged PR"
  // answer, not a failure — but a branch can be merged without ever having a
  // PR, so it must still fall through rather than short-circuit to false.
  const calls = [];
  const runner = (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === 'gh') return '[]';
    return ''; // git diff --quiet exit 0 => trees identical
  };
  assert.equal(isBranchMerged(CWD, 'sprint/v0.2-s1', { runner }), true);
  assert.deepEqual(calls[1], {
    cmd: 'git',
    args: ['diff', '--quiet', 'main', 'sprint/v0.2-s1'],
  });
});

test('isBranchMerged returns false when the trees differ (git exit 1)', () => {
  const runner = (cmd) => {
    if (cmd === 'gh') return '[]';
    throw stubError(1, 'git diff --quiet main sprint/v0.2-s1 failed: ');
  };
  assert.equal(isBranchMerged(CWD, 'sprint/v0.2-s1', { runner }), false);
});

test('isBranchMerged compares against a non-default trunk when asked', () => {
  const calls = [];
  const runner = (cmd, args) => {
    calls.push(args.join(' '));
    if (cmd === 'gh') return '[]';
    return '';
  };
  assert.equal(
    isBranchMerged(CWD, 'sprint/v0.2-s1', { trunk: 'develop', runner }),
    true,
  );
  assert.ok(
    calls.some((c) => c === 'diff --quiet develop sprint/v0.2-s1'),
    `expected the fallback to diff against develop, got: ${JSON.stringify(calls)}`,
  );
});

test('isBranchMerged falls back when gh throws (not installed / not authed / no remote)', () => {
  const runner = (cmd) => {
    if (cmd === 'gh') throw new Error('gh: authentication required (gh auth login)');
    return ''; // trees identical
  };
  assert.equal(isBranchMerged(CWD, 'sprint/v0.2-s1', { runner }), true);
});

test('isBranchMerged does not propagate a gh failure even when the fallback says false', () => {
  const runner = (cmd) => {
    if (cmd === 'gh') throw new Error('gh: command not found');
    throw stubError(1);
  };
  assert.equal(isBranchMerged(CWD, 'sprint/v0.2-s1', { runner }), false);
});

test('isBranchMerged falls back when gh returns unparseable output', () => {
  // e.g. gh emitting a warning/banner on stdout, or an HTML error page.
  const runner = (cmd) => {
    if (cmd === 'gh') return 'not json at all';
    return '';
  };
  assert.equal(isBranchMerged(CWD, 'sprint/v0.2-s1', { runner }), true);
});

test('isBranchMerged propagates a git failure that is not exit 1', () => {
  // Exit 128 means bad ref / not a git repository — a BROKEN INVOCATION, not
  // an answer. Swallowing it would report a misconfigured repo as "no stale
  // branches", and would break gh-hygiene.test.js's assertion that
  // findStaleBranches throws when the trunk ref is absent.
  const runner = (cmd) => {
    if (cmd === 'gh') return '[]';
    throw stubError(128, "fatal: bad revision 'main'");
  };
  assert.throws(
    () => isBranchMerged(CWD, 'sprint/v0.2-s1', { runner }),
    /bad revision/,
  );
});

test('isBranchMerged propagates a git failure carrying no status at all', () => {
  // A missing `status` (e.g. spawn ENOENT, where run() rethrows result.error)
  // is not the exit-1 "trees differ" answer and must not be read as one.
  const runner = (cmd) => {
    if (cmd === 'gh') return '[]';
    throw new Error('spawnSync git ENOENT');
  };
  assert.throws(
    () => isBranchMerged(CWD, 'sprint/v0.2-s1', { runner }),
    /ENOENT/,
  );
});
