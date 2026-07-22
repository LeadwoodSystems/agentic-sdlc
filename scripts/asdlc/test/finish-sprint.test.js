const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { markMerged, deleteBranch } = require('../finish-sprint');

test('markMerged flips only the matching line', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const statusPath = path.join(dir, 'docs/STATUS.md');
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, [
      '- 2026-07-20 **v0.1-s1** — First — [handoff](docs/handoffs/v0.1-s1-a.md) — status: awaiting-merge',
      '- 2026-07-21 **v0.1-s2** — Second — [handoff](docs/handoffs/v0.1-s2-b.md) — status: awaiting-merge',
      '',
    ].join('\n'));

    markMerged(dir, 'v0.1-s2', 'abc1234');

    const lines = fs.readFileSync(statusPath, 'utf8').split('\n').filter(Boolean);
    assert.match(lines[0], /v0\.1-s1.*status: awaiting-merge/);
    assert.match(lines[1], /v0\.1-s2.*status: merged \(abc1234\)/);
  } finally {
    cleanup();
  }
});

test('markMerged throws when no matching awaiting-merge line exists', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/STATUS.md'), '- nothing here\n');
    assert.throws(() => markMerged(dir, 'v0.1-s1', 'sha'), /no awaiting-merge entry/i);
  } finally {
    cleanup();
  }
});

test('deleteBranch deletes a local-only branch', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    run('git', ['branch', 'sprint/v0.1-s1'], { cwd: dir });
    deleteBranch(dir, 'sprint/v0.1-s1');
    const branches = run('git', ['branch', '--list', 'sprint/*'], { cwd: dir });
    assert.equal(branches, '');
  } finally {
    cleanup();
  }
});

test('deleteBranch falls back to force delete on squash-merge scenario', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // Create a branch with a commit
    run('git', ['checkout', '-b', 'sprint/v0.1-s1'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature work\n');
    run('git', ['add', 'feature.txt'], { cwd: dir });
    run('git', ['commit', '-m', 'add feature'], { cwd: dir });

    // Get the branch commit SHA for reference
    const branchSha = run('git', ['rev-parse', 'HEAD'], { cwd: dir });

    // Switch back to main
    run('git', ['checkout', 'main'], { cwd: dir });

    // Simulate a squash-merge by creating a new commit with different content
    // (this makes the branch's commits unreachable via normal ancestry)
    fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature work\n');
    run('git', ['add', 'feature.txt'], { cwd: dir });
    run('git', ['commit', '-m', 'squash-merge sprint/v0.1-s1'], { cwd: dir });

    // Now the branch is "conceptually merged" (work is in main) but
    // `git branch -d` would fail because the commits have different SHAs
    // deleteBranch should handle this by falling back to -D
    deleteBranch(dir, 'sprint/v0.1-s1');

    const branches = run('git', ['branch', '--list', 'sprint/*'], { cwd: dir });
    assert.equal(branches, '');
  } finally {
    cleanup();
  }
});

test('deleteBranch re-throws the original error when -d fails for an unrelated reason', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // Attempt to delete a branch that never existed. `git branch -d` fails
    // with "branch 'x' not found", which is NOT a "not fully merged" failure,
    // so deleteBranch must re-throw the original error rather than silently
    // attempting -D (which would produce a different, more confusing error).
    assert.throws(
      () => deleteBranch(dir, 'does-not-exist'),
      (err) => {
        assert.match(err.message, /not found/i);
        assert.doesNotMatch(err.message, /not fully merged/i);
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test('deleteBranch deletes remote branch if it exists', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // Track calls to the injected runner
    const calls = [];
    const testRunner = (cmd, args, opts) => {
      calls.push({ cmd, args: args.join(' ') });
      // Simulate successful execution
      if (args[0] === 'ls-remote') {
        // Pretend remote branch exists
        return 'abc1234\trefs/heads/sprint/v0.1-s1';
      }
      return '';
    };

    deleteBranch(dir, 'sprint/v0.1-s1', { runner: testRunner });

    // Should have called git branch -d/D, then ls-remote, then push --delete
    assert.ok(calls.length >= 3, `expected at least 3 git calls, got ${calls.length}`);
    assert.ok(
      calls.some((c) => c.args.includes('branch') && (c.args.includes('-d') || c.args.includes('-D'))),
      'should call git branch -d or -D',
    );
    assert.ok(
      calls.some((c) => c.args.includes('ls-remote') && c.args.includes('sprint/v0.1-s1')),
      'should call git ls-remote to check for remote branch',
    );
    assert.ok(
      calls.some((c) => c.args.includes('push') && c.args.includes('--delete')),
      'should call git push --delete when remote exists',
    );
  } finally {
    cleanup();
  }
});

test('deleteBranch does not delete remote if it does not exist', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // Track calls to the injected runner
    const calls = [];
    const testRunner = (cmd, args, opts) => {
      calls.push({ cmd, args: args.join(' ') });
      // Simulate successful execution, but remote doesn't exist
      if (args[0] === 'ls-remote') {
        return ''; // No remote branch
      }
      return '';
    };

    deleteBranch(dir, 'sprint/v0.1-s1', { runner: testRunner });

    // Should have called git branch -d/D and ls-remote, but NOT push --delete
    assert.ok(
      calls.some((c) => c.args.includes('branch') && (c.args.includes('-d') || c.args.includes('-D'))),
      'should call git branch -d or -D',
    );
    assert.ok(
      calls.some((c) => c.args.includes('ls-remote')),
      'should call git ls-remote to check for remote branch',
    );
    assert.ok(
      !calls.some((c) => c.args.includes('push') && c.args.includes('--delete')),
      'should NOT call git push --delete when remote does not exist',
    );
  } finally {
    cleanup();
  }
});

test('deleteBranch propagates a genuine push --delete failure instead of swallowing it', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const testRunner = (cmd, args) => {
      if (args[0] === 'branch') return '';
      if (args[0] === 'ls-remote') {
        // Remote branch exists, so deleteBranch will attempt to push --delete
        return 'abc1234\trefs/heads/sprint/v0.1-s1';
      }
      if (args[0] === 'push') {
        throw new Error('push origin --delete sprint/v0.1-s1 failed: remote: protected branch hook declined');
      }
      return '';
    };

    assert.throws(
      () => deleteBranch(dir, 'sprint/v0.1-s1', { runner: testRunner }),
      /protected branch hook declined/,
    );
  } finally {
    cleanup();
  }
});

test('deleteBranch uses injected runner for git commands', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const calls = [];
    const testRunner = (cmd, args, opts) => {
      calls.push({ cmd, args });
      if (args[0] === 'ls-remote') return '';
      return '';
    };

    deleteBranch(dir, 'test-branch', { runner: testRunner });

    assert.ok(calls.length > 0, 'runner should be called');
    assert.ok(
      calls.every((c) => c.cmd === 'git'),
      'all calls should use git command',
    );
  } finally {
    cleanup();
  }
});
