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
    // fixture repo has no remote, so git symbolic-ref will fail
    // The function should handle this gracefully, not throw
    const result = checkDefaultBranch(dir, 'main');
    assert.strictEqual(typeof result.actual, 'string');
    assert.strictEqual(typeof result.ok, 'boolean');
    // When origin/HEAD doesn't exist, actual should indicate this somehow
  } finally {
    cleanup();
  }
});
