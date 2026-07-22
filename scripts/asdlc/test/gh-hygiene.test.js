const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { findStaleBranches, checkDefaultBranch } = require('../gh-hygiene');

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
