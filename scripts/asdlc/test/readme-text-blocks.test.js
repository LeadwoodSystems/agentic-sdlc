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

// Counts ```text fences opened, independent of what's inside them. The
// existence + sentinel checks below only prove *a* ```text block holds *the*
// diagram's opening line; without this, a second, unrelated ```text fence
// elsewhere in the file would still let both checks pass. The design (and the
// plan) rely on the tag staying unique to the #18 diagram — this makes that a
// gate instead of an invariant someone checked by hand once.
function textFenceCount(markdown) {
  const lines = markdown.split(/\r?\n/);
  let count = 0;
  let openLang = null;
  for (let i = 0; i < lines.length; i += 1) {
    const fence = lines[i].match(/^\s*```(\S*)\s*$/);
    if (fence) {
      if (openLang === null) {
        openLang = fence[1] || 'plain';
        if (openLang === 'text') count += 1;
      } else {
        openLang = null;
      }
      continue;
    }
  }
  return count;
}

test('the #18 before/after diagram lives in a text fenced block', () => {
  const markdown = fs.readFileSync(README, 'utf8');
  const found = textBlockLines(markdown);
  // Without this, the width test below passes vacuously over an empty set - an
  // inert gate that reports success, which is the failure command-prose.test.js
  // guards against the same way. Before v0.3-s3 README.md had no ```text fence
  // at all, so a width-only gate would have been green from the day it landed.
  // This assertion must stay first: FENCEPLAIN's expectRed is this exact
  // message, and it must fire before either check below has a chance to run.
  assert.ok(
    found.length > 0,
    'README.md holds no text-fenced block, so the width gate inspects nothing; '
    + 'the #18 before/after diagram must live in one',
  );
  // Existence alone proves *some* ```text block is present, not that it's the
  // #18 diagram - a future edit could delete the diagram and add an unrelated
  // ```text block elsewhere and still pass. The tag is reserved for the
  // diagram by design (see textFenceCount's comment); pin that down here
  // rather than relying on it being checked by hand.
  assert.equal(
    textFenceCount(markdown),
    1,
    'the ```text tag is reserved for the #18 before/after diagram; finding more '
    + 'than one means something other than the diagram is using it',
  );
  assert.ok(
    found.some((entry) => entry.text.includes('WITHOUT A CONTROL PLANE')),
    'the sole ```text fence does not contain the #18 diagram\'s own text '
    + '("WITHOUT A CONTROL PLANE") - existence and uniqueness alone don\'t prove '
    + 'this is the diagram',
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
