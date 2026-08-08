const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// scripts/asdlc/test -> scripts/asdlc -> scripts -> repo root
const README = path.join(__dirname, '..', '..', '..', 'README.md');

// #18 requires the before/after diagram to stay legible in a monospace terminal
// at 80 columns. Scoped to ```text fences deliberately: the layout tree under a
// bare ``` fence already runs to 104 columns (measured on 2857041) and is
// protected by #17's Non-Goal against content loss, so a document-wide rule is
// one that could never pass.
const MAX_COLUMNS = 80;

// Every line inside a ```text fence, as { line, text }. Fence state is tracked
// for EVERY fence regardless of language: track only text-fences and a bare
// block's CLOSING ``` reads as OPENING a new unlabelled one, silently pulling
// prose into the width check.
function textBlockLines(markdown) {
  // Splitting on /\r?\n/ drops the CR, so .text.length never counts it. The repo
  // is CRLF on disk (core.autocrlf) and a counted CR would make every line read
  // one column wider than it prints.
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let openLang = null;
  for (let i = 0; i < lines.length; i += 1) {
    const fence = lines[i].match(/^\s*```(\S*)\s*$/);
    if (fence) {
      openLang = openLang === null ? (fence[1] || 'plain') : null;
      continue;
    }
    if (openLang === 'text') out.push({ line: i + 1, text: lines[i] });
  }
  return out;
}

test('the #18 before/after diagram lives in a text fenced block', () => {
  const found = textBlockLines(fs.readFileSync(README, 'utf8'));
  // Without this, the width test below passes vacuously over an empty set - an
  // inert gate that reports success, which is the failure command-prose.test.js
  // guards against the same way. Before v0.3-s3 README.md had no ```text fence
  // at all, so a width-only gate would have been green from the day it landed.
  assert.ok(
    found.length > 0,
    'README.md holds no text-fenced block, so the width gate inspects nothing; '
    + 'the #18 before/after diagram must live in one',
  );
});

test('every line inside a text fenced block fits 80 columns', () => {
  const over = textBlockLines(fs.readFileSync(README, 'utf8'))
    .filter((entry) => entry.text.length > MAX_COLUMNS)
    .map((entry) => `README.md:${entry.line} is ${entry.text.length} columns`);
  // .length is UTF-16 code units, which equals display columns only for
  // single-width BMP characters. True for the arrows and em-dash the diagram
  // uses; it would not be for CJK or emoji. Recorded rather than fixed - a
  // width-aware implementation is a dependency this repo does not take.
  assert.deepEqual(
    over,
    [],
    `these lines overrun the ${MAX_COLUMNS}-column budget #18 sets: ${over.join('; ')}`,
  );
});
