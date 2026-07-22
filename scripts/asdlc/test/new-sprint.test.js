const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { checkGate, createSprint } = require('../new-sprint');

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

test('checkGate passes when a sprint branch exists but has no commits ahead of main', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    run('git', ['branch', 'sprint/v0.1-s1'], { cwd: dir });

    const result = checkGate(dir);
    assert.deepEqual(result, { blocked: false, reason: null });
  } finally {
    cleanup();
  }
});

test('checkGate uses the injected runner instead of the real run()', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const calls = [];
    const stubRunner = (cmd, args, opts) => {
      calls.push(args);
      if (args[0] === 'for-each-ref') return '';
      return '';
    };

    const result = checkGate(dir, { runner: stubRunner });

    assert.deepEqual(result, { blocked: false, reason: null });
    assert.ok(
      calls.some((args) => args[0] === 'for-each-ref' && args.includes('refs/heads/sprint/*')),
      'expected for-each-ref to be called via the injected runner',
    );
  } finally {
    cleanup();
  }
});

test('checkGate treats double-digit sprint numbers as newer than single-digit ones', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(dir, 'docs/superpowers/plans'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/superpowers/plans/v0.1-s2-foo.md'), '# plan\n');
    fs.writeFileSync(path.join(dir, 'docs/superpowers/plans/v0.1-s10-bar.md'), '# plan\n');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'add plans'], { cwd: dir });

    // No matching handoff for either: newest plan (s10) should be the one that
    // triggers unmatched-plan.
    const result = checkGate(dir);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'unmatched-plan');

    // Now add a handoff matching the s10 plan's slug. If s2 (which sorts
    // later lexicographically) were incorrectly picked as "newest", this
    // would still block on unmatched-plan.
    fs.mkdirSync(path.join(dir, 'docs/handoffs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/handoffs/v0.1-s10-bar.md'), '# handoff\n');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'add handoff for s10'], { cwd: dir });

    const result2 = checkGate(dir);
    assert.deepEqual(result2, { blocked: false, reason: null });
  } finally {
    cleanup();
  }
});

test('createSprint creates a branch and seeds a plan file', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const { branch, planPath } = createSprint(dir, 'v0.1-s1', 'my-feature');
    assert.equal(branch, 'sprint/v0.1-s1');
    assert.ok(fs.existsSync(path.join(dir, planPath)));

    const current = run('git', ['branch', '--show-current'], { cwd: dir });
    assert.equal(current, 'sprint/v0.1-s1');

    const content = fs.readFileSync(path.join(dir, planPath), 'utf8');
    assert.match(content, /v0\.1-s1/);
  } finally {
    cleanup();
  }
});

test('createSprint seeds from _TEMPLATE.md when present', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(dir, 'docs/superpowers/plans'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs/superpowers/plans/_TEMPLATE.md'),
      '# <Sprint id> — <Name> · Plan\n\n## Context (why)\n<fill in>\n'
    );
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'add template'], { cwd: dir });

    const { planPath } = createSprint(dir, 'v0.1-s1', 'my-feature');
    const content = fs.readFileSync(path.join(dir, planPath), 'utf8');
    assert.match(content, /v0\.1-s1 — my-feature/);
    assert.doesNotMatch(content, /<Sprint id>/);
  } finally {
    cleanup();
  }
});

test('createSprint throws when slug contains path traversal characters', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const plansDir = path.join(dir, 'docs/superpowers/plans');
    const before = fs.existsSync(plansDir) ? fs.readdirSync(plansDir) : null;

    assert.throws(
      () => createSprint(dir, 'v0.1-s1', '../../../../tmp/evil'),
      /Invalid slug/,
    );

    const after = fs.existsSync(plansDir) ? fs.readdirSync(plansDir) : null;
    assert.deepEqual(after, before, 'no new file should appear under docs/superpowers/plans');
  } finally {
    cleanup();
  }
});

test('createSprint throws when sprintId contains invalid characters', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    assert.throws(
      () => createSprint(dir, '../../etc/evil', 'my-feature'),
      /Invalid sprintId/,
    );
  } finally {
    cleanup();
  }
});

test('createSprint succeeds with a normal sprintId/slug (regression guard)', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const { branch, planPath } = createSprint(dir, 'v0.1-s1', 'my-feature');
    assert.equal(branch, 'sprint/v0.1-s1');
    assert.equal(planPath, path.join('docs/superpowers/plans', 'v0.1-s1-my-feature.md'));
    assert.ok(fs.existsSync(path.join(dir, planPath)));
  } finally {
    cleanup();
  }
});

test('createSprint throws when _TEMPLATE.md does not contain the expected placeholder', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(dir, 'docs/superpowers/plans'), { recursive: true });
    // Placeholder wording changed (hyphen instead of the em-dash the regex
    // expects), so the marker text survives the .replace() call unexpanded.
    fs.writeFileSync(
      path.join(dir, 'docs/superpowers/plans/_TEMPLATE.md'),
      '# <Sprint id> - <Name> · Plan\n\n## Context (why)\n<fill in>\n',
    );
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'add mismatched template'], { cwd: dir });

    assert.throws(
      () => createSprint(dir, 'v0.1-s1', 'my-feature'),
      /_TEMPLATE\.md/,
    );

    const planPath = path.join(dir, 'docs/superpowers/plans/v0.1-s1-my-feature.md');
    assert.equal(fs.existsSync(planPath), false, 'no broken plan file should be written');
  } finally {
    cleanup();
  }
});

test('createSprint uses injected runner', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const calls = [];
    const stubRunner = (cmd, args, opts) => {
      calls.push({ cmd, args });
      if (args[0] === 'checkout') return '';
      return '';
    };

    createSprint(dir, 'v0.1-s1', 'test', { runner: stubRunner });

    assert.ok(
      calls.some((c) => c.args[0] === 'checkout' && c.args[1] === '-b'),
      'expected git checkout -b to be called via the injected runner',
    );
  } finally {
    cleanup();
  }
});
