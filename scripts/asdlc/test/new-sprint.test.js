const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { checkGate } = require('../new-sprint');

test('checkGate passes on a clean repo with no plans/handoffs', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const result = checkGate(dir);
    assert.deepEqual(result, { blocked: false, reason: null });
  } finally {
    cleanup();
  }
});

test('checkGate blocks when the newest plan has no matching handoff', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(dir, 'docs/superpowers/plans'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/superpowers/plans/v0.1-s1-foo.md'), '# plan\n');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'add plan'], { cwd: dir });

    const result = checkGate(dir);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'unmatched-plan');
  } finally {
    cleanup();
  }
});

test('checkGate blocks when an unmerged sprint branch exists', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    run('git', ['checkout', '-b', 'sprint/v0.1-s1'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'work.txt'), 'wip\n');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'wip'], { cwd: dir });
    run('git', ['checkout', 'main'], { cwd: dir });

    const result = checkGate(dir);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'unmerged-branch');
  } finally {
    cleanup();
  }
});
