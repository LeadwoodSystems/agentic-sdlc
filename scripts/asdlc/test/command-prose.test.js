const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HYGIENE_CHECKS } = require('../gh-hygiene');

// scripts/asdlc/test -> scripts/asdlc -> scripts -> repo root
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const COMMANDS_DIR = path.join(REPO_ROOT, 'commands');

// Requires the .js suffix, so bootstrap-asdlc.md's bare
// `${CLAUDE_PLUGIN_ROOT}/scripts/asdlc/` directory reference is correctly not a match.
const SCRIPT_PATH = /scripts\/asdlc\/[A-Za-z0-9_./-]*\.js/g;

function commandFiles() {
  return fs.readdirSync(COMMANDS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(COMMANDS_DIR, name));
}

test('every scripts/asdlc path named in command prose exists on disk', () => {
  const missing = [];
  let found = 0;
  for (const file of commandFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const named of text.match(SCRIPT_PATH) || []) {
      found += 1;
      if (!fs.existsSync(path.join(REPO_ROOT, named))) {
        missing.push(`${path.basename(file)} -> ${named}`);
      }
    }
  }
  // Without this, a broken regex makes the gate pass by finding nothing at all -
  // an inert gate that reports success is worse than no gate.
  assert.ok(found > 0, 'command prose gate matched no script paths at all; the pattern is broken');
  assert.deepEqual(missing, [], `command prose names scripts that do not exist: ${missing.join('; ')}`);
});

const HYGIENE_COMMAND = path.join(COMMANDS_DIR, 'asdlc-hygiene.md');

// Deliberately scoped to the findings sentence rather than the whole file: the
// check set is also written in the frontmatter `description:`, and a label
// deleted here but left there would pass a whole-file match while the agent
// under-reports - the exact v0.2-s8 bug surviving its own gate.
const FINDINGS_SENTENCE = /Present the \*{0,2}(\w+)\*{0,2} findings \(([^)]*)\)/;

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function findingsSentence() {
  const text = fs.readFileSync(HYGIENE_COMMAND, 'utf8');
  const match = text.match(FINDINGS_SENTENCE);
  assert.ok(match, 'asdlc-hygiene.md no longer contains a "Present the <N> findings (...)" sentence');
  return { numeral: match[1], list: match[2] };
}

test('asdlc-hygiene.md names every check gh-hygiene.js actually runs', () => {
  const { list } = findingsSentence();
  const haystack = list.toLowerCase().replace(/\s+/g, ' ');
  const missing = HYGIENE_CHECKS
    .filter((check) => !haystack.includes(check.label.toLowerCase()))
    .map((check) => check.label);
  assert.deepEqual(missing, [],
    `the findings list in asdlc-hygiene.md omits checks the script runs: ${missing.join(', ')}`);
});

test('asdlc-hygiene.md states the number of findings gh-hygiene.js produces', () => {
  const { numeral } = findingsSentence();
  const expected = NUMBER_WORDS[HYGIENE_CHECKS.length];
  assert.ok(expected,
    `HYGIENE_CHECKS.length is ${HYGIENE_CHECKS.length}, past the end of NUMBER_WORDS; extend the list`);
  assert.equal(numeral.toLowerCase(), expected,
    `asdlc-hygiene.md promises "${numeral}" findings but gh-hygiene.js runs ${HYGIENE_CHECKS.length}`);
});
