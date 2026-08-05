const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const {
  findStaleBranches,
  findStaleWorktrees,
  checkDefaultBranch,
  findUntriagedIssues,
  checkMilestoneVersionSync,
  findFailingScheduledWorkflows,
  runHygieneAudit,
} = require('../gh-hygiene');

// `git worktree list --porcelain` emits FORWARD-slash paths even on Windows
// (verified on this repo: `worktree C:/Users/User/Documents/agentic-sdlc`),
// while os.tmpdir()-derived paths arrive with backslashes. Normalise before
// comparing so these assertions aren't platform-dependent.
const norm = (p) => p.replace(/\\/g, '/');

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-wt-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

test('findStaleBranches finds merged sprint branches', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    run('git', ['branch', 'sprint/v0.1-s1'], { cwd: dir }); // merged: no new commits
    run('git', ['checkout', '-b', 'sprint/v0.1-s2'], { cwd: dir });
    require('node:fs').writeFileSync(require('node:path').join(dir, 'x.txt'), 'x');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'wip'], { cwd: dir }); // not merged
    run('git', ['checkout', 'main'], { cwd: dir });

    const stale = findStaleBranches(dir);
    assert.deepEqual(stale, ['sprint/v0.1-s1']);
  } finally {
    cleanup();
  }
});

test('findStaleBranches respects a non-default trunk', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // Rename the fixture repo's default branch (created as `main`) to
    // `develop`, so `main` doesn't exist in this repo at all.
    run('git', ['branch', '-m', 'main', 'develop'], { cwd: dir });
    run('git', ['branch', 'sprint/v0.1-s1'], { cwd: dir }); // merged: no new commits vs develop
    run('git', ['checkout', '-b', 'sprint/v0.1-s2'], { cwd: dir });
    require('node:fs').writeFileSync(require('node:path').join(dir, 'x.txt'), 'x');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'wip'], { cwd: dir }); // not merged vs develop
    run('git', ['checkout', 'develop'], { cwd: dir });

    const stale = findStaleBranches(dir, { trunk: 'develop' });
    assert.deepEqual(stale, ['sprint/v0.1-s1']);

    // Passing no trunk falls back to the 'main' default, which doesn't exist
    // in this repo — must fail loudly rather than silently misreport.
    assert.throws(() => findStaleBranches(dir));
  } finally {
    cleanup();
  }
});

test('findStaleBranches reports a SQUASH-merged branch as stale', async () => {
  // The regression this whole change exists for. Verified live on 2026-08-04:
  // the audit printed `Stale merged branches: none` for a branch that had just
  // been squash-merged, because the old test was "`git log <trunk>..<branch>`
  // is empty" and a squash-merge leaves the branch's original commits absent
  // from trunk forever. A real fixture (not a stub) is used deliberately —
  // the point is that real git, on a real squash-merge, now answers correctly.
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    run('git', ['checkout', '-b', 'sprint/v0.9-s1'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'first'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'second'], { cwd: dir });

    run('git', ['checkout', 'main'], { cwd: dir });
    run('git', ['merge', '--squash', 'sprint/v0.9-s1'], { cwd: dir });
    run('git', ['commit', '-m', 'squashed sprint/v0.9-s1 (#1)'], { cwd: dir });

    // Sanity-check the fixture really reproduces the blind spot: the old
    // strategy's input is non-empty here, so a passing assertion below can
    // only come from the new strategy.
    assert.notEqual(
      run('git', ['log', 'main..sprint/v0.9-s1', '--oneline'], { cwd: dir }).length,
      0,
      'fixture is wrong: the branch commits should still be absent from trunk',
    );

    assert.deepEqual(findStaleBranches(dir), ['sprint/v0.9-s1']);
  } finally {
    cleanup();
  }
});

test('checkDefaultBranch compares origin/HEAD to the declared trunk (stubbed)', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = () => 'refs/remotes/origin/build/v0.1';
    const result = checkDefaultBranch(dir, 'main', { runner: stubRunner });
    assert.deepEqual(result, { ok: false, actual: 'build/v0.1' });
  } finally {
    cleanup();
  }
});

test('checkDefaultBranch handles missing origin/HEAD gracefully', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // fixture repo has no remote, so git symbolic-ref will fail with:
    //   fatal: ref refs/remotes/origin/HEAD is not a symbolic ref
    // The function should handle this specific failure gracefully, not throw.
    const result = checkDefaultBranch(dir, 'main');
    assert.deepEqual(result, { ok: false, actual: '<unknown>' });
  } finally {
    cleanup();
  }
});

test('checkDefaultBranch re-throws unrelated git failures instead of swallowing them', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = () => {
      throw new Error('git symbolic-ref refs/remotes/origin/HEAD failed: fatal: not a git repository (or any of the parent directories): .git');
    };
    assert.throws(
      () => checkDefaultBranch(dir, 'main', { runner: stubRunner }),
      /not a git repository/,
    );
  } finally {
    cleanup();
  }
});

test('findUntriagedIssues flags no-labels, no-milestone and no-execution-profile issues', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = () => JSON.stringify([
      { number: 1, labels: [], milestone: { title: 'v0.9' } },
      { number: 2, labels: [{ name: 'bug' }], milestone: null },
      { number: 3, labels: [{ name: 'bug' }], milestone: { title: 'v0.9' } },
    ]);
    const result = findUntriagedIssues(dir, { runner: stubRunner });
    assert.deepEqual(result, [
      { number: 1, reason: 'no-labels' },
      { number: 1, reason: 'no-execution-profile' },
      { number: 2, reason: 'no-milestone' },
      { number: 2, reason: 'no-execution-profile' },
      { number: 3, reason: 'no-execution-profile' },
    ]);
  } finally {
    cleanup();
  }
});

test('findUntriagedIssues clears an issue carrying all three routing labels', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = () => JSON.stringify([
      {
        number: 1,
        labels: [
          { name: 'bug' },
          { name: 'complexity/medium' },
          { name: 'risk/low' },
          { name: 'execution/standard' },
        ],
        milestone: { title: 'v0.9' },
      },
    ]);
    assert.deepEqual(findUntriagedIssues(dir, { runner: stubRunner }), []);
  } finally {
    cleanup();
  }
});

test('findUntriagedIssues still flags an issue missing just one routing axis', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = () => JSON.stringify([
      {
        number: 7,
        // complexity/* and execution/* present, risk/* missing.
        labels: [{ name: 'complexity/high' }, { name: 'execution/deep' }],
        milestone: { title: 'v0.9' },
      },
    ]);
    assert.deepEqual(findUntriagedIssues(dir, { runner: stubRunner }), [
      { number: 7, reason: 'no-execution-profile' },
    ]);
  } finally {
    cleanup();
  }
});

test('checkMilestoneVersionSync detects a version scheme mismatch', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = () => 'v0.1\nv0.2\nv1.0\n';
    const result = checkMilestoneVersionSync(dir, 'v0.12', { runner: stubRunner });
    assert.equal(result.inSync, false);
    assert.deepEqual(result.milestoneVersions, ['v0.1', 'v0.2', 'v1.0']);
  } finally {
    cleanup();
  }
});

test('checkMilestoneVersionSync extracts version-like tokens from titles with extra text', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // Real GitHub milestone titles are rarely bare "v0.12" strings — they're
    // usually something like "Sprint v0.12: <goal>". The interface spec says
    // this function "extracts version-like tokens (vX.Y) from milestone
    // titles", so it must pull the token out rather than compare whole titles.
    const stubRunner = () => 'Sprint v0.12: consolidate loop hardening\nBacklog\nv0.9 wrap-up\n';
    const result = checkMilestoneVersionSync(dir, 'v0.12', { runner: stubRunner });
    assert.equal(result.inSync, true);
    assert.deepEqual(result.milestoneVersions, ['v0.12', 'v0.9']);
  } finally {
    cleanup();
  }
});

test('runHygieneAudit aggregates all five checks', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = (cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('symbolic-ref')) return 'refs/remotes/origin/main';
      if (joined.includes('issue list')) return '[]';
      if (joined.includes('milestones')) return 'v0.12\n';
      if (joined.includes('worktree list')) return '';
      return '';
    };
    const report = runHygieneAudit(dir, {
      declaredTrunk: 'main',
      currentSprintVersion: 'v0.12',
      runner: stubRunner,
    });
    assert.deepEqual(report.staleBranches, []);
    assert.deepEqual(report.staleWorktrees, []);
    assert.deepEqual(report.defaultBranch, { ok: true, actual: 'main' });
    assert.deepEqual(report.untriagedIssues, []);
    assert.equal(report.milestoneSync.inSync, true);
  } finally {
    cleanup();
  }
});

test('runHygieneAudit isolates a failing gh-based check so git-based results still come back', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = (cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('symbolic-ref')) return 'refs/remotes/origin/main';
      if (joined.includes('for-each-ref')) return '';
      if (joined.includes('issue list')) throw new Error('gh: authentication required (gh auth login)');
      if (joined.includes('milestones')) throw new Error('gh: authentication required (gh auth login)');
      return '';
    };
    const report = runHygieneAudit(dir, {
      declaredTrunk: 'main',
      currentSprintVersion: 'v0.12',
      runner: stubRunner,
    });
    // The two git-only checks succeeded and must still be reported normally.
    assert.deepEqual(report.staleBranches, []);
    assert.deepEqual(report.defaultBranch, { ok: true, actual: 'main' });
    // The two gh-based checks failed; runHygieneAudit must not throw, and must
    // surface the failure distinctly instead of silently dropping it.
    assert.equal(typeof report.untriagedIssues.error, 'string');
    assert.match(report.untriagedIssues.error, /authentication required/);
    assert.equal(typeof report.milestoneSync.error, 'string');
    assert.match(report.milestoneSync.error, /authentication required/);
  } finally {
    cleanup();
  }
});

test('runHygieneAudit threads declaredTrunk into findStaleBranches, not a hardcoded main', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const calls = [];
    const stubRunner = (cmd, args) => {
      calls.push(args.join(' '));
      const joined = args.join(' ');
      if (joined.includes('symbolic-ref')) return 'refs/remotes/origin/build/v0.1';
      if (joined.includes('for-each-ref')) return 'sprint/v0.1-s1';
      if (joined.includes('pr list')) return '[]'; // no merged PR => fall through to the tree comparison
      if (joined.includes('issue list')) return '[]';
      if (joined.includes('milestones')) return 'v0.12\n';
      return ''; // git diff --quiet exit 0 => merged, whatever ref was asked for
    };
    const report = runHygieneAudit(dir, {
      declaredTrunk: 'build/v0.1',
      currentSprintVersion: 'v0.12',
      runner: stubRunner,
    });

    assert.deepEqual(report.staleBranches, ['sprint/v0.1-s1']);
    assert.deepEqual(report.defaultBranch, { ok: true, actual: 'build/v0.1' });
    // Same intent as before the squash-merge fix, re-expressed against the
    // argv the branch-status strategies actually use: there is no `git log`
    // call left to inspect, so the trunk now shows up on the `gh pr list`
    // head lookup and on the `git diff --quiet <trunk> <branch>` fallback.
    assert.ok(
      calls.some((c) => c === 'pr list --state merged --head sprint/v0.1-s1 --json number'),
      `expected the stale-branch check to ask gh about the enumerated branch, got calls: ${JSON.stringify(calls)}`,
    );
    assert.ok(
      calls.some((c) => c === 'diff --quiet build/v0.1 sprint/v0.1-s1'),
      `expected the stale-branch check to compare against declaredTrunk (build/v0.1), got calls: ${JSON.stringify(calls)}`,
    );
    assert.ok(
      !calls.some((c) => c.startsWith('diff --quiet main')),
      'declaredTrunk should be used instead of a hardcoded main',
    );
  } finally {
    cleanup();
  }
});

test('runHygieneAudit isolates a failing git-based check too, so a gh-based result still comes back', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = (cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('for-each-ref')) throw new Error('git: not a git repository');
      if (joined.includes('symbolic-ref')) throw new Error('git: not a git repository');
      if (joined.includes('issue list')) return '[]';
      if (joined.includes('milestones')) return 'v0.12\n';
      return '';
    };
    const report = runHygieneAudit(dir, {
      declaredTrunk: 'main',
      currentSprintVersion: 'v0.12',
      runner: stubRunner,
    });
    assert.equal(typeof report.staleBranches.error, 'string');
    assert.equal(typeof report.defaultBranch.error, 'string');
    assert.deepEqual(report.untriagedIssues, []);
    assert.equal(report.milestoneSync.inSync, true);
  } finally {
    cleanup();
  }
});

// --- findStaleWorktrees ---------------------------------------------------
//
// These are stubbed-runner tests with REAL directories: the runner intercepts
// every shell-out, but the age check reads the directory's own mtime off disk,
// so the paths in the fake porcelain output have to exist. (One real-git test
// at the end proves the parser matches what git actually emits.)

function worktreeStub({ porcelain, dirtyPaths = [], merged = false }) {
  const dirty = dirtyPaths.map(norm);
  return (cmd, args, opts) => {
    const joined = args.join(' ');
    if (joined.startsWith('worktree list')) return porcelain;
    if (joined.startsWith('status --porcelain')) {
      return dirty.includes(norm(opts.cwd)) ? ' M src/thing.js\n?? scratch.txt' : '';
    }
    if (cmd === 'gh') return merged ? JSON.stringify([{ number: 7 }]) : '[]';
    // git diff --quiet exits 1 for "the trees differ" => branch not merged.
    const err = new Error('git diff --quiet failed: ');
    err.status = 1;
    throw err;
  };
}

test('findStaleWorktrees flags a worktree holding uncommitted files', () => {
  // The motivating find: a 1.15 GB worktree in the GAW repo, last written
  // 2026-07-28, holding a branch with 14 uncommitted files — invisible to
  // every check the audit had.
  const main = makeTempDir();
  const wt = makeTempDir();
  try {
    const runner = worktreeStub({
      porcelain: [
        `worktree ${norm(main.dir)}`,
        'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'branch refs/heads/main',
        '',
        `worktree ${norm(wt.dir)}`,
        'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'branch refs/heads/sprint/v0.2-s2',
        '',
      ].join('\n'),
      dirtyPaths: [wt.dir],
    });

    assert.deepEqual(findStaleWorktrees(main.dir, { runner }), [
      {
        path: norm(wt.dir),
        branch: 'sprint/v0.2-s2',
        reasons: ['uncommitted-changes'],
      },
    ]);
  } finally {
    wt.cleanup();
    main.cleanup();
  }
});

test('findStaleWorktrees flags a worktree whose branch is already merged', () => {
  const main = makeTempDir();
  const wt = makeTempDir();
  try {
    const runner = worktreeStub({
      porcelain: [
        `worktree ${norm(main.dir)}`,
        'HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'branch refs/heads/main',
        '',
        `worktree ${norm(wt.dir)}`,
        'HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'branch refs/heads/sprint/v0.1-s3',
        '',
      ].join('\n'),
      merged: true,
    });

    assert.deepEqual(findStaleWorktrees(main.dir, { runner }), [
      { path: norm(wt.dir), branch: 'sprint/v0.1-s3', reasons: ['branch-merged'] },
    ]);
  } finally {
    wt.cleanup();
    main.cleanup();
  }
});

test('findStaleWorktrees flags a worktree older than maxAgeDays', () => {
  const main = makeTempDir();
  const wt = makeTempDir();
  try {
    fs.utimesSync(wt.dir, daysAgo(30), daysAgo(30));
    const runner = worktreeStub({
      porcelain: [
        `worktree ${norm(main.dir)}`,
        'branch refs/heads/main',
        '',
        `worktree ${norm(wt.dir)}`,
        'branch refs/heads/sprint/v0.1-s3',
        '',
      ].join('\n'),
    });

    assert.deepEqual(findStaleWorktrees(main.dir, { maxAgeDays: 14, runner }), [
      { path: norm(wt.dir), branch: 'sprint/v0.1-s3', reasons: ['older-than-14d'] },
    ]);
    // The same worktree under a longer horizon is not stale — the threshold is
    // really consulted rather than the age reason being unconditional.
    assert.deepEqual(findStaleWorktrees(main.dir, { maxAgeDays: 60, runner }), []);
  } finally {
    wt.cleanup();
    main.cleanup();
  }
});

test('findStaleWorktrees carries several reasons for one worktree', () => {
  const main = makeTempDir();
  const wt = makeTempDir();
  try {
    fs.utimesSync(wt.dir, daysAgo(30), daysAgo(30));
    const runner = worktreeStub({
      porcelain: [
        `worktree ${norm(main.dir)}`,
        'branch refs/heads/main',
        '',
        `worktree ${norm(wt.dir)}`,
        'branch refs/heads/sprint/v0.1-s3',
        '',
      ].join('\n'),
      dirtyPaths: [wt.dir],
      merged: true,
    });

    assert.deepEqual(findStaleWorktrees(main.dir, { runner }), [
      {
        path: norm(wt.dir),
        branch: 'sprint/v0.1-s3',
        reasons: ['branch-merged', 'uncommitted-changes', 'older-than-14d'],
      },
    ]);
  } finally {
    wt.cleanup();
    main.cleanup();
  }
});

test('findStaleWorktrees never flags the main working tree', () => {
  // The main tree is the FIRST record git emits, always. It is skipped by
  // record index rather than by comparing its path to cwd, because the audit
  // may legitimately be invoked from inside a linked worktree — in which case
  // a path comparison would exempt the wrong tree and flag the real one.
  const main = makeTempDir();
  const wt = makeTempDir();
  try {
    fs.utimesSync(main.dir, daysAgo(400), daysAgo(400));
    const runner = worktreeStub({
      porcelain: [
        `worktree ${norm(main.dir)}`,
        'branch refs/heads/main',
        '',
        `worktree ${norm(wt.dir)}`,
        'branch refs/heads/sprint/v0.2-s2',
        '',
      ].join('\n'),
      dirtyPaths: [main.dir, wt.dir],
      merged: true,
    });

    const findings = findStaleWorktrees(main.dir, { runner });
    assert.deepEqual(findings.map((f) => f.path), [norm(wt.dir)]);
  } finally {
    wt.cleanup();
    main.cleanup();
  }
});

test('findStaleWorktrees handles a detached worktree with no branch', () => {
  const main = makeTempDir();
  const wt = makeTempDir();
  try {
    const runner = worktreeStub({
      porcelain: [
        `worktree ${norm(main.dir)}`,
        'branch refs/heads/main',
        '',
        `worktree ${norm(wt.dir)}`,
        'HEAD cccccccccccccccccccccccccccccccccccccccc',
        'detached',
        '',
      ].join('\n'),
      dirtyPaths: [wt.dir],
    });

    // No branch => no merge question to ask, but the tree is still auditable.
    assert.deepEqual(findStaleWorktrees(main.dir, { runner }), [
      { path: norm(wt.dir), branch: null, reasons: ['uncommitted-changes'] },
    ]);
  } finally {
    wt.cleanup();
    main.cleanup();
  }
});

test('findStaleWorktrees parses real `git worktree list --porcelain` output', async () => {
  // The one non-stubbed case: proves the record parser matches what git
  // actually emits (blank-line-separated records, `refs/heads/` prefixes, and
  // — on Windows — forward-slash paths) rather than what this test file
  // imagines it emits.
  const { dir, cleanup } = await makeFixtureRepo();
  const wt = makeTempDir();
  const wtPath = path.join(wt.dir, 'linked');
  try {
    run('git', ['worktree', 'add', '-b', 'sprint/v0.9-s2', wtPath], { cwd: dir });
    fs.writeFileSync(path.join(wtPath, 'scratch.txt'), 'uncommitted\n');

    const findings = findStaleWorktrees(dir);
    assert.equal(findings.length, 1, `expected only the linked worktree, got ${JSON.stringify(findings)}`);
    assert.equal(findings[0].branch, 'sprint/v0.9-s2');
    assert.ok(
      norm(findings[0].path).endsWith('/linked'),
      `expected the linked worktree's path, got ${findings[0].path}`,
    );
    // Fresh branch off main with only an UNTRACKED file => identical trees, so
    // both the merge check and the dirty check fire.
    assert.deepEqual(findings[0].reasons, ['branch-merged', 'uncommitted-changes']);
  } finally {
    // Remove the linked worktree before the fixture repo, or git leaves an
    // administrative record pointing at a directory that no longer exists.
    try {
      run('git', ['worktree', 'remove', '--force', wtPath], { cwd: dir });
    } catch {
      // Best effort: the temp dirs are removed either way.
    }
    wt.cleanup();
    cleanup();
  }
});

test('runHygieneAudit isolates a failing worktree check from the other four', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = (cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('worktree list')) throw new Error('git: not a git repository');
      if (joined.includes('symbolic-ref')) return 'refs/remotes/origin/main';
      if (joined.includes('for-each-ref')) return '';
      if (joined.includes('issue list')) return '[]';
      if (joined.includes('milestones')) return 'v0.12\n';
      return '';
    };
    const report = runHygieneAudit(dir, {
      declaredTrunk: 'main',
      currentSprintVersion: 'v0.12',
      runner: stubRunner,
    });
    assert.equal(typeof report.staleWorktrees.error, 'string');
    assert.match(report.staleWorktrees.error, /not a git repository/);
    assert.deepEqual(report.staleBranches, []);
    assert.deepEqual(report.defaultBranch, { ok: true, actual: 'main' });
    assert.deepEqual(report.untriagedIssues, []);
    assert.equal(report.milestoneSync.inSync, true);
  } finally {
    cleanup();
  }
});

test('findFailingScheduledWorkflows filters by event server-side', () => {
  const calls = [];
  const runner = (cmd, args) => { calls.push({ cmd, args }); return '[]'; };
  findFailingScheduledWorkflows('/repo', { runner });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'gh');
  // Filtering client-side over a mixed --limit N list lets a weekly workflow fall
  // off the end and report as absent, which reads as clean — the silent-skip
  // failure class mutate.js exists to refuse.
  assert.deepEqual(calls[0].args.slice(0, 4), ['run', 'list', '--event', 'schedule']);
  assert.ok(calls[0].args.includes('workflowName,conclusion,status,createdAt'));
});

test('findFailingScheduledWorkflows flags a workflow whose last completed run failed', () => {
  const runner = () => JSON.stringify([
    { workflowName: 'nightly', status: 'completed', conclusion: 'failure', createdAt: '2026-08-05T02:00:00Z' },
  ]);
  assert.deepEqual(findFailingScheduledWorkflows('/repo', { runner }), [
    { workflow: 'nightly', conclusion: 'failure', createdAt: '2026-08-05T02:00:00Z' },
  ]);
});

test('findFailingScheduledWorkflows reads the last completed run, not the in-flight one', () => {
  const runner = () => JSON.stringify([
    { workflowName: 'nightly', status: 'in_progress', conclusion: null, createdAt: '2026-08-05T02:00:00Z' },
    { workflowName: 'nightly', status: 'completed', conclusion: 'failure', createdAt: '2026-08-04T02:00:00Z' },
  ]);
  assert.deepEqual(findFailingScheduledWorkflows('/repo', { runner }), [
    { workflow: 'nightly', conclusion: 'failure', createdAt: '2026-08-04T02:00:00Z' },
  ]);
});

test('findFailingScheduledWorkflows clears a workflow whose newest completed run succeeded', () => {
  let called = 0;
  const runner = () => {
    called += 1;
    return JSON.stringify([
      { workflowName: 'nightly', status: 'completed', conclusion: 'success', createdAt: '2026-08-05T02:00:00Z' },
      { workflowName: 'nightly', status: 'completed', conclusion: 'failure', createdAt: '2026-08-04T02:00:00Z' },
    ]);
  };
  // "most recent", not "any" — a fixed workflow must stop being reported.
  assert.deepEqual(findFailingScheduledWorkflows('/repo', { runner }), []);
  // An empty result must mean "queried and found nothing wrong", not "returned [] blindly".
  assert.equal(called, 1, 'must query gh, not return [] without looking');
});

test('findFailingScheduledWorkflows reports each workflow independently', () => {
  const runner = () => JSON.stringify([
    { workflowName: 'nightly', status: 'completed', conclusion: 'failure', createdAt: '2026-08-05T02:00:00Z' },
    { workflowName: 'weekly-audit', status: 'completed', conclusion: 'success', createdAt: '2026-08-01T02:00:00Z' },
    { workflowName: 'monthly-sweep', status: 'completed', conclusion: 'timed_out', createdAt: '2026-07-01T02:00:00Z' },
  ]);
  const findings = findFailingScheduledWorkflows('/repo', { runner });
  assert.deepEqual(findings.map((f) => f.workflow), ['nightly', 'monthly-sweep']);
});
