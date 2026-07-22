const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { appendStatusEntry } = require('../checkpoint-hooks');

test('appendStatusEntry creates STATUS.md and appends one line', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1',
      date: '2026-07-22',
      summary: 'Add widget support',
      handoffRelPath: 'docs/handoffs/v0.1-s1-widgets.md',
    });
    const content = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8');
    assert.match(
      content,
      /- 2026-07-22 \*\*v0\.1-s1\*\* — Add widget support — \[handoff\]\(docs\/handoffs\/v0\.1-s1-widgets\.md\) — status: awaiting-merge/
    );
  } finally {
    cleanup();
  }
});

test('appendStatusEntry only appends, never rewrites prior lines', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1', date: '2026-07-22', summary: 'First',
      handoffRelPath: 'docs/handoffs/v0.1-s1-a.md',
    });
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s2', date: '2026-07-23', summary: 'Second',
      handoffRelPath: 'docs/handoffs/v0.1-s2-b.md',
    });
    const lines = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8')
      .split('\n').filter((l) => l.startsWith('- '));
    assert.equal(lines.length, 2);
    assert.match(lines[0], /v0\.1-s1/);
    assert.match(lines[1], /v0\.1-s2/);
  } finally {
    cleanup();
  }
});

test('appendStatusEntry sanitizes newlines in summary', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1',
      date: '2026-07-22',
      summary: 'Add widget support\nand fix bugs',
      handoffRelPath: 'docs/handoffs/v0.1-s1-widgets.md',
    });
    const content = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8');
    // Should have header lines starting with #, and exactly one entry line starting with -
    const lines = content.split('\n');
    const entryLines = lines.filter((l) => l.startsWith('- '));
    assert.equal(entryLines.length, 1, 'Should have exactly one entry line');
    // Newline should be replaced with space
    assert.match(entryLines[0], /Add widget support and fix bugs/);
    assert(!entryLines[0].includes('\n'), 'Entry line should not contain embedded newlines');
  } finally {
    cleanup();
  }
});

test('appendStatusEntry creates docs directory if needed', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1',
      date: '2026-07-22',
      summary: 'Test entry',
      handoffRelPath: 'docs/handoffs/v0.1-s1-test.md',
    });
    assert(fs.existsSync(path.join(dir, 'docs/STATUS.md')));
  } finally {
    cleanup();
  }
});
