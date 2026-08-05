const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FACTS_MARKERS, MANIFEST_REL_PATH, writeFactsBlock } = require('../facts');
const {
  MAX_RULE_WORDS,
  countWords,
  extractRules,
  checkRetiredRules,
  checkRuleLength,
  checkContradictions,
  lintClaudeMd,
  formatFinding,
} = require('../asdlc-lint');

const LINT_SCRIPT = path.join(__dirname, '..', 'asdlc-lint.js');

// A plain temp dir, not makeFixtureRepo: this lint never shells out to git, and
// the stubbed runner intercepts the only command a fact would run.
function makeTempProject({ manifest, claudeMd, fileName = 'CLAUDE.md' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-lint-'));
  if (manifest !== undefined) {
    fs.mkdirSync(path.join(dir, '.asdlc'), { recursive: true });
    fs.writeFileSync(path.join(dir, MANIFEST_REL_PATH), JSON.stringify(manifest, null, 2));
  }
  if (claudeMd !== undefined) {
    fs.writeFileSync(path.join(dir, fileName), claudeMd);
  }
  return { dir, file: path.join(dir, fileName), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const MANIFEST = {
  facts: [{ label: 'asdlc unit tests', command: ['node', '--test', 'x'], capture: 'tests (\\d+)' }],
};

const stubRunner = (stdout) => () => stdout;

const RULES_HEADING = '## How we work (operating rules)';

const LIVE_RULES = [
  RULES_HEADING,
  '1. **Checkpoint after every sprint:** plan first, then TDD, then verify with evidence,',
  '   then write the handoff, then commit and stop for approval.',
  '2. **Git:** one branch per sprint, squash-merged to trunk. The branch is removed once the',
  '   PR merges, and the worktree that held it is removed with it. Never force-push a branch',
  '   another session may already have pulled, and never rewrite history that is on trunk.',
].join('\n');

// --- rule extraction --------------------------------------------------------

test('extractRules finds numbered rules with their line numbers and folded bodies', () => {
  const rules = extractRules(`# P\n\nintro\n\n${LIVE_RULES}\n\n## Stack\n1. not a rule\n`);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].number, 1);
  assert.equal(rules[1].number, 2);
  assert.equal(rules[0].line, 6, 'line number is 1-based and points at the rule itself');
  assert.match(rules[0].text, /stop for approval/, 'continuation lines fold into the rule');
  assert.ok(!rules[1].text.includes('not a rule'), 'the section ends at the next same-level heading');
});

test('extractRules returns nothing when the file declares no operating rules', () => {
  assert.deepEqual(extractRules('# P\n\n## Stack\n1. node\n'), []);
});

test('extractRules treats slug subheadings as rules with no number', () => {
  const rules = extractRules(`${RULES_HEADING}\n\n### checkpoint-every-sprint\nPlan, TDD, verify.\n`);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].number, null);
  assert.equal(rules[0].slug, 'checkpoint-every-sprint');
});

test('countWords ignores fenced code, which is not prose a reader has to hold', () => {
  const withFence = 'one two three\n```\nlots of code words here that should not count\n```\nfour';
  assert.equal(countWords(withFence), 4);
});

// --- retired rule in a numbered slot ---------------------------------------

test('checkRetiredRules fires on a tombstone rule holding a numbered slot', () => {
  const content = [
    RULES_HEADING,
    '1. **Checkpoint:** plan, TDD, verify, hand off.',
    '2. **(retired)** — superseded; kept so citations of rules 3 and 4 still resolve.',
    '3. **Tests:** the fast tier runs on every commit.',
  ].join('\n');
  const findings = checkRetiredRules(extractRules(content));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'retired-rule');
  assert.equal(findings[0].line, 3);
  assert.match(findings[0].message, /rule 2/i);
  assert.match(findings[0].message, /slug/i, 'the fix (stable slugs) must be named');
});

test('checkRetiredRules does not fire on a live rule that merely mentions removal', () => {
  assert.deepEqual(checkRetiredRules(extractRules(LIVE_RULES)), []);
});

test('checkRetiredRules ignores an unnumbered (slug) rule — nothing forces it to be kept', () => {
  const content = `${RULES_HEADING}\n\n### adversarial-review\nRetired: superseded by W5.\n`;
  assert.deepEqual(checkRetiredRules(extractRules(content)), []);
});

// --- overlong rule ----------------------------------------------------------

test('checkRuleLength fires on a rule past the word limit and reports the count', () => {
  const long = Array.from({ length: MAX_RULE_WORDS + 40 }, (_, i) => `word${i}`).join(' ');
  const findings = checkRuleLength(extractRules(`${RULES_HEADING}\n1. **Big:** ${long}\n`));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'long-rule');
  assert.match(findings[0].message, new RegExp(`${MAX_RULE_WORDS + 41}`), 'the actual count is reported');
});

test('checkRuleLength does not fire on a normal-length rule', () => {
  assert.deepEqual(checkRuleLength(extractRules(LIVE_RULES)), []);
});

test('checkRuleLength does not count fenced code toward a rule\'s length', () => {
  const code = Array.from({ length: MAX_RULE_WORDS + 40 }, (_, i) => `arg${i}`).join(' ');
  const content = `${RULES_HEADING}\n1. **Run:** use the command below.\n   \`\`\`bash\n   ${code}\n   \`\`\`\n`;
  assert.deepEqual(checkRuleLength(extractRules(content)), []);
});

// --- contradictions ---------------------------------------------------------

test('checkContradictions fires when one named fact carries two different numbers', () => {
  const content = [
    '# P',
    '- asdlc unit tests: **802**',
    '',
    'Later, in prose someone wrote:',
    '- asdlc unit tests: 722 passing',
  ].join('\n');
  const findings = checkContradictions(content);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'contradiction');
  assert.equal(findings[0].line, 5, 'reported at the second, contradicting assertion');
  assert.match(findings[0].message, /line 2/, 'the message names the other assertion');
  assert.match(findings[0].message, /802/);
  assert.match(findings[0].message, /722/);
});

test('checkContradictions stays quiet when the same key repeats with the same number', () => {
  assert.deepEqual(checkContradictions('- Dev port: 5173\n- Dev port: 5173 (vite)\n'), []);
});

test('checkContradictions catches the same subject called both authoritative and advisory', () => {
  const content = [
    '## Tests',
    '- The `deep` tier is the authoritative gate on every PR.',
    '',
    '## Run / verify',
    '- `deep` is advisory and runs after merge, so it never blocks anyone.',
  ].join('\n');
  const findings = checkContradictions(content);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'contradiction');
  assert.match(findings[0].message, /`deep`/);
  assert.match(findings[0].message, /line 2/);
});

test('checkContradictions does not fire on one line that names both sides of a polarity', () => {
  assert.deepEqual(
    checkContradictions('- The `deep` tier is advisory, not an authoritative gate.\n'),
    [],
  );
});

test('checkContradictions does not fire on a URL that happens to carry digits', () => {
  const content = '- Docs: https://example.com/v1/guide\n- Docs: https://example.com/v2/guide\n';
  assert.deepEqual(checkContradictions(content), []);
});

test('checkContradictions is quiet on a clean file', () => {
  assert.deepEqual(checkContradictions(`# P\n\n${LIVE_RULES}\n`), []);
});

// --- lintClaudeMd (the aggregate) ------------------------------------------

function freshFactsDoc(dir, body, runner) {
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body);
  writeFactsBlock(dir, { runner });
  return fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
}

test('lintClaudeMd passes a clean file with a current facts block', () => {
  const { dir, file, cleanup } = makeTempProject({ manifest: MANIFEST, claudeMd: '# P\n' });
  try {
    const runner = stubRunner('tests 802');
    freshFactsDoc(dir, `# P\n\n${LIVE_RULES}\n`, runner);
    assert.deepEqual(lintClaudeMd(file, { runner }), []);
  } finally {
    cleanup();
  }
});

test('lintClaudeMd reports an absent facts block', () => {
  const { file, cleanup } = makeTempProject({ manifest: MANIFEST, claudeMd: `# P\n\n${LIVE_RULES}\n` });
  try {
    const findings = lintClaudeMd(file, { runner: stubRunner('tests 802') });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'facts-block');
    assert.match(findings[0].message, /no .*facts.*block|absent|missing/i);
  } finally {
    cleanup();
  }
});

test('lintClaudeMd reports a hand-edited (stale) facts block', () => {
  const claudeMd = `# P\n\n${FACTS_MARKERS.start}\n- asdlc unit tests: **722**\n${FACTS_MARKERS.end}\n\n${LIVE_RULES}\n`;
  const { file, cleanup } = makeTempProject({ manifest: MANIFEST, claudeMd });
  try {
    const findings = lintClaudeMd(file, { runner: stubRunner('tests 802') });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'facts-block');
    assert.match(findings[0].message, /stale/i);
  } finally {
    cleanup();
  }
});

test('lintClaudeMd reports an unverifiable facts block instead of checking a different file', () => {
  const { file, cleanup } = makeTempProject({
    manifest: MANIFEST,
    claudeMd: `# P\n\n${LIVE_RULES}\n`,
    fileName: 'NOTES.md',
  });
  try {
    const findings = lintClaudeMd(file, { runner: stubRunner('tests 802') });
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /CLAUDE\.md/);
  } finally {
    cleanup();
  }
});

test('lintClaudeMd reports every finding, not just the first', () => {
  const long = Array.from({ length: MAX_RULE_WORDS + 40 }, (_, i) => `word${i}`).join(' ');
  const body = [
    '# P',
    '',
    '- asdlc unit tests: **802**',
    '- asdlc unit tests: 722 passing',
    '',
    RULES_HEADING,
    '1. **(retired)** — no longer applies; kept so rule 2 keeps its number.',
    `2. **Big:** ${long}`,
  ].join('\n');
  const { dir, file, cleanup } = makeTempProject({ manifest: MANIFEST, claudeMd: '# P\n' });
  try {
    fs.writeFileSync(file, body);
    const kinds = lintClaudeMd(file, { runner: stubRunner('tests 802') }).map((f) => f.rule);
    assert.deepEqual(new Set(kinds), new Set(['facts-block', 'retired-rule', 'long-rule', 'contradiction']));
  } finally {
    cleanup();
  }
});

test('lintClaudeMd sorts findings by line so the output reads top-down', () => {
  const long = Array.from({ length: MAX_RULE_WORDS + 40 }, (_, i) => `word${i}`).join(' ');
  const body = `# P\n\n${RULES_HEADING}\n1. **Big:** ${long}\n2. **(retired)** — superseded; kept for numbering.\n`;
  const { file, cleanup } = makeTempProject({ manifest: MANIFEST, claudeMd: body });
  try {
    const lines = lintClaudeMd(file, { runner: stubRunner('tests 802') }).map((f) => f.line);
    assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
  } finally {
    cleanup();
  }
});

test('formatFinding renders one finding as one line naming the file, line and rule', () => {
  const line = formatFinding({ rule: 'long-rule', line: 12, message: 'too long' }, 'CLAUDE.md');
  assert.equal(line.split('\n').length, 1);
  assert.match(line, /^CLAUDE\.md:12/);
  assert.match(line, /long-rule/);
  assert.match(line, /too long/);
});

// --- CLI --------------------------------------------------------------------
// These run the real script against a real command, covering the argv/exit-code
// plumbing rather than asserting about it.

const REAL_MANIFEST = { facts: [{ label: 'answer', command: ['node', '-e', 'console.log("42")'] }] };

function runCli(dir, args = []) {
  return spawnSync(process.execPath, [LINT_SCRIPT, ...args], { cwd: dir, encoding: 'utf8' });
}

test('CLI exits 0 on a clean CLAUDE.md', () => {
  const { dir, cleanup } = makeTempProject({
    manifest: REAL_MANIFEST,
    claudeMd: `# P\n\n${FACTS_MARKERS.start}\n${FACTS_MARKERS.end}\n\n${LIVE_RULES}\n`,
  });
  try {
    assert.equal(spawnSync(process.execPath, [path.join(__dirname, '..', 'facts.js')], { cwd: dir, encoding: 'utf8' }).status, 0);
    const result = runCli(dir);
    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  } finally {
    cleanup();
  }
});

test('CLI exits non-zero and prints one line per finding', () => {
  const long = Array.from({ length: MAX_RULE_WORDS + 40 }, (_, i) => `word${i}`).join(' ');
  const claudeMd = `# P\n\n${RULES_HEADING}\n1. **Big:** ${long}\n2. **(retired)** — superseded; kept for numbering.\n`;
  const { dir, cleanup } = makeTempProject({ manifest: REAL_MANIFEST, claudeMd });
  try {
    const result = runCli(dir);
    assert.notEqual(result.status, 0);
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, /long-rule/);
    assert.match(output, /retired-rule/);
    assert.match(output, /facts-block/);
    assert.doesNotMatch(output, /at Object\.<anonymous>/, 'no stack traces');
  } finally {
    cleanup();
  }
});

test('CLI accepts an explicit path argument', () => {
  const { dir, cleanup } = makeTempProject({ manifest: REAL_MANIFEST, claudeMd: '# P\n' });
  try {
    const result = runCli(dir, ['CLAUDE.md']);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /facts-block/);
  } finally {
    cleanup();
  }
});

test('CLI reports a missing file as a message, not a stack trace', () => {
  const { dir, cleanup } = makeTempProject({ manifest: REAL_MANIFEST });
  try {
    const result = runCli(dir);
    assert.equal(result.status, 1);
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, /not found/i);
    assert.doesNotMatch(output, /at Object\.<anonymous>/, 'no stack traces');
  } finally {
    cleanup();
  }
});

test('CLI rejects a second path argument instead of silently ignoring it', () => {
  const { dir, cleanup } = makeTempProject({ manifest: REAL_MANIFEST, claudeMd: '# P\n' });
  try {
    const result = runCli(dir, ['CLAUDE.md', 'OTHER.md']);
    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /OTHER\.md/);
  } finally {
    cleanup();
  }
});
