const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// scripts/asdlc/test -> scripts/asdlc -> scripts -> repo root
const BOOTSTRAP = path.join(__dirname, '..', '..', '..', 'commands', 'bootstrap-asdlc.md');

// Extract one numbered step from the scaffold list. Scoped deliberately: steps 7
// and 8 name facts.js and asdlc-lint.js for legitimate reasons, so a
// document-wide scan for filenames is a test that can never pass.
function stepBlock(markdown, mentioning) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\d+\.\s/.test(l) && l.includes(mentioning));
  assert.notEqual(start, -1, `no numbered step mentioning ${mentioning}`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\d+\.\s/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

test('bootstrap step 6 names no individual script file', () => {
  const block = stepBlock(fs.readFileSync(BOOTSTRAP, 'utf8'), 'scripts/asdlc');
  // A filename needs a stem: this must match `mutate.js` and must NOT match the
  // bare extension in "copy every `.js` file", whose preceding char is a backtick.
  const named = block.match(/[\w-]+\.js\b/g) || [];
  assert.deepEqual(
    named,
    [],
    `step 6 enumerates ${named.join(', ')}. An enumeration goes stale — v0.2-s3 shipped `
    + `four files it never added here, which is why gaw has no mutate.js. Derive the set `
    + `instead; see docs/superpowers/specs/2026-08-05-plugin-consumption-and-riders-design.md`,
  );
});

test('bootstrap step 6 tells the agent to copy every script, lib included and test excluded', () => {
  const block = stepBlock(fs.readFileSync(BOOTSTRAP, 'utf8'), 'scripts/asdlc');
  assert.match(block, /\bevery\b/i, 'step 6 must state that EVERY script is copied');
  assert.match(block, /lib\//, 'step 6 must say lib/ is included');
  assert.match(block, /test\//, 'step 6 must say test/ is excluded');
});
