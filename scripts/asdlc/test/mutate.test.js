const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { run } = require('../lib/exec');
const {
  runMutations,
  assertCleanTree,
  restoreInFlight,
  verifyRestored,
  parseArgs,
  __setInFlight,
} = require('../mutate');

// A fixture whose source is CRLF and contains an em-dash, mirroring the file
// that was corrupted in gaw v0.13-s8. Both files are CRLF so that core.autocrlf
// cannot make the working tree look dirty for reasons unrelated to a mutation.
const SRC = [
  'function greet(name) {',
  '  // Politeness — required.',
  '  return "hi " + name;',
  '}',
  'module.exports = { greet };',
  '',
].join('\r\n');

// A plain assertion script rather than a `node --test` file, and the reason is
// worth recording: this test file itself runs under `node --test`, which sets
// NODE_TEST_CONTEXT in its children. A grandchild `node --test` inherits it,
// switches to reporting over IPC, and EXITS 0 WITH EMPTY OUTPUT — so every
// mutation would have been classified GREEN, i.e. "the test is hollow", by an
// artifact of the harness. That is precisely the false finding this tool exists
// to prevent, so the fixture avoids the nesting rather than working around it.
// A plain script gives the same thing the loop actually depends on: a real
// process, a real exit code, and real output to match expectRed against.
const CHECK = [
  'const assert = require("node:assert/strict");',
  'const { greet } = require("./src.js");',
  'assert.equal(greet("ada"), "hi ada");',
  '',
].join('\r\n');

async function fixtureWithSource() {
  const repo = await makeFixtureRepo();
  fs.writeFileSync(path.join(repo.dir, 'src.js'), SRC);
  fs.writeFileSync(path.join(repo.dir, 'check.js'), CHECK);
  run('git', ['add', '.'], { cwd: repo.dir });
  run('git', ['commit', '-m', 'add source'], { cwd: repo.dir });
  return repo;
}

// The flag is here so the concatenation of testCommand's tail with the
// mutation's testArgs is exercised, not just appending to a bare executable.
const manifest = (mutations) => ({ testCommand: [process.execPath, '--no-warnings'], mutations });

const BREAKS_IT = {
  id: 'A',
  file: 'src.js',
  find: '  return "hi " + name;',
  replace: '  return "bye " + name;',
  testArgs: ['check.js'],
  expectRed: 'hi ada',
};

test('a mutation that breaks the asserted behaviour is RED-AS-PREDICTED', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const results = runMutations(repo.dir, manifest([BREAKS_IT]));
  assert.equal(results[0].verdict, 'RED-AS-PREDICTED');
});

test('a RED whose output lacks expectRed is RED-WRONG-REASON', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const results = runMutations(repo.dir, manifest([{
    ...BREAKS_IT,
    replace: '  throw new Error("collateral");',
    expectRed: 'this string never appears anywhere',
  }]));
  assert.equal(results[0].verdict, 'RED-WRONG-REASON');
});

test('a mutation the test cannot see is GREEN', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const results = runMutations(repo.dir, manifest([{
    ...BREAKS_IT,
    find: '  // Politeness — required.',
    replace: '  // Politeness — optional.',
  }]));
  assert.equal(results[0].verdict, 'GREEN');
});

test('the file is byte-identical and the tree clean after a run', async (t) => {
  // The revert check, measured rather than asserted: one un-reverted mutation
  // poisons every subsequent result.
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  runMutations(repo.dir, manifest([BREAKS_IT]));
  assert.equal(fs.readFileSync(path.join(repo.dir, 'src.js'), 'utf8'), SRC);
  assert.equal(run('git', ['status', '--porcelain'], { cwd: repo.dir }), '');
});

test('a bad anchor skips its own run but not the remaining mutations', async (t) => {
  // The design spec's reading of requirement 1.4.3: aborting on the first bad
  // anchor makes a twelve-mutation manifest cost twelve cycles to debug, and
  // anchors authored blind in one pass tend to fail in batches.
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const results = runMutations(repo.dir, manifest([
    { ...BREAKS_IT, id: 'A', find: 'not in the file' },
    { ...BREAKS_IT, id: 'B' },
  ]));
  assert.equal(results[0].verdict, 'ANCHOR-MISS');
  assert.equal(results[1].verdict, 'RED-AS-PREDICTED');
});

test('an ANCHOR-MISS reports no duration from a test that never ran', async (t) => {
  // The failure this whole tool exists to prevent: a skipped mutation that
  // reads as a clean run.
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const results = runMutations(repo.dir, manifest([{ ...BREAKS_IT, find: 'not in the file' }]));
  assert.equal(results[0].durationMs, 0);
});

test('an anchor matching twice is AMBIGUOUS-ANCHOR and runs no test', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  let calls = 0;
  const results = runMutations(repo.dir, manifest([{
    ...BREAKS_IT,
    find: 'name',
    replace: 'nombre',
  }]), { runner: () => { calls += 1; return { status: 0, stdout: '', stderr: '' }; } });
  assert.equal(results[0].verdict, 'AMBIGUOUS-ANCHOR');
  assert.equal(calls, 0);
});

test('a mutation identical to the source is NO-OP and runs no test', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  let calls = 0;
  const results = runMutations(repo.dir, manifest([{
    ...BREAKS_IT,
    replace: '  return "hi " + name;',
  }]), { runner: () => { calls += 1; return { status: 0, stdout: '', stderr: '' }; } });
  assert.equal(results[0].verdict, 'NO-OP');
  assert.equal(calls, 0);
});

test('the runner receives testCommand followed by the mutation testArgs', async (t) => {
  // Requirement 1.4.7: the script never chooses the test command. It appends
  // and knows nothing about any test framework. Both invocations — the baseline
  // and the mutated run — must use the same argv, or "absent from the baseline"
  // is a claim about a command that was never the one under test.
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const seen = [];
  runMutations(repo.dir, manifest([BREAKS_IT]), {
    runner: (cmd, args) => { seen.push({ cmd, args }); return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(seen.length, 2, 'expected a baseline run and a mutated run');
  for (const call of seen) {
    assert.equal(call.cmd, process.execPath);
    assert.deepEqual(call.args, ['--no-warnings', 'check.js']);
  }
});

test('--only runs just the named mutations', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const results = runMutations(repo.dir, manifest([
    { ...BREAKS_IT, id: 'A' },
    { ...BREAKS_IT, id: 'B', find: 'function greet(name) {', replace: 'function greet(name) { // x' },
  ]), { only: ['B'] });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'B');
});

test('--only naming an unknown id fails loudly', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  assert.throws(
    () => runMutations(repo.dir, manifest([BREAKS_IT]), { only: ['NOPE'] }),
    /unknown mutation id "NOPE"/,
  );
});

test('dry-run verifies anchors without invoking the runner or writing', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  let calls = 0;
  const results = runMutations(repo.dir, manifest([BREAKS_IT]), {
    dryRun: true,
    runner: () => { calls += 1; return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(calls, 0);
  assert.equal(results[0].verdict, 'ANCHOR-OK');
  assert.equal(fs.readFileSync(path.join(repo.dir, 'src.js'), 'utf8'), SRC);
});

test('dry-run still reports a bad anchor', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const results = runMutations(repo.dir, manifest([{ ...BREAKS_IT, find: 'not in the file' }]), {
    dryRun: true,
  });
  assert.equal(results[0].verdict, 'ANCHOR-MISS');
});

test('the file is restored when the runner throws mid-mutation', async (t) => {
  // Crash safety, tested deterministically. Killing a real child mid-run is a
  // flaky signal test; the risk actually being guarded is "an exception left a
  // mutation on disk", not "SIGINT specifically".
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  assert.throws(
    () => runMutations(repo.dir, manifest([BREAKS_IT]), {
      runner: () => { throw new Error('runner exploded'); },
    }),
    /runner exploded/,
  );
  assert.equal(fs.readFileSync(path.join(repo.dir, 'src.js'), 'utf8'), SRC);
});

test('restoreInFlight puts back a stranded mutation', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const target = path.join(repo.dir, 'src.js');
  fs.writeFileSync(target, 'stranded');
  __setInFlight({ absPath: target, before: SRC });
  restoreInFlight();
  assert.equal(fs.readFileSync(target, 'utf8'), SRC);
});

test('restoreInFlight is a no-op when nothing is in flight', () => {
  __setInFlight(null);
  assert.doesNotThrow(() => restoreInFlight());
});

test('verifyRestored throws DIRTY-REVERT when the bytes on disk differ', async (t) => {
  // Guards the historical bug directly: the gaw round-trip wrote the file back
  // through a codec that mangled it, so "we wrote the original" and "the
  // original is on disk" were not the same statement.
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const target = path.join(repo.dir, 'src.js');
  fs.writeFileSync(target, 'not what we wrote');
  assert.throws(() => verifyRestored(target, SRC), /DIRTY-REVERT/);
});

test('verifyRestored passes when the bytes match', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  assert.doesNotThrow(() => verifyRestored(path.join(repo.dir, 'src.js'), SRC));
});

test('a test command that rewrites the source under test aborts the run', async (t) => {
  // Contamination, not a revert failure: if the runner edits the file while a
  // mutation is applied, every later mutation is measured against a source
  // nobody authored. Aborting is the only safe answer, and the tree is still
  // left clean.
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const target = path.join(repo.dir, 'src.js');
  let call = 0;
  assert.throws(() => runMutations(repo.dir, manifest([
    { ...BREAKS_IT, id: 'A' },
    { ...BREAKS_IT, id: 'B', find: 'function greet(name) {', replace: 'function greet(name) { // x' },
  ]), {
    runner: () => {
      call += 1;
      // The baseline must come back green: a red one stops the run at
      // BASELINE-RED and no mutation ever reaches disk, while the
      // contamination this test is about can only happen while one is applied.
      if (call === 1) return { status: 0, stdout: '', stderr: '' };
      fs.writeFileSync(target, 'clobbered by the test command');
      return { status: 1, stdout: 'hi ada', stderr: '' };
    },
  }), /DIRTY-REVERT/);
  assert.equal(fs.readFileSync(target, 'utf8'), SRC);
});

test('a dirty working tree is refused, and the refusal shows what caused it', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  fs.writeFileSync(path.join(repo.dir, 'src.js'), `${SRC}// local edit\r\n`);
  assert.throws(() => assertCleanTree(repo.dir), /src\.js/);
});

test('a clean working tree passes the guard', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  assert.doesNotThrow(() => assertCleanTree(repo.dir));
});

test('parseArgs reads the manifest path and the flags', () => {
  const args = parseArgs(['m.json', '--only', 'A,B', '--dry-run', '--json', '--allow-dirty']);
  assert.equal(args.manifestPath, 'm.json');
  assert.deepEqual(args.only, ['A', 'B']);
  assert.equal(args.dryRun, true);
  assert.equal(args.json, true);
  assert.equal(args.allowDirty, true);
});

test('parseArgs defaults only to null rather than an empty list', () => {
  // An empty list would mean "run nothing"; absent means "run everything".
  assert.equal(parseArgs(['m.json']).only, null);
  assert.equal(parseArgs(['m.json']).dryRun, false);
});

test('parseArgs requires a manifest path', () => {
  assert.throws(() => parseArgs(['--json']), /Usage:/);
});

test('a test command that already fails unmutated is BASELINE-RED', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const results = runMutations(repo.dir, manifest([BREAKS_IT]), {
    runner: () => ({ status: 1, stdout: 'the suite was already red\n', stderr: '' }),
  });
  assert.equal(
    results[0].verdict,
    'BASELINE-RED',
    'a suite that fails before anything is mutated cannot tell a real RED from its own noise',
  );
});

test('a BASELINE-RED never applies the mutation', async (t) => {
  // The gate must cost exactly one invocation and leave no trace: a mutated file
  // written and reverted for a run nobody can interpret is pure risk.
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  let calls = 0;
  const results = runMutations(repo.dir, manifest([BREAKS_IT]), {
    runner: () => { calls += 1; return { status: 1, stdout: '', stderr: '' }; },
  });
  assert.equal(calls, 1, 'the baseline must run and the mutated test must not');
  assert.equal(results[0].durationMs, 0);
  assert.equal(fs.readFileSync(path.join(repo.dir, 'src.js'), 'utf8'), SRC);
});

test('the baseline runs once for mutations sharing a testArgs set', async (t) => {
  // Mutation cost is dominated by test bootstrap. A baseline per mutation would
  // double the cost of every manifest; a baseline per arg-set adds one run.
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  let calls = 0;
  runMutations(repo.dir, manifest([
    { ...BREAKS_IT, id: 'A' },
    { ...BREAKS_IT, id: 'B', find: 'function greet(name) {', replace: 'function greet(name) { // x' },
  ]), {
    runner: () => { calls += 1; return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(calls, 3, 'expected one shared baseline plus one run per mutation');
});

test('mutations with different testArgs each get their own baseline', async (t) => {
  // The memo key must include testArgs: reusing one arg-set's baseline for
  // another measures absence in output the second command never produced.
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  let calls = 0;
  runMutations(repo.dir, manifest([
    { ...BREAKS_IT, id: 'A', testArgs: ['check.js'] },
    {
      ...BREAKS_IT,
      id: 'B',
      find: 'function greet(name) {',
      replace: 'function greet(name) { // x',
      testArgs: ['check.js', '--extra'],
    },
  ]), {
    runner: () => { calls += 1; return { status: 0, stdout: '', stderr: '' }; },
  });
  assert.equal(calls, 4, 'expected a separate baseline per distinct testArgs set');
});
