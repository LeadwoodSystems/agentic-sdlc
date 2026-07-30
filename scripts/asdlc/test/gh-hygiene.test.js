const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const {
  findStaleBranches,
  checkDefaultBranch,
  findUntriagedIssues,
  checkMilestoneVersionSync,
  runHygieneAudit,
} = require('../gh-hygiene');

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

test('runHygieneAudit aggregates all four checks', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = (cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('symbolic-ref')) return 'refs/remotes/origin/main';
      if (joined.includes('issue list')) return '[]';
      if (joined.includes('milestones')) return 'v0.12\n';
      if (joined.includes('branch --list')) return '';
      return '';
    };
    const report = runHygieneAudit(dir, {
      declaredTrunk: 'main',
      currentSprintVersion: 'v0.12',
      runner: stubRunner,
    });
    assert.deepEqual(report.staleBranches, []);
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
      if (joined.includes('log')) return ''; // treat as merged relative to whatever ref was asked for
      if (joined.includes('issue list')) return '[]';
      if (joined.includes('milestones')) return 'v0.12\n';
      return '';
    };
    const report = runHygieneAudit(dir, {
      declaredTrunk: 'build/v0.1',
      currentSprintVersion: 'v0.12',
      runner: stubRunner,
    });

    assert.deepEqual(report.staleBranches, ['sprint/v0.1-s1']);
    assert.deepEqual(report.defaultBranch, { ok: true, actual: 'build/v0.1' });
    assert.ok(
      calls.some((c) => c.startsWith('log build/v0.1..sprint/v0.1-s1')),
      `expected the stale-branch check to compare against declaredTrunk (build/v0.1), got calls: ${JSON.stringify(calls)}`,
    );
    assert.ok(
      !calls.some((c) => c.startsWith('log main..')),
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
