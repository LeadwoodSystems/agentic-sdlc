const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { checkGate, createSprint } = require('../new-sprint');

// A bare docs/ tree with no git repo behind it. The cases below stub every
// runner call checkGate makes, so makeFixtureRepo's `git init` + commit would
// buy nothing but latency — but the plan/handoff check reads the real
// filesystem, so a plain cwd string isn't enough either.
function makeDocsDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-gate-'));
  fs.mkdirSync(path.join(dir, 'docs/superpowers/plans'), { recursive: true });
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// `git diff --quiet` signals "the trees differ" through exit code 1, which is
// how lib/exec.js surfaces it: a throw carrying .status.
function treesDifferError() {
  const err = new Error('git diff --quiet failed: ');
  err.status = 1;
  return err;
}

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

test('checkGate respects a non-default trunk when checking for unmerged branches', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // Rename the fixture repo's default branch (created as `main`) to
    // `develop`, simulating a repo whose trunk isn't named `main` at all —
    // the exact scenario (gaw's `build/v0.1` trunk) that motivated this fix.
    run('git', ['branch', '-m', 'main', 'develop'], { cwd: dir });
    run('git', ['checkout', '-b', 'sprint/v0.1-s1'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'work.txt'), 'wip\n');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'wip'], { cwd: dir });
    run('git', ['checkout', 'develop'], { cwd: dir });
    run('git', ['merge', 'sprint/v0.1-s1'], { cwd: dir });

    // With the correct trunk passed, the sprint branch is genuinely merged
    // into `develop` and the gate must pass.
    const result = checkGate(dir, { trunk: 'develop' });
    assert.deepEqual(result, { blocked: false, reason: null });

    // With no trunk specified, checkGate falls back to the 'main' default —
    // which doesn't exist in this repo at all, so `git log main..branch`
    // fails outright rather than silently misreporting.
    assert.throws(() => checkGate(dir));
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

test('checkGate does not block on a squash-merged sprint branch', async () => {
  const { dir, cleanup } = makeDocsDir();
  try {
    // The regression this replaces: after a squash-merge, `git log
    // <trunk>..<branch>` is permanently non-empty (the branch's own commits are
    // never on trunk), so the old gate blocked forever on a branch that was in
    // fact merged. The stub reproduces exactly that state — non-empty git log,
    // merged PR on the head branch — and the gate must pass.
    const stubRunner = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'for-each-ref') return 'sprint/v0.1-s1';
      if (cmd === 'gh') return JSON.stringify([{ number: 7 }]);
      if (cmd === 'git' && args[0] === 'log') return 'abc1234 wip\ndef5678 more wip';
      throw new Error(`unexpected call: ${cmd} ${args.join(' ')}`);
    };

    const result = checkGate(dir, {
      runner: stubRunner,
      findStaleWorktrees: () => [],
    });

    assert.deepEqual(result, { blocked: false, reason: null });
  } finally {
    cleanup();
  }
});

test('checkGate still blocks on a genuinely unmerged sprint branch, naming it', async () => {
  const { dir, cleanup } = makeDocsDir();
  try {
    const stubRunner = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'for-each-ref') return 'sprint/v0.1-s1';
      if (cmd === 'gh') return '[]';
      if (cmd === 'git' && args[0] === 'diff') throw treesDifferError();
      throw new Error(`unexpected call: ${cmd} ${args.join(' ')}`);
    };

    const result = checkGate(dir, {
      runner: stubRunner,
      findStaleWorktrees: () => [],
    });

    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'unmerged-branch');
    assert.match(result.detail, /sprint\/v0\.1-s1/);
  } finally {
    cleanup();
  }
});

test('checkGate names the offending plan file and the slug it looked for', async () => {
  const { dir, cleanup } = makeDocsDir();
  try {
    // A legacy filename that predates the vMAJOR.MINOR-sN-<slug>.md convention:
    // slugFromFilename can't strip a version prefix that isn't there, so the
    // slug it searches handoffs for is the whole basename. This is the real
    // case measured on this repo, and `unmatched-plan` alone never said so.
    fs.writeFileSync(
      path.join(dir, 'docs/superpowers/plans/2026-07-22-loop-hardening.md'),
      '# plan\n',
    );
    fs.mkdirSync(path.join(dir, 'docs/handoffs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/handoffs/loop-hardening.md'), '# handoff\n');

    const result = checkGate(dir, {
      runner: () => '',
      findStaleWorktrees: () => [],
    });

    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'unmatched-plan');
    assert.match(result.detail, /2026-07-22-loop-hardening\.md/);
  } finally {
    cleanup();
  }
});

test('checkGate reports an unmerged branch even when an unmatched plan also exists', async () => {
  const { dir, cleanup } = makeDocsDir();
  try {
    // The masking regression. A filename-convention complaint used to return
    // first and hide the branch check entirely, so a genuinely unmerged sprint
    // branch was invisible behind a tidiness problem.
    fs.writeFileSync(
      path.join(dir, 'docs/superpowers/plans/2026-07-22-loop-hardening.md'),
      '# plan\n',
    );

    const stubRunner = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'for-each-ref') return 'sprint/v0.1-s1';
      if (cmd === 'gh') return '[]';
      if (cmd === 'git' && args[0] === 'diff') throw treesDifferError();
      throw new Error(`unexpected call: ${cmd} ${args.join(' ')}`);
    };

    const result = checkGate(dir, {
      runner: stubRunner,
      findStaleWorktrees: () => [],
    });

    assert.equal(result.reason, 'unmerged-branch');
  } finally {
    cleanup();
  }
});

test('checkGate blocks on a stale worktree, naming it', async () => {
  const { dir, cleanup } = makeDocsDir();
  try {
    const result = checkGate(dir, {
      runner: () => '',
      findStaleWorktrees: () => [
        { path: '/tmp/wt-v0.1-s1', branch: 'sprint/v0.1-s1', reasons: ['dirty'] },
      ],
    });

    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'stale-worktree');
    assert.match(result.detail, /sprint\/v0\.1-s1/);
  } finally {
    cleanup();
  }
});

test('checkGate reports a stale worktree even when an unmatched plan also exists', async () => {
  const { dir, cleanup } = makeDocsDir();
  try {
    fs.writeFileSync(
      path.join(dir, 'docs/superpowers/plans/2026-07-22-loop-hardening.md'),
      '# plan\n',
    );

    const result = checkGate(dir, {
      runner: () => '',
      findStaleWorktrees: () => [
        { path: '/tmp/wt-v0.1-s1', branch: 'sprint/v0.1-s1', reasons: ['merged'] },
      ],
    });

    assert.equal(result.reason, 'stale-worktree');
  } finally {
    cleanup();
  }
});

test('checkGate receives the resolved trunk and runner when looking for stale worktrees', async () => {
  const { dir, cleanup } = makeDocsDir();
  try {
    const stubRunner = () => '';
    let seen = null;
    checkGate(dir, {
      trunk: 'develop',
      runner: stubRunner,
      findStaleWorktrees: (worktreeCwd, opts) => {
        seen = { worktreeCwd, opts };
        return [];
      },
    });

    assert.equal(seen.worktreeCwd, dir);
    assert.equal(seen.opts.trunk, 'develop');
    assert.equal(seen.opts.runner, stubRunner);
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

test('createSprint throws when _TEMPLATE.md contains no occurrence of the placeholder at all', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(dir, 'docs/superpowers/plans'), { recursive: true });
    // Template rewritten with different wording entirely — the placeholder
    // string never appears, so a naive "placeholder absent means it must
    // have been substituted" check would wrongly let this through.
    fs.writeFileSync(
      path.join(dir, 'docs/superpowers/plans/_TEMPLATE.md'),
      '# Unrelated Plan Template\n\n## Context (why)\n<fill in>\n',
    );
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'add unrelated template'], { cwd: dir });

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

test('createSprint falls back to the plugin reference template when the repo has no _TEMPLATE.md', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const reference = path.join(dir, 'reference-plan-template.md');
    fs.writeFileSync(reference, '# <Sprint id> — <Name> · Plan\n\n## Verification\n<fill in>\n');

    const { planPath } = createSprint(dir, 'v0.1-s1', 'my-feature', {
      referenceTemplatePath: reference,
    });

    const content = fs.readFileSync(path.join(dir, planPath), 'utf8');
    assert.match(
      content,
      /## Verification/,
      'with no _TEMPLATE.md the scaffold fell through to the two-line stub instead of the reference template',
    );
    assert.match(content, /v0\.1-s1 — my-feature/);
  } finally {
    cleanup();
  }
});

test('createSprint prefers the repo _TEMPLATE.md over the reference template', async () => {
  // Precedence is the whole point of the order: a project that has customised
  // its template must not have the plugin's copy silently win.
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(dir, 'docs/superpowers/plans'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs/superpowers/plans/_TEMPLATE.md'),
      '# <Sprint id> — <Name> · Plan\n\nLOCAL TEMPLATE\n',
    );
    const reference = path.join(dir, 'reference-plan-template.md');
    fs.writeFileSync(reference, '# <Sprint id> — <Name> · Plan\n\nREFERENCE TEMPLATE\n');

    const { planPath } = createSprint(dir, 'v0.1-s1', 'my-feature', {
      referenceTemplatePath: reference,
    });

    const content = fs.readFileSync(path.join(dir, planPath), 'utf8');
    assert.match(content, /LOCAL TEMPLATE/);
    assert.doesNotMatch(content, /REFERENCE TEMPLATE/);
  } finally {
    cleanup();
  }
});
