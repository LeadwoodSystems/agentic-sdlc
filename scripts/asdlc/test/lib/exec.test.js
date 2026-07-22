const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../lib/exec');

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
