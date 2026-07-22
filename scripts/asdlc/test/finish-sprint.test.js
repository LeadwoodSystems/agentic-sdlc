const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { markMerged, deleteBranch, checkMilestone, main } = require('../finish-sprint');

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

test('checkMilestone reports missing milestones via a stubbed gh', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const calls = [];
    const stubRunner = (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      const issueArg = args[args.indexOf('view') + 1];
      if (issueArg === '42') return JSON.stringify({ milestone: { title: 'v0.9' } });
      return JSON.stringify({ milestone: null });
    };

    const result = checkMilestone(dir, [42, 43], { runner: stubRunner });
    assert.deepEqual(result, [
      { issue: 42, milestone: 'v0.9' },
      { issue: 43, milestone: null },
    ]);
    assert.ok(calls.some((c) => c.includes('gh issue view 42')));
  } finally {
    cleanup();
  }
});

test('checkMilestone handles per-issue errors gracefully, returning error marker', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = (cmd, args) => {
      const issueArg = args[args.indexOf('view') + 1];
      if (issueArg === '42') return JSON.stringify({ milestone: { title: 'v0.9' } });
      if (issueArg === '99') {
        throw new Error('issue not found');
      }
      return JSON.stringify({ milestone: null });
    };

    const result = checkMilestone(dir, [42, 99, 43], { runner: stubRunner });
    // Issue 42 succeeds, 99 fails, 43 succeeds
    assert.equal(result.length, 3);
    assert.deepEqual(result[0], { issue: 42, milestone: 'v0.9' });
    // Full shape check: milestone must always be present (null on error), per
    // the documented { issue, milestone: string|null, error?: string } contract.
    assert.deepEqual(result[1], { issue: 99, milestone: null, error: 'issue not found' });
    assert.deepEqual(result[2], { issue: 43, milestone: null });
  } finally {
    cleanup();
  }
});

test('main() orchestrates markMerged, deleteBranch, and checkMilestone successfully', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  const originalCwd = process.cwd();
  const originalWarn = console.warn;
  const originalLog = console.log;
  try {
    // Set up STATUS.md
    const statusPath = path.join(dir, 'docs/STATUS.md');
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, '- 2026-07-20 **v0.1-s1** — First — [handoff](docs/handoffs/v0.1-s1-a.md) — status: awaiting-merge\n');

    // Create the sprint branch
    run('git', ['branch', 'sprint/v0.1-s1'], { cwd: dir });

    // Capture console output
    const logs = [];
    const warns = [];
    console.log = (...args) => logs.push(args.join(' '));
    console.warn = (...args) => warns.push(args.join(' '));

    // Stub runner: delegate real git ops to the fixture repo, stub gh calls
    const testRunner = (cmd, args, opts) => {
      if (cmd === 'git') {
        return run(cmd, args, opts);
      }
      if (cmd === 'gh') {
        const issueArg = args[args.indexOf('view') + 1];
        if (issueArg === '42') {
          return JSON.stringify({ milestone: { title: 'v0.9' } });
        }
        return JSON.stringify({ milestone: null });
      }
      return '';
    };

    process.chdir(dir);
    main(['v0.1-s1', 'abc1234', '42', '43'], { runner: testRunner });

    // Verify markMerged was actually invoked by main()
    const statusContent = fs.readFileSync(statusPath, 'utf8');
    assert.match(statusContent, /status: merged \(abc1234\)/);

    // Verify deleteBranch was actually invoked by main()
    const branches = run('git', ['branch', '--list', 'sprint/*'], { cwd: dir });
    assert.equal(branches, '');

    // Verify checkMilestone results were processed: issue 43 has no milestone
    assert.ok(
      warns.some((w) => w.includes('Issue #43 has no milestone assigned')),
      `expected a no-milestone warning for issue 43, got: ${JSON.stringify(warns)}`,
    );
    // Issue 42 has a milestone, so it should NOT produce a warning
    assert.ok(!warns.some((w) => w.includes('#42')));
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
    console.warn = originalWarn;
    cleanup();
  }
});

test('main() with milestone check errors does not crash (graceful error handling)', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  const originalCwd = process.cwd();
  const originalWarn = console.warn;
  try {
    const statusPath = path.join(dir, 'docs/STATUS.md');
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, '- 2026-07-20 **v0.1-s1** — First — [handoff](docs/handoffs/v0.1-s1-a.md) — status: awaiting-merge\n');

    run('git', ['branch', 'sprint/v0.1-s1'], { cwd: dir });

    const warns = [];
    console.warn = (...args) => warns.push(args.join(' '));

    // Mock gh runner that throws for one issue but succeeds for the others
    const testRunner = (cmd, args, opts) => {
      if (cmd === 'git') {
        return run(cmd, args, opts);
      }
      if (cmd === 'gh') {
        const issueArg = args[args.indexOf('view') + 1];
        if (issueArg === '99') {
          throw new Error('Not Found: HTTP 404');
        }
        return JSON.stringify({ milestone: null });
      }
      return '';
    };

    process.chdir(dir);
    // The key test: main() should NOT throw even though gh fails for issue 99
    assert.doesNotThrow(() => {
      main(['v0.1-s1', 'abc1234', '42', '99', '43'], { runner: testRunner });
    });

    // Core work still completed despite the milestone-check failure
    const statusContent = fs.readFileSync(statusPath, 'utf8');
    assert.match(statusContent, /status: merged \(abc1234\)/);
    const branches = run('git', ['branch', '--list', 'sprint/*'], { cwd: dir });
    assert.equal(branches, '');

    // main() warned about issue 99's failure specifically
    assert.ok(
      warns.some((w) => w.includes('Could not check milestone for issue #99') && w.includes('Not Found: HTTP 404')),
      `expected a milestone-check-failure warning for issue 99, got: ${JSON.stringify(warns)}`,
    );
  } finally {
    process.chdir(originalCwd);
    console.warn = originalWarn;
    cleanup();
  }
});
