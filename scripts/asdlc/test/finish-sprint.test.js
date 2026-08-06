const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const {
  markMerged,
  deleteBranch,
  resolveSprintBranch,
  removeWorktreeForBranch,
  checkMilestone,
  originUrl,
  main,
} = require('../finish-sprint');

// `git worktree list --porcelain` output. The main worktree is always the first
// record (git documents this ordering), which is what the main-worktree guard
// keys off. Paths come back with forward slashes even on Windows.
const PORCELAIN = [
  'worktree C:/repos/asdlc',
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  'worktree C:/repos/asdlc-wt/v0.1-s1',
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/sprint/v0.1-s1',
  '',
  // A detached worktree carries no `branch` line at all; it must never match.
  'worktree C:/repos/asdlc-wt/detached',
  'HEAD 3333333333333333333333333333333333333333',
  'detached',
].join('\n');

// Stub runner for the worktree path. `calls` collects `git <args…>` strings in
// invocation order, which is how the ordering assertions below are made.
function makeWorktreeStub({ calls, porcelain = PORCELAIN, statusOutput = '', branches = 'sprint/v0.1-s1' }) {
  return (cmd, args, opts = {}) => {
    calls.push([cmd, ...args].join(' '));
    // main() resolves the sprint branch before touching anything (see
    // resolveSprintBranch), so the stub must answer for-each-ref or every main()
    // test bails out early with "no branch named …".
    if (cmd === 'git' && args[0] === 'for-each-ref') return branches;
    if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list') return porcelain;
    if (cmd === 'git' && args[0] === 'status') {
      // `git status --porcelain` is answered per-worktree: only the sprint
      // worktree is dirty, so assert the caller passed ITS path as cwd.
      return opts.cwd === 'C:/repos/asdlc-wt/v0.1-s1' ? statusOutput : '';
    }
    if (cmd === 'gh') return JSON.stringify({ milestone: { title: 'v0.9' } });
    return '';
  };
}

// resolveSprintBranch exists because `sprint/${sprintId}` is an ASSUMPTION, not a
// guarantee. Observed live on 2026-08-05: `finish-sprint.js v0.2-s1 <sha>` looked for
// `sprint/v0.2-s1` while the real branch was `sprint/v0.2-s1-execution-profiles`, so it
// rewrote STATUS.md and *then* died with a raw stack trace — leaving the operation
// half-done and non-idempotent, because the re-run fails in markMerged.
test('resolveSprintBranch prefers an exact sprint/<id> match', () => {
  const branches = ['sprint/v0.2-s1', 'sprint/v0.2-s1-execution-profiles'];
  const runner = () => branches.join('\n');
  assert.equal(resolveSprintBranch('.', 'v0.2-s1', { runner }).branch, 'sprint/v0.2-s1');
});

test('resolveSprintBranch finds the slugged branch when no exact match exists', () => {
  const runner = () => 'sprint/v0.2-s1-execution-profiles\nsprint/v0.2-s2';
  const resolved = resolveSprintBranch('.', 'v0.2-s1', { runner });
  assert.equal(resolved.branch, 'sprint/v0.2-s1-execution-profiles');
});

test('resolveSprintBranch does not confuse v0.2-s1 with v0.2-s10', () => {
  const runner = () => 'sprint/v0.2-s10-something';
  const resolved = resolveSprintBranch('.', 'v0.2-s1', { runner });
  assert.equal(resolved.branch, null);
  assert.equal(resolved.reason, 'not-found');
});

test('resolveSprintBranch refuses to guess between several slugged candidates', () => {
  const runner = () => 'sprint/v0.2-s1-one\nsprint/v0.2-s1-two';
  const resolved = resolveSprintBranch('.', 'v0.2-s1', { runner });
  assert.equal(resolved.branch, null);
  assert.equal(resolved.reason, 'ambiguous');
  assert.deepEqual(resolved.candidates, ['sprint/v0.2-s1-one', 'sprint/v0.2-s1-two']);
});

test('main refuses BEFORE touching STATUS.md when the branch cannot be resolved', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const statusPath = path.join(dir, 'docs/STATUS.md');
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, '- 2026-08-05 **v9.9-s1** — x — [h](h.md) — status: awaiting-merge\n');
    const before = fs.readFileSync(statusPath, 'utf8');

    const cwd = process.cwd();
    process.chdir(dir);
    const errors = [];
    const origError = console.error;
    console.error = (m) => errors.push(String(m));
    const origExitCode = process.exitCode;
    try {
      // No branch matches, so nothing may be mutated.
      main(['v9.9-s1', 'abc1234'], { runner: () => '' });
    } finally {
      console.error = origError;
      process.chdir(cwd);
    }

    assert.equal(fs.readFileSync(statusPath, 'utf8'), before, 'STATUS.md must be untouched');
    assert.match(errors.join('\n'), /v9\.9-s1/);
    assert.equal(process.exitCode, 1);
    process.exitCode = origExitCode;
  } finally {
    await cleanup();
  }
});

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

test('markMerged sanitizes newlines embedded in sha', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const statusPath = path.join(dir, 'docs/STATUS.md');
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, [
      '- 2026-07-20 **v0.1-s1** — First — [handoff](docs/handoffs/v0.1-s1-a.md) — status: awaiting-merge',
      '- 2026-07-21 **v0.1-s2** — Second — [handoff](docs/handoffs/v0.1-s2-b.md) — status: awaiting-merge',
      '',
    ].join('\n'));

    markMerged(dir, 'v0.1-s2', 'abc1234\nEVIL-INJECTED-LINE');

    const rawLines = fs.readFileSync(statusPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(rawLines.length, 2, 'STATUS.md should still have exactly two entry lines');
    assert.match(rawLines[0], /v0\.1-s1.*status: awaiting-merge/);
    assert.match(rawLines[1], /v0\.1-s2.*status: merged \(abc1234 EVIL-INJECTED-LINE\)/);
    assert(!rawLines[1].includes('\r'), 'merged line should not contain embedded carriage returns');
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
      if (args[0] === 'config') return 'https://example.invalid/r.git';
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
      if (args[0] === 'config') return 'https://example.invalid/r.git';
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

test('deleteBranch reports a genuine push --delete failure instead of swallowing it', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const testRunner = (cmd, args) => {
      if (args[0] === 'config') return 'https://example.invalid/r.git';
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

    const result = deleteBranch(dir, 'sprint/v0.1-s1', { runner: testRunner });

    // The failure is REPORTED, not thrown and not swallowed. Throwing here would
    // produce a raw stack trace on a half-applied finish — markMerged has already
    // rewritten STATUS.md and the local branch is already gone by this point.
    assert.equal(result.remote, 'failed', 'a push --delete failure must be reported as failed');
    assert.match(result.error, /protected branch hook declined/);
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
      if (args[0] === 'config') return 'https://example.invalid/r.git';
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

test('deleteBranch reports no-origin without calling ls-remote', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const calls = [];
    const testRunner = (cmd, args) => {
      calls.push(args.join(' '));
      if (args[0] === 'config') {
        const err = new Error('git config --get remote.origin.url failed: ');
        err.status = 1; // git's "key absent" — the local-only testing scenario
        throw err;
      }
      return '';
    };

    const result = deleteBranch(dir, 'sprint/v0.1-s1', { runner: testRunner });

    assert.equal(result.remote, 'no-origin');
    assert.ok(
      !calls.some((c) => c.includes('ls-remote')),
      'with no origin there is nothing to ask a remote about',
    );
  } finally {
    cleanup();
  }
});

test('deleteBranch reports failed when ls-remote fails and an origin exists', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const testRunner = (cmd, args) => {
      if (args[0] === 'config') return 'https://example.invalid/r.git';
      if (args[0] === 'ls-remote') {
        // THE DEFECT THIS SPRINT REMOVES. Before the fix this was caught by a
        // bare `return`, the push was skipped, and main() printed success.
        const err = new Error("git ls-remote failed: fatal: could not read Username for 'https://github.com'");
        err.status = 128;
        throw err;
      }
      return '';
    };

    const result = deleteBranch(dir, 'sprint/v0.1-s1', { runner: testRunner });

    assert.equal(
      result.remote,
      'failed',
      'an ls-remote failure with an origin configured is NOT "nothing to delete"',
    );
    assert.match(result.error, /could not read Username/);
  } finally {
    cleanup();
  }
});

test('deleteBranch reports absent when origin exists but the branch is not on it', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const calls = [];
    const testRunner = (cmd, args) => {
      calls.push(args.join(' '));
      if (args[0] === 'config') return 'https://example.invalid/r.git';
      if (args[0] === 'ls-remote') return '';
      return '';
    };

    const result = deleteBranch(dir, 'sprint/v0.1-s1', { runner: testRunner });

    assert.equal(result.remote, 'absent');
    assert.ok(
      !calls.some((c) => c.includes('push')),
      'nothing on the remote to delete',
    );
  } finally {
    cleanup();
  }
});

test('deleteBranch reports deleted when the remote branch was removed', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const testRunner = (cmd, args) => {
      if (args[0] === 'config') return 'https://example.invalid/r.git';
      if (args[0] === 'ls-remote') return 'abc1234\trefs/heads/sprint/v0.1-s1';
      return '';
    };

    const result = deleteBranch(dir, 'sprint/v0.1-s1', { runner: testRunner });

    assert.deepEqual(result, { remote: 'deleted' });
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

test('removeWorktreeForBranch removes the clean worktree holding the branch', () => {
  const calls = [];
  const result = removeWorktreeForBranch('C:/repos/asdlc', 'sprint/v0.1-s1', {
    runner: makeWorktreeStub({ calls }),
  });

  assert.deepEqual(result, {
    removed: true,
    forced: false,
    path: 'C:/repos/asdlc-wt/v0.1-s1',
  });
  assert.ok(
    calls.includes('git worktree remove C:/repos/asdlc-wt/v0.1-s1'),
    `expected a plain worktree remove, got: ${JSON.stringify(calls)}`,
  );
  assert.ok(
    !calls.some((c) => c.includes('--force')),
    'a clean worktree must not be removed with --force',
  );
});

test('removeWorktreeForBranch is a no-op when no worktree holds the branch', () => {
  const calls = [];
  const result = removeWorktreeForBranch('C:/repos/asdlc', 'sprint/v9.9-s9', {
    runner: makeWorktreeStub({ calls }),
  });

  assert.deepEqual(result, { removed: false, reason: 'no-worktree' });
  assert.ok(
    !calls.some((c) => c.startsWith('git worktree remove')),
    `nothing should be removed, got: ${JSON.stringify(calls)}`,
  );
  // No worktree also means no tree to inspect for dirtiness.
  assert.ok(!calls.some((c) => c.startsWith('git status')));
});

test('removeWorktreeForBranch refuses a dirty worktree and reports what it found', () => {
  const calls = [];
  const result = removeWorktreeForBranch('C:/repos/asdlc', 'sprint/v0.1-s1', {
    runner: makeWorktreeStub({
      calls,
      statusOutput: ' M src/app.js\n?? notes.md',
    }),
  });

  assert.deepEqual(result, {
    removed: false,
    reason: 'dirty',
    path: 'C:/repos/asdlc-wt/v0.1-s1',
    changes: [' M src/app.js', '?? notes.md'],
  });
  assert.ok(
    !calls.some((c) => c.startsWith('git worktree remove')),
    `a dirty worktree must not be removed without force, got: ${JSON.stringify(calls)}`,
  );
});

test('removeWorktreeForBranch removes a dirty worktree when forced', () => {
  const calls = [];
  const result = removeWorktreeForBranch('C:/repos/asdlc', 'sprint/v0.1-s1', {
    force: true,
    runner: makeWorktreeStub({ calls, statusOutput: ' M src/app.js' }),
  });

  assert.deepEqual(result, {
    removed: true,
    forced: true,
    path: 'C:/repos/asdlc-wt/v0.1-s1',
  });
  assert.ok(
    calls.includes('git worktree remove --force C:/repos/asdlc-wt/v0.1-s1'),
    `expected a forced worktree remove, got: ${JSON.stringify(calls)}`,
  );
});

test('removeWorktreeForBranch refuses to remove the main worktree', () => {
  const calls = [];
  const result = removeWorktreeForBranch('C:/repos/asdlc', 'main', {
    force: true,
    runner: makeWorktreeStub({ calls }),
  });

  assert.deepEqual(result, {
    removed: false,
    reason: 'main-worktree',
    path: 'C:/repos/asdlc',
  });
  assert.ok(
    !calls.some((c) => c.startsWith('git worktree remove')),
    'the main worktree must never be removed, even under --force',
  );
});

// main() only needs a directory holding docs/STATUS.md: every git/gh call is
// intercepted by the stub, so a real fixture repo would buy nothing here.
function makeStatusDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-finish-'));
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'docs/STATUS.md'),
    '- 2026-07-20 **v0.1-s1** — First — [handoff](docs/handoffs/v0.1-s1-a.md) — status: awaiting-merge\n',
  );
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('main() removes the sprint worktree BEFORE deleting the branch', () => {
  const { dir, cleanup } = makeStatusDir();
  const originalCwd = process.cwd();
  const originalLog = console.log;
  try {
    console.log = () => {};
    const calls = [];
    process.chdir(dir);
    main(['v0.1-s1', 'abc1234'], { runner: makeWorktreeStub({ calls }) });

    const removeAt = calls.findIndex((c) => c.startsWith('git worktree remove'));
    const deleteAt = calls.findIndex((c) => /^git branch -[dD] /.test(c));
    assert.notEqual(removeAt, -1, `expected a worktree remove, got: ${JSON.stringify(calls)}`);
    assert.notEqual(deleteAt, -1, `expected a branch delete, got: ${JSON.stringify(calls)}`);
    // Ordering is load-bearing, not cosmetic: git refuses to delete a branch
    // that is checked out in another worktree.
    assert.ok(removeAt < deleteAt, `worktree removal must precede branch delete: ${JSON.stringify(calls)}`);

    assert.match(fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8'), /status: merged \(abc1234\)/);
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
    cleanup();
  }
});

test('main() still deletes the branch when no worktree holds it', () => {
  const { dir, cleanup } = makeStatusDir();
  const originalCwd = process.cwd();
  const originalLog = console.log;
  try {
    console.log = () => {};
    const calls = [];
    // Porcelain listing the main worktree only — the ordinary case.
    const porcelain = [
      'worktree C:/repos/asdlc',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
    ].join('\n');
    process.chdir(dir);
    main(['v0.1-s1', 'abc1234'], { runner: makeWorktreeStub({ calls, porcelain }) });

    assert.ok(
      !calls.some((c) => c.startsWith('git worktree remove')),
      'nothing to remove when no worktree holds the branch',
    );
    assert.ok(
      calls.some((c) => /^git branch -[dD] sprint\/v0\.1-s1$/.test(c)),
      `branch delete must still happen, got: ${JSON.stringify(calls)}`,
    );
    assert.match(fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8'), /status: merged \(abc1234\)/);
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
    cleanup();
  }
});

test('main() refuses a dirty worktree, touching nothing, and names the files at risk', () => {
  const { dir, cleanup } = makeStatusDir();
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  try {
    const errors = [];
    console.log = () => {};
    console.error = (...args) => errors.push(args.join(' '));
    const calls = [];
    process.chdir(dir);
    main(['v0.1-s1', 'abc1234'], {
      runner: makeWorktreeStub({ calls, statusOutput: ' M src/app.js\n?? notes.md' }),
    });

    assert.ok(
      !calls.some((c) => /^git branch -[dD] /.test(c)),
      `branch must survive a refusal, got: ${JSON.stringify(calls)}`,
    );
    // Refusing after STATUS.md was rewritten would strand the operator: the
    // re-run needed after --force would throw "no awaiting-merge entry".
    assert.match(fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8'), /status: awaiting-merge/);
    const text = errors.join('\n');
    assert.match(text, /src\/app\.js/);
    assert.match(text, /notes\.md/);
    assert.match(text, /--force/);
    assert.equal(process.exitCode, 1);
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
    cleanup();
  }
});

test('main() --force removes the dirty worktree and completes the sprint', () => {
  const { dir, cleanup } = makeStatusDir();
  const originalCwd = process.cwd();
  const originalLog = console.log;
  try {
    console.log = () => {};
    const calls = [];
    process.chdir(dir);
    // --force is passed first to prove it is stripped before positional parsing.
    main(['--force', 'v0.1-s1', 'abc1234'], {
      runner: makeWorktreeStub({ calls, statusOutput: ' M src/app.js' }),
    });

    assert.ok(
      calls.includes('git worktree remove --force C:/repos/asdlc-wt/v0.1-s1'),
      `expected a forced remove, got: ${JSON.stringify(calls)}`,
    );
    assert.ok(
      calls.some((c) => /^git branch -[dD] sprint\/v0\.1-s1$/.test(c)),
      `expected the branch delete, got: ${JSON.stringify(calls)}`,
    );
    assert.match(fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8'), /status: merged \(abc1234\)/);
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
    cleanup();
  }
});

test('originUrl returns null when no origin is configured', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // `git config --get` exits 1 for a missing key. The fixture repo has no
    // remote, so this is the real git behaviour, not a stub of it.
    assert.equal(originUrl(dir), null);
  } finally {
    cleanup();
  }
});

test('originUrl returns the configured url', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    run('git', ['remote', 'add', 'origin', 'https://example.invalid/r.git'], { cwd: dir });
    assert.equal(originUrl(dir), 'https://example.invalid/r.git');
  } finally {
    cleanup();
  }
});

test('originUrl propagates a failure that is not a missing key', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const testRunner = () => {
      // Exit 128 is git's "broken invocation" code — a corrupt config, or a
      // cwd that is not a git repository. Reporting it as "no origin" would
      // rebuild the very defect this sprint removes, one level down.
      const err = new Error('git config --get remote.origin.url failed: fatal: not a git repository');
      err.status = 128;
      throw err;
    };
    assert.throws(
      () => originUrl(dir, { runner: testRunner }),
      /not a git repository/,
      'a status-128 config failure must propagate, not be read as "no origin"',
    );
  } finally {
    cleanup();
  }
});

test('originUrl treats a configured-but-empty url as no origin', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const testRunner = () => '';
    assert.equal(
      originUrl(dir, { runner: testRunner }),
      null,
      'an origin with no url is not one that can be pushed to',
    );
  } finally {
    cleanup();
  }
});

test('main() exits non-zero and names the leftover branch when the remote delete fails', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  try {
    const statusPath = path.join(dir, 'docs/STATUS.md');
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, '- 2026-07-20 **v0.1-s1** — First — [handoff](docs/handoffs/v0.1-s1-a.md) — status: awaiting-merge\n');
    run('git', ['branch', 'sprint/v0.1-s1'], { cwd: dir });

    const logs = [];
    const errors = [];
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => errors.push(args.join(' '));

    const testRunner = (cmd, args, opts) => {
      // An origin IS configured, and the network is broken — this machine's
      // standing condition (docs/2026-08-04-shell-strategy.md).
      if (args[0] === 'config' && args.includes('remote.origin.url')) {
        return 'https://example.invalid/r.git';
      }
      if (args[0] === 'ls-remote') {
        const err = new Error('git ls-remote failed: fatal: unable to access');
        err.status = 128;
        throw err;
      }
      return run(cmd, args, opts);
    };

    // Clear it first: asserting it BECAME 1 is only meaningful if it wasn't
    // already 1 when the test started.
    process.exitCode = undefined;
    process.chdir(dir);
    main(['v0.1-s1', 'abc1234'], { runner: testRunner });

    assert.equal(process.exitCode, 1, 'a remote branch left behind is not a successful finish');
    const all = [...logs, ...errors].join('\n');
    assert.match(all, /sprint\/v0\.1-s1/, 'the leftover branch must be named');
    assert.match(all, /git push origin --delete sprint\/v0\.1-s1/, 'the remedy must be printed verbatim');
    assert.ok(
      !logs.some((l) => /local \+ remote if present/.test(l)),
      'the unconditional success line was the sentence that lied — it must be gone',
    );
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
    cleanup();
  }
});

test('main() leaves the exit code alone on a clean finish', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  try {
    const statusPath = path.join(dir, 'docs/STATUS.md');
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, '- 2026-07-20 **v0.1-s1** — First — [handoff](docs/handoffs/v0.1-s1-a.md) — status: awaiting-merge\n');
    run('git', ['branch', 'sprint/v0.1-s1'], { cwd: dir });

    console.log = () => {};
    process.exitCode = undefined;
    process.chdir(dir);

    // No origin in the fixture repo, so the remote half is a no-op.
    main(['v0.1-s1', 'abc1234'], { runner: (cmd, args, opts) => run(cmd, args, opts) });

    assert.equal(process.exitCode, undefined, 'a clean finish must not set a failure code');
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
    process.exitCode = originalExitCode;
    cleanup();
  }
});
