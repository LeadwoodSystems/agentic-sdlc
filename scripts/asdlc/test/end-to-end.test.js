const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { checkGate, createSprint } = require('../new-sprint');
const { appendStatusEntry, updateClaudeMdPointer } = require('../checkpoint-hooks');
const { run } = require('../lib/exec');

test('end-to-end: bootstrap seed -> new-sprint -> checkpoint-hooks', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // Simulate what /bootstrap-asdlc scaffolds: CLAUDE.md with the marker pair.
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
      '# Project',
      '',
      '## Where the build is',
      '<!-- asdlc:current-state:auto -->',
      '**Current state:** not started.',
      '<!-- /asdlc:current-state:auto -->',
      '',
    ].join('\n'));

    // /sprint: gate check passes on a fresh repo, then creates the sprint.
    const gate = checkGate(dir);
    assert.equal(gate.blocked, false);
    const { branch, planPath } = createSprint(dir, 'v0.1-s1', 'widgets');
    assert.equal(branch, 'sprint/v0.1-s1');
    assert.ok(fs.existsSync(path.join(dir, planPath)));

    // Simulate /handoff writing a handoff file.
    const handoffRelPath = 'docs/handoffs/v0.1-s1-widgets.md';
    fs.mkdirSync(path.join(dir, 'docs/handoffs'), { recursive: true });
    fs.writeFileSync(path.join(dir, handoffRelPath), '# v0.1-s1 — widgets · Handoff\n');

    // /checkpoint: append STATUS + update CLAUDE.md pointer.
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1', date: '2026-07-22', summary: 'Add widgets',
      handoffRelPath,
    });
    updateClaudeMdPointer(dir, `Add widgets — see [handoff](${handoffRelPath})`);

    const status = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8');
    assert.match(status, /v0\.1-s1.*status: awaiting-merge/);

    const claudeMd = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(claudeMd, /Add widgets/);
    assert.doesNotMatch(claudeMd, /not started/);

    // Commit the plan+handoff on the still-checked-out sprint branch (simulating
    // /checkpoint's staged commit) WITHOUT merging to main yet. A second /sprint
    // attempt right now must be gated — this is the exact "new sprint over an
    // uncommitted/unmerged prior one" failure mode the design set out to hard-block.
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'v0.1-s1: add widgets'], { cwd: dir });

    const gate2 = checkGate(dir);
    assert.equal(gate2.blocked, true); // sprint/v0.1-s1 has commits not yet merged into main
    assert.equal(gate2.reason, 'unmerged-branch');
  } finally {
    cleanup();
  }
});
