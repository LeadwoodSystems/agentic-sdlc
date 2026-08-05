const test = require('node:test');
const assert = require('node:assert/strict');
const { run, runCapture } = require('../../lib/exec');

test('run() returns trimmed stdout on success', () => {
  const out = run('node', ['-e', 'console.log("  hello  ")']);
  assert.equal(out, 'hello');
});

test('run() throws with stderr message on non-zero exit', () => {
  assert.throws(
    () => run('node', ['-e', 'console.error("boom"); process.exit(1)']),
    /failed: boom/
  );
});

// runCapture() is run()'s opposite number, added for mutate.js. The two
// contracts sit side by side deliberately: run() throws on a non-zero exit
// because for git plumbing that is an error, while for a mutation run a
// non-zero exit IS the answer — it is the RED the whole practice looks for.

test('runCapture() returns a non-zero status instead of throwing', () => {
  const r = runCapture(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(r.status, 3);
});

test('runCapture() returns status 0 on success', () => {
  assert.equal(runCapture(process.execPath, ['-e', '']).status, 0);
});

test('runCapture() captures stdout and stderr untrimmed', () => {
  // Untrimmed on purpose: the classifier substring-matches expectRed against
  // this text, and a trim is exactly the sort of quiet tidy-up that would turn
  // a RED-AS-PREDICTED into a RED-WRONG-REASON.
  const r = runCapture(process.execPath, ['-e', 'process.stdout.write("  out  "); process.stderr.write("  err  ")']);
  assert.equal(r.stdout, '  out  ');
  assert.equal(r.stderr, '  err  ');
});

test('runCapture() still throws when the binary does not exist', () => {
  // A missing binary is tooling failure, not evidence. Reporting it as a RED
  // would manufacture a finding out of a broken instrument.
  //
  // Asserting on ENOENT rather than on "it threw": while runCapture was
  // undefined this test passed vacuously, because calling undefined throws a
  // TypeError and a bare assert.throws() accepts anything. A test that cannot
  // tell "spawn failed" from "the function does not exist" is hollow.
  assert.throws(
    () => runCapture('definitely-not-a-real-binary-xyz', []),
    (err) => err.code === 'ENOENT',
  );
});

test('runCapture() merges env over the parent environment', () => {
  const r = runCapture(
    process.execPath,
    ['-e', 'process.stdout.write((process.env.MUT_X || "") + ":" + (process.env.PATH ? "has-path" : "no-path"))'],
    { env: { MUT_X: 'set' } },
  );
  assert.equal(r.stdout, 'set:has-path');
});

test('runCapture() runs in the requested cwd', () => {
  const r = runCapture(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], {
    cwd: __dirname,
  });
  assert.equal(r.stdout, __dirname);
});
