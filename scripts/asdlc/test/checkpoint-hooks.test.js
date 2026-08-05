const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { appendStatusEntry, updateClaudeMdPointer } = require('../checkpoint-hooks');

const CHECKPOINT_HOOKS_SCRIPT = path.join(__dirname, '..', 'checkpoint-hooks.js');

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
      .split(/\r?\n/).filter((l) => l.startsWith('- '));
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
    const lines = content.split(/\r?\n/);
    const entryLines = lines.filter((l) => l.startsWith('- '));
    assert.equal(entryLines.length, 1, 'Should have exactly one entry line');
    // Newline should be replaced with space
    assert.match(entryLines[0], /Add widget support and fix bugs/);
    assert(!entryLines[0].includes('\n'), 'Entry line should not contain embedded newlines');
  } finally {
    cleanup();
  }
});

test('appendStatusEntry sanitizes newlines in sprintId', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1\nEVIL-INJECTED-LINE',
      date: '2026-07-22',
      summary: 'Add widget support',
      handoffRelPath: 'docs/handoffs/v0.1-s1-widgets.md',
    });
    const content = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8');
    const lines = content.split(/\r?\n/);
    const entryLines = lines.filter((l) => l.startsWith('- '));
    assert.equal(entryLines.length, 1, 'Should have exactly one entry line');
    assert.match(entryLines[0], /v0\.1-s1 EVIL-INJECTED-LINE/);
    assert(!entryLines[0].includes('\n'), 'Entry line should not contain embedded newlines');
    assert(!entryLines[0].includes('\r'), 'Entry line should not contain embedded carriage returns');
  } finally {
    cleanup();
  }
});

test('appendStatusEntry sanitizes newlines in handoffRelPath', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1',
      date: '2026-07-22',
      summary: 'Add widget support',
      handoffRelPath: 'docs/handoffs/v0.1-s1-widgets.md\nEVIL-INJECTED-LINE',
    });
    const content = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8');
    const lines = content.split(/\r?\n/);
    const entryLines = lines.filter((l) => l.startsWith('- '));
    assert.equal(entryLines.length, 1, 'Should have exactly one entry line');
    assert.match(entryLines[0], /v0\.1-s1-widgets\.md EVIL-INJECTED-LINE/);
    assert(!entryLines[0].includes('\n'), 'Entry line should not contain embedded newlines');
    assert(!entryLines[0].includes('\r'), 'Entry line should not contain embedded carriage returns');
  } finally {
    cleanup();
  }
});

test('appendStatusEntry sanitizes bare carriage returns in summary', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1',
      date: '2026-07-22',
      summary: 'Add widget support\rand fix bugs',
      handoffRelPath: 'docs/handoffs/v0.1-s1-widgets.md',
    });
    const content = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8');
    const lines = content.split(/\r?\n/);
    const entryLines = lines.filter((l) => l.startsWith('- '));
    assert.equal(entryLines.length, 1, 'Should have exactly one entry line');
    assert.match(entryLines[0], /Add widget support and fix bugs/);
    assert(!entryLines[0].includes('\n'), 'Entry line should not contain embedded newlines');
    assert(!entryLines[0].includes('\r'), 'Entry line should not contain embedded carriage returns');
  } finally {
    cleanup();
  }
});

test('appendStatusEntry sanitizes newlines in date', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1',
      date: '2026-07-22\nEVIL-INJECTED-LINE',
      summary: 'Add widget support',
      handoffRelPath: 'docs/handoffs/v0.1-s1-widgets.md',
    });
    const content = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8');
    const lines = content.split(/\r?\n/);
    const entryLines = lines.filter((l) => l.startsWith('- '));
    assert.equal(entryLines.length, 1, 'Should have exactly one entry line');
    assert.match(entryLines[0], /2026-07-22 EVIL-INJECTED-LINE/);
    assert(!entryLines[0].includes('\n'), 'Entry line should not contain embedded newlines');
    assert(!entryLines[0].includes('\r'), 'Entry line should not contain embedded carriage returns');
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

test('updateClaudeMdPointer rewrites only the marked span', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const claudeMd = [
      '# Project',
      '',
      '## Where the build is',
      '<!-- asdlc:current-state:auto -->',
      '**Current state:** old stale line.',
      '<!-- /asdlc:current-state:auto -->',
      '',
      'To resume, read the latest handoff.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);

    updateClaudeMdPointer(dir, 'v0.1-s1 shipped widgets — see docs/handoffs/v0.1-s1-widgets.md');

    const result = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(result, /\*\*Current state:\*\* v0\.1-s1 shipped widgets/);
    assert.doesNotMatch(result, /old stale line/);
    assert.match(result, /To resume, read the latest handoff\./);
  } finally {
    cleanup();
  }
});

test('updateClaudeMdPointer throws if markers are missing', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Project\nno markers here\n');
    assert.throws(() => updateClaudeMdPointer(dir, 'anything'), /marker/i);
  } finally {
    cleanup();
  }
});

test('updateClaudeMdPointer throws if file does not exist', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    assert.throws(() => updateClaudeMdPointer(dir, 'anything'), /ENOENT|no such file/i);
  } finally {
    cleanup();
  }
});

test('updateClaudeMdPointer preserves byte-for-byte everything outside markers', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const claudeMd = [
      '# Project',
      '',
      'Some preamble text with special chars: !@#$%^&*()',
      '',
      '<!-- asdlc:current-state:auto -->',
      'OLD',
      '<!-- /asdlc:current-state:auto -->',
      '',
      'Footer with 特殊文字 and more text',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);

    updateClaudeMdPointer(dir, 'NEW STATE');

    const result = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    // Check preamble is unchanged
    assert.match(result, /# Project/);
    assert(result.includes('Some preamble text with special chars: !@#$%^&*()'));
    // Check footer is unchanged
    assert(result.includes('Footer with 特殊文字 and more text'));
    // Check new state is there
    assert.match(result, /\*\*Current state:\*\* NEW STATE/);
    // Check old state is gone
    assert.doesNotMatch(result, /OLD/);
  } finally {
    cleanup();
  }
});

test('updateClaudeMdPointer handles markers on same line as other content', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const claudeMd = 'Prefix <!-- asdlc:current-state:auto -->OLD<!-- /asdlc:current-state:auto --> Suffix';
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);

    updateClaudeMdPointer(dir, 'NEW');

    const result = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(result, /Prefix <!-- asdlc:current-state:auto -->/);
    assert.match(result, /<!-- \/asdlc:current-state:auto --> Suffix/);
    assert.match(result, /\*\*Current state:\*\* NEW/);
    assert.doesNotMatch(result, /OLD/);
  } finally {
    cleanup();
  }
});

test('updateClaudeMdPointer throws if summaryLine contains the end marker text, and does not corrupt the file', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const claudeMd = [
      '# Project',
      '',
      '<!-- asdlc:current-state:auto -->',
      '**Current state:** old stale line.',
      '<!-- /asdlc:current-state:auto -->',
      '',
      'To resume, read the latest handoff.',
      '',
    ].join('\n');
    const claudeMdPath = path.join(dir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, claudeMd);

    const evilSummary = 'shipped widgets <!-- /asdlc:current-state:auto --> and more text after';
    assert.throws(
      () => updateClaudeMdPointer(dir, evilSummary),
      /must not contain the asdlc:current-state:auto marker/i
    );

    const after = fs.readFileSync(claudeMdPath, 'utf8');
    assert.equal(after, claudeMd, 'CLAUDE.md must be byte-for-byte unchanged after a rejected update');
  } finally {
    cleanup();
  }
});

test('updateClaudeMdPointer throws if summaryLine contains the start marker text, and does not corrupt the file', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const claudeMd = [
      '# Project',
      '',
      '<!-- asdlc:current-state:auto -->',
      '**Current state:** old stale line.',
      '<!-- /asdlc:current-state:auto -->',
      '',
      'To resume, read the latest handoff.',
      '',
    ].join('\n');
    const claudeMdPath = path.join(dir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, claudeMd);

    const evilSummary = 'shipped widgets <!-- asdlc:current-state:auto --> and more text after';
    assert.throws(
      () => updateClaudeMdPointer(dir, evilSummary),
      /must not contain the asdlc:current-state:auto marker/i
    );

    const after = fs.readFileSync(claudeMdPath, 'utf8');
    assert.equal(after, claudeMd, 'CLAUDE.md must be byte-for-byte unchanged after a rejected update');
  } finally {
    cleanup();
  }
});

test('CLI main() skips CLAUDE.md pointer update with a warning (not a crash) when CLAUDE.md is missing, and still appends STATUS.md', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    assert(!fs.existsSync(path.join(dir, 'CLAUDE.md')), 'fixture repo must not have a CLAUDE.md');

    const result = spawnSync(
      process.execPath,
      [
        CHECKPOINT_HOOKS_SCRIPT,
        'v0.1-s1',
        '2026-07-22',
        'docs/handoffs/v0.1-s1-widgets.md',
        'Add', 'widget', 'support',
      ],
      { cwd: dir, encoding: 'utf8' }
    );

    assert.equal(result.status, 0, `CLI should exit 0; stderr: ${result.stderr}`);

    const statusContent = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8');
    assert.match(
      statusContent,
      /- 2026-07-22 \*\*v0\.1-s1\*\* — Add widget support — \[handoff\]\(docs\/handoffs\/v0\.1-s1-widgets\.md\) — status: awaiting-merge/
    );

    const combinedOutput = `${result.stdout}${result.stderr}`;
    assert.match(combinedOutput, /Skipped CLAUDE\.md pointer update/i);
    assert.doesNotMatch(combinedOutput, /at Object\.<anonymous>/, 'output should not contain a stack trace');
  } finally {
    cleanup();
  }
});

// Total LF minus CRLF pairs = the LFs that are NOT part of a CRLF. Counting this
// way rather than with a lookbehind keeps the intent readable: a CRLF document
// that gained a bare \n is exactly what `core.autocrlf` hides from `git diff`.
function bareLfCount(text) {
  const lf = (text.match(/\n/g) || []).length;
  const crlf = (text.match(/\r\n/g) || []).length;
  return lf - crlf;
}

test('updateClaudeMdPointer writes CRLF into a CRLF CLAUDE.md', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const claudeMdPath = path.join(dir, 'CLAUDE.md');
    fs.writeFileSync(claudeMdPath, [
      '# Project',
      '',
      '<!-- asdlc:current-state:auto -->',
      '**Current state:** old',
      '<!-- /asdlc:current-state:auto -->',
      '',
      'Footer.',
      '',
    ].join('\r\n'));

    updateClaudeMdPointer(dir, 'v0.1-s1 shipped widgets');

    const after = fs.readFileSync(claudeMdPath, 'utf8');
    assert.equal(
      bareLfCount(after),
      0,
      'the pointer was spliced in with literal \\n, leaving a CRLF document with mixed endings',
    );
    assert.match(after, /\*\*Current state:\*\* v0\.1-s1 shipped widgets/);
  } finally {
    cleanup();
  }
});

test('appendStatusEntry writes CRLF into a CRLF STATUS.md', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const statusPath = path.join(dir, 'docs/STATUS.md');
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, '# STATUS\r\n\r\n');

    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1', date: '2026-07-22', summary: 'Add widget support',
      handoffRelPath: 'docs/handoffs/v0.1-s1-widgets.md',
    });

    assert.equal(
      bareLfCount(fs.readFileSync(statusPath, 'utf8')),
      0,
      'the entry line ended in a literal \\n, leaving a CRLF document with mixed endings',
    );
  } finally {
    cleanup();
  }
});

test('appendStatusEntry uses LF for a STATUS.md it creates', async () => {
  // A file with no content has no ending to detect. LF is chosen deliberately:
  // git's autocrlf normalises it on checkout, and guessing CRLF would impose a
  // house style on repos that do not use one.
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1', date: '2026-07-22', summary: 'First',
      handoffRelPath: 'docs/handoffs/v0.1-s1-a.md',
    });
    const content = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8');
    assert.equal((content.match(/\r\n/g) || []).length, 0, 'a newly created STATUS.md should be LF');
    assert.ok(bareLfCount(content) > 0);
  } finally {
    cleanup();
  }
});
