const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  FACTS_MARKERS,
  MANIFEST_REL_PATH,
  loadManifest,
  measureFacts,
  renderFactsBody,
  computeFactsUpdate,
  writeFactsBlock,
  isFactsBlockStale,
} = require('../facts');

const FACTS_SCRIPT = path.join(__dirname, '..', 'facts.js');

// A plain temp dir, not makeFixtureRepo: nothing here touches git, and a real
// `git init` per case would triple the runtime of this file for no coverage.
function makeTempProject({ manifest, claudeMd } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-facts-'));
  if (manifest !== undefined) {
    fs.mkdirSync(path.join(dir, '.asdlc'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, MANIFEST_REL_PATH),
      typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2),
    );
  }
  if (claudeMd !== undefined) {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);
  }
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const MANIFEST = {
  facts: [
    {
      label: 'asdlc unit tests',
      command: ['node', '--test', 'scripts/asdlc/test/**/*.test.js'],
      capture: 'tests (\\d+)',
    },
  ],
};

const DOC_LF = [
  '# Project',
  '',
  'Some preamble with special chars: !@#$%^&*()',
  '',
  '## Measured facts',
  '',
  FACTS_MARKERS.start,
  '- asdlc unit tests: **722**',
  FACTS_MARKERS.end,
  '',
  '## Later section',
  '- keep me, 特殊文字 and all',
  '',
].join('\n');

// Every stubbed runner in this file answers for exactly one declared command;
// an unexpected call throws rather than returning a plausible-looking string,
// so a wrong argv can never masquerade as a successful measurement.
function stubRunner(stdout) {
  return () => stdout;
}

function failingRunner({ status = 1, stderr = 'boom' } = {}) {
  return () => {
    const err = new Error(`node --test failed: ${stderr}`);
    err.status = status;
    err.stderr = stderr;
    throw err;
  };
}

test('loadManifest reads .asdlc/facts.json', () => {
  const { dir, cleanup } = makeTempProject({ manifest: MANIFEST });
  try {
    assert.deepEqual(loadManifest(dir), MANIFEST);
  } finally {
    cleanup();
  }
});

test('loadManifest fails with a clear message when the manifest is absent', () => {
  const { dir, cleanup } = makeTempProject({});
  try {
    assert.throws(() => loadManifest(dir), /\.asdlc[\\/]facts\.json.*not found/i);
  } finally {
    cleanup();
  }
});

test('loadManifest rejects a string command, naming the argv-array contract', () => {
  const { dir, cleanup } = makeTempProject({
    manifest: { facts: [{ label: 'x', command: 'node --test "a b"' }] },
  });
  try {
    assert.throws(() => loadManifest(dir), /argv array/i);
  } finally {
    cleanup();
  }
});

test('loadManifest rejects a fact with no label', () => {
  const { dir, cleanup } = makeTempProject({ manifest: { facts: [{ command: ['node', '-v'] }] } });
  try {
    assert.throws(() => loadManifest(dir), /label/i);
  } finally {
    cleanup();
  }
});

test('measureFacts extracts the first capture group from the command output', () => {
  const results = measureFacts('/anywhere', MANIFEST, {
    runner: stubRunner('ℹ tests 802\nℹ pass 802\nℹ fail 0'),
  });
  assert.deepEqual(results, [{ label: 'asdlc unit tests', value: '802', error: null }]);
});

test('measureFacts records the trimmed last line when no capture pattern is declared', () => {
  const manifest = { facts: [{ label: 'node version', command: ['node', '-v'] }] };
  const results = measureFacts('/anywhere', manifest, { runner: stubRunner('noise\n  v22.4.0  ') });
  assert.equal(results[0].value, 'v22.4.0');
});

test('measureFacts records a gap (not a value) when the command fails', () => {
  const results = measureFacts('/anywhere', MANIFEST, {
    runner: failingRunner({ status: 1, stderr: '3 tests failed' }),
  });
  assert.equal(results[0].value, null);
  assert.match(results[0].error, /exit 1/);
  assert.match(results[0].error, /3 tests failed/);
});

test('measureFacts records a gap when the capture pattern does not match the output', () => {
  const results = measureFacts('/anywhere', MANIFEST, { runner: stubRunner('no numbers here') });
  assert.equal(results[0].value, null);
  assert.match(results[0].error, /did not match/i);
});

test('measureFacts records a gap when the capture pattern is not a valid regex', () => {
  const manifest = { facts: [{ label: 'x', command: ['node', '-v'], capture: '([unclosed' }] };
  const results = measureFacts('/anywhere', manifest, { runner: stubRunner('v22.4.0') });
  assert.equal(results[0].value, null);
  assert.match(results[0].error, /pattern/i);
});

test('measureFacts records a gap when the command produces no output at all', () => {
  const manifest = { facts: [{ label: 'x', command: ['node', '-e', ''] }] };
  const results = measureFacts('/anywhere', manifest, { runner: stubRunner('   ') });
  assert.equal(results[0].value, null);
  assert.match(results[0].error, /no output/i);
});

test('renderFactsBody renders a measured fact as one bold line', () => {
  const body = renderFactsBody([{ label: 'asdlc unit tests', value: '802', error: null }]);
  assert.match(body, /^- asdlc unit tests: \*\*802\*\*$/m);
});

test('renderFactsBody renders a failed measurement as a visible UNMEASURED gap', () => {
  const body = renderFactsBody([
    { label: 'asdlc unit tests', value: null, error: 'exit 1 — 3 tests failed' },
  ]);
  assert.match(body, /UNMEASURED/);
  assert.match(body, /3 tests failed/);
  // The gap must not be renderable as a number, which is the whole point.
  assert.doesNotMatch(body, /asdlc unit tests: \*\*\d/);
});

test('renderFactsBody collapses newlines in a value so one fact stays one line', () => {
  const body = renderFactsBody([{ label: 'x', value: 'a\nb', error: null }]);
  assert.equal(body.split('\n').filter((l) => l.startsWith('- ')).length, 1);
});

test('writeFactsBlock appends the block when the span is absent', () => {
  const { dir, cleanup } = makeTempProject({
    manifest: MANIFEST,
    claudeMd: '# Project\n\nno span here\n',
  });
  try {
    const result = writeFactsBlock(dir, { runner: stubRunner('ℹ tests 802') });
    assert.equal(result.changed, true);
    const after = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.ok(after.startsWith('# Project\n\nno span here'));
    assert.match(after, /- asdlc unit tests: \*\*802\*\*/);
  } finally {
    cleanup();
  }
});

test('writeFactsBlock replaces the span exactly once and leaves the rest byte-identical', () => {
  const { dir, cleanup } = makeTempProject({ manifest: MANIFEST, claudeMd: DOC_LF });
  try {
    writeFactsBlock(dir, { runner: stubRunner('ℹ tests 802') });
    const after = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');

    assert.equal(after.split(FACTS_MARKERS.start).length - 1, 1, 'exactly one start marker');
    assert.equal(after.split(FACTS_MARKERS.end).length - 1, 1, 'exactly one end marker');
    assert.ok(!after.includes('722'), 'the stale number must be gone');

    const before = DOC_LF.slice(0, DOC_LF.indexOf(FACTS_MARKERS.start));
    const tail = DOC_LF.slice(DOC_LF.indexOf(FACTS_MARKERS.end) + FACTS_MARKERS.end.length);
    assert.ok(after.startsWith(before), 'text before the span must be byte-identical');
    assert.ok(after.endsWith(tail), 'text after the span must be byte-identical');
  } finally {
    cleanup();
  }
});

test('writeFactsBlock preserves a CRLF CLAUDE.md (files on disk here are CRLF)', () => {
  const { dir, cleanup } = makeTempProject({
    manifest: MANIFEST,
    claudeMd: DOC_LF.replace(/\n/g, '\r\n'),
  });
  try {
    writeFactsBlock(dir, { runner: stubRunner('ℹ tests 802') });
    const after = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.ok(!/[^\r]\n/.test(after), 'result must not contain a bare LF');
  } finally {
    cleanup();
  }
});

test('writeFactsBlock records a visible gap instead of leaving the stale number', () => {
  const { dir, cleanup } = makeTempProject({ manifest: MANIFEST, claudeMd: DOC_LF });
  try {
    const result = writeFactsBlock(dir, { runner: failingRunner({ status: 2, stderr: 'no such file' }) });
    const after = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.ok(!after.includes('722'), 'the stale number must NOT survive a failed measurement');
    assert.match(after, /UNMEASURED/);
    assert.match(after, /exit 2/);
    assert.equal(result.gaps.length, 1);
  } finally {
    cleanup();
  }
});

test('writeFactsBlock is idempotent — a second run rewrites nothing', () => {
  const { dir, cleanup } = makeTempProject({ manifest: MANIFEST, claudeMd: DOC_LF });
  try {
    writeFactsBlock(dir, { runner: stubRunner('ℹ tests 802') });
    const once = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    const second = writeFactsBlock(dir, { runner: stubRunner('ℹ tests 802') });
    assert.equal(second.changed, false);
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), once);
  } finally {
    cleanup();
  }
});

test('writeFactsBlock refuses a measured value carrying marker text (injection guard)', () => {
  const { dir, cleanup } = makeTempProject({ manifest: MANIFEST, claudeMd: DOC_LF });
  try {
    const hostile = { facts: [{ label: 'x', command: ['node', '-e', ''] }] };
    fs.writeFileSync(path.join(dir, MANIFEST_REL_PATH), JSON.stringify(hostile));
    assert.throws(
      () => writeFactsBlock(dir, { runner: stubRunner(`ok ${FACTS_MARKERS.end} injected`) }),
      /must not contain the asdlc:facts:auto marker/i,
    );
    assert.equal(
      fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'),
      DOC_LF,
      'CLAUDE.md must be byte-for-byte unchanged after a rejected update',
    );
  } finally {
    cleanup();
  }
});

test('writeFactsBlock fails with a clear message (no stack) when CLAUDE.md is absent', () => {
  const { dir, cleanup } = makeTempProject({ manifest: MANIFEST });
  try {
    assert.throws(
      () => writeFactsBlock(dir, { runner: stubRunner('ℹ tests 802') }),
      /CLAUDE\.md.*not found/i,
    );
  } finally {
    cleanup();
  }
});

test('isFactsBlockStale is true for a hand-edited count and false once rewritten', () => {
  const { dir, cleanup } = makeTempProject({ manifest: MANIFEST, claudeMd: DOC_LF });
  try {
    assert.equal(isFactsBlockStale(dir, { runner: stubRunner('ℹ tests 802') }), true);
    writeFactsBlock(dir, { runner: stubRunner('ℹ tests 802') });
    assert.equal(isFactsBlockStale(dir, { runner: stubRunner('ℹ tests 802') }), false);
  } finally {
    cleanup();
  }
});

test('computeFactsUpdate reports the change without touching the file', () => {
  const { dir, cleanup } = makeTempProject({ manifest: MANIFEST, claudeMd: DOC_LF });
  try {
    const result = computeFactsUpdate(dir, { runner: stubRunner('ℹ tests 802') });
    assert.equal(result.changed, true);
    assert.equal(result.current, DOC_LF);
    assert.match(result.next, /\*\*802\*\*/);
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), DOC_LF, 'file untouched');
  } finally {
    cleanup();
  }
});

// --- CLI ------------------------------------------------------------------
// These run the real script against real commands, so the argv/exit-code
// plumbing is covered rather than asserted about.

const REAL_MANIFEST = {
  facts: [{ label: 'answer', command: ['node', '-e', 'console.log("42")'] }],
};

function runCli(dir, args = []) {
  return spawnSync(process.execPath, [FACTS_SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
}

test('CLI rewrites the block and exits 0', () => {
  const { dir, cleanup } = makeTempProject({
    manifest: REAL_MANIFEST,
    claudeMd: `# P\n\n${FACTS_MARKERS.start}\n- answer: **41**\n${FACTS_MARKERS.end}\n`,
  });
  try {
    const result = runCli(dir);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /- answer: \*\*42\*\*/);
  } finally {
    cleanup();
  }
});

test('CLI --check exits non-zero when the block is stale and does not write', () => {
  const claudeMd = `# P\n\n${FACTS_MARKERS.start}\n- answer: **41**\n${FACTS_MARKERS.end}\n`;
  const { dir, cleanup } = makeTempProject({ manifest: REAL_MANIFEST, claudeMd });
  try {
    const result = runCli(dir, ['--check']);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /stale/i);
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), claudeMd, '--check must not write');
  } finally {
    cleanup();
  }
});

test('CLI --check exits 0 once the block is current', () => {
  const { dir, cleanup } = makeTempProject({
    manifest: REAL_MANIFEST,
    claudeMd: `# P\n\n${FACTS_MARKERS.start}\n- answer: **41**\n${FACTS_MARKERS.end}\n`,
  });
  try {
    assert.equal(runCli(dir).status, 0);
    const result = runCli(dir, ['--check']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  } finally {
    cleanup();
  }
});

test('CLI exits non-zero on a failed measurement, having written the gap', () => {
  const { dir, cleanup } = makeTempProject({
    manifest: { facts: [{ label: 'answer', command: ['node', '-e', 'process.exit(3)'] }] },
    claudeMd: `# P\n\n${FACTS_MARKERS.start}\n- answer: **41**\n${FACTS_MARKERS.end}\n`,
  });
  try {
    const result = runCli(dir);
    assert.notEqual(result.status, 0);
    const after = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(after, /UNMEASURED/);
    assert.ok(!after.includes('41'), 'the stale number must not survive');
  } finally {
    cleanup();
  }
});

test('CLI reports a missing CLAUDE.md as a message, not a stack trace', () => {
  const { dir, cleanup } = makeTempProject({ manifest: REAL_MANIFEST });
  try {
    const result = runCli(dir);
    assert.equal(result.status, 1);
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, /CLAUDE\.md.*not found/i);
    assert.doesNotMatch(output, /at Object\.<anonymous>/, 'output should not contain a stack trace');
  } finally {
    cleanup();
  }
});

test('CLI reports a missing manifest as a message, not a stack trace', () => {
  const { dir, cleanup } = makeTempProject({ claudeMd: '# P\n' });
  try {
    const result = runCli(dir);
    assert.equal(result.status, 1);
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, /facts\.json.*not found/i);
    assert.doesNotMatch(output, /at Object\.<anonymous>/, 'output should not contain a stack trace');
  } finally {
    cleanup();
  }
});

test('CLI rejects an unknown argument instead of silently ignoring it', () => {
  const { dir, cleanup } = makeTempProject({ manifest: REAL_MANIFEST, claudeMd: '# P\n' });
  try {
    const result = runCli(dir, ['--dry-run']);
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /--dry-run/);
  } finally {
    cleanup();
  }
});

// This repo's own manifest must stay loadable — it is the contract's only
// shipped example, and a typo in it would only surface at checkpoint time.
test('this repo\'s .asdlc/facts.json is a valid manifest', () => {
  const repoRoot = path.join(__dirname, '..', '..', '..');
  const manifest = loadManifest(repoRoot);
  assert.ok(manifest.facts.length > 0, 'the shipped manifest must declare at least one fact');
});
