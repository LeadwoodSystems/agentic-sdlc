const test = require('node:test');
const assert = require('node:assert/strict');
const { parseManifest } = require('../../lib/manifest');

// assert.throws() returns undefined, so it cannot be used to inspect a message.
// Several tests here assert that ALL problems appear in ONE message, which is
// the behaviour that keeps a broken manifest from costing one run per typo.
function captureError(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new assert.AssertionError({ message: 'expected the call to throw, but it did not' });
}

const VALID = JSON.stringify({
  testCommand: ['node', '--test'],
  mutations: [{
    id: 'A',
    why: 'recap must run after the send is parked',
    file: 'src/emit.js',
    find: 'send(payload)',
    replace: 'noop(payload)',
    testArgs: ['test/emit.test.js'],
    label: 'full_sequence',
    expectRed: 'recap must run after',
  }],
});

test('a valid manifest round-trips its fields', () => {
  const m = parseManifest(VALID);
  assert.deepEqual(m.testCommand, ['node', '--test']);
  assert.equal(m.mutations[0].id, 'A');
  assert.deepEqual(m.mutations[0].testArgs, ['test/emit.test.js']);
  assert.equal(m.mutations[0].label, 'full_sequence');
});

test('malformed JSON names itself as such', () => {
  assert.throws(() => parseManifest('{not json'), /manifest is not valid JSON/i);
});

test('a string testCommand is rejected, naming the array form', () => {
  // Guards the shape the design spec declined: a string needs shell:true, which
  // means cmd.exe on Windows and /bin/sh elsewhere — one manifest, two
  // behaviours. A mis-split command then surfaces as a mysterious test failure
  // that the verdict vocabulary classifies as RED-WRONG-REASON, i.e. as a
  // FINDING, rather than as tooling failure.
  const text = JSON.stringify({ testCommand: 'node --test', mutations: [] });
  assert.throws(() => parseManifest(text), /testCommand must be an array of strings/);
});

test('every required per-mutation field is named when missing', () => {
  const text = JSON.stringify({ testCommand: ['node'], mutations: [{ id: 'A' }] });
  const err = captureError(() => parseManifest(text));
  for (const field of ['file', 'find', 'replace', 'expectRed']) {
    assert.match(err.message, new RegExp(`mutation A.*${field}`));
  }
});

test('all problems are reported in one throw, not one per run', () => {
  const text = JSON.stringify({ mutations: [{ id: 'A' }, { id: 'B' }] });
  const err = captureError(() => parseManifest(text));
  assert.ok(err.message.split('\n').length >= 5, err.message);
});

test('a missing expectRed is rejected even when everything else is present', () => {
  // expectRed is what turns "it went red" into "it went red for the reason
  // predicted" — the single most valuable thing the script adds. Optional here
  // would make it optional in practice.
  const text = JSON.stringify({
    testCommand: ['node'],
    mutations: [{ id: 'A', file: 'f', find: 'a', replace: 'b' }],
  });
  assert.throws(() => parseManifest(text), /mutation A.*expectRed/);
});

test('an empty find is rejected', () => {
  // '' matches at index 0 of every file; applyMutation would call that
  // ambiguous, but the honest error is that the anchor was never authored.
  const text = JSON.stringify({
    testCommand: ['node'],
    mutations: [{ id: 'A', file: 'f', find: '', replace: 'b', expectRed: 'x' }],
  });
  assert.throws(() => parseManifest(text), /mutation A.*find.*non-empty/);
});

test('an empty replace is allowed — deleting a line is a real mutation', () => {
  const text = JSON.stringify({
    testCommand: ['node'],
    mutations: [{ id: 'A', file: 'f', find: 'a', replace: '', expectRed: 'x' }],
  });
  assert.equal(parseManifest(text).mutations[0].replace, '');
});

test('duplicate ids are rejected', () => {
  const one = { id: 'A', file: 'f', find: 'a', replace: 'b', expectRed: 'x' };
  const text = JSON.stringify({ testCommand: ['node'], mutations: [one, { ...one }] });
  assert.throws(
    () => parseManifest(text),
    /duplicate mutation id "A"/,
    'a duplicate mutation id was accepted, so one of two mutations would be silently dropped',
  );
});

test('an empty mutations array is rejected', () => {
  assert.throws(
    () => parseManifest(JSON.stringify({ testCommand: ['node'], mutations: [] })),
    /at least one mutation/,
  );
});

test('a mutation with no id is identified by its index', () => {
  // Without this the message would read `mutation undefined: ...` for every
  // anonymous entry, which is unactionable in a manifest of twelve.
  const text = JSON.stringify({ testCommand: ['node'], mutations: [{ file: 'f' }] });
  const err = captureError(() => parseManifest(text));
  assert.match(err.message, /mutation #0/);
});

test('a non-string element in testCommand is rejected', () => {
  const text = JSON.stringify({
    testCommand: ['node', 2],
    mutations: [{ id: 'A', file: 'f', find: 'a', replace: 'b', expectRed: 'x' }],
  });
  assert.throws(() => parseManifest(text), /testCommand must be an array of strings/);
});

test('testArgs, when present, must be an array of strings', () => {
  const text = JSON.stringify({
    testCommand: ['node'],
    mutations: [{ id: 'A', file: 'f', find: 'a', replace: 'b', expectRed: 'x', testArgs: '-k foo' }],
  });
  assert.throws(() => parseManifest(text), /mutation A.*testArgs must be an array of strings/);
});

test('a top-level JSON array is rejected as a manifest', () => {
  assert.throws(() => parseManifest('[]'), /manifest must be a JSON object/);
});
