const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { run } = require('../lib/exec');
const os = require('node:os');
const {
  runCli,
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
  assert.throws(
    () => verifyRestored(target, SRC),
    /DIRTY-REVERT/,
    'a revert whose bytes on disk differ from what was written was accepted as clean',
  );
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

test('an expectRed that appears in green output is EXPECT-RED-INERT', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  const echoed = 'greet returns a greeting';
  let call = 0;
  const results = runMutations(repo.dir, manifest([{ ...BREAKS_IT, expectRed: echoed }]), {
    // The production shape exactly: the anchor is in the output of the green
    // baseline AND of the red mutated run, because the reporter echoes test
    // names on success. The mutated run really does go red — so without the
    // gate this returns RED-AS-PREDICTED on an anchor that proves nothing.
    runner: () => { call += 1; return { status: call === 1 ? 0 : 1, stdout: `${echoed}\n`, stderr: '' }; },
  });
  assert.equal(
    results[0].verdict,
    'EXPECT-RED-INERT',
    'an anchor present in green output cannot tell a red from a green, whatever the run does',
  );
});

test('an EXPECT-RED-INERT never runs the mutated test', async (t) => {
  const repo = await fixtureWithSource();
  t.after(repo.cleanup);
  let calls = 0;
  const results = runMutations(repo.dir, manifest([{ ...BREAKS_IT, expectRed: 'always present' }]), {
    runner: () => { calls += 1; return { status: 0, stdout: 'always present\n', stderr: '' }; },
  });
  assert.equal(calls, 1, 'the baseline must run and the mutated test must not');
  assert.equal(results[0].durationMs, 0);
  assert.equal(fs.readFileSync(path.join(repo.dir, 'src.js'), 'utf8'), SRC);
});

// ---------------------------------------------------------------------------
// runCli — the CLI wiring (v0.2-s7)
//
// Deliberately the cheap tier: a bare temp directory, no git init, both shell
// seams stubbed. Per test-mutation-evidence.md the mutation loop pays test
// BOOTSTRAP once per run, and the fixture-repo tests above cost ~80x these — so
// this sprint's mutation anchors belong on these assertions, not on those.
// ---------------------------------------------------------------------------

function cheapWorkdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutate-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'src.js'), SRC);
  return dir;
}

function writeManifest(dir, mutations) {
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest(mutations), null, 2));
  return manifestPath;
}

function sinks() {
  const out = [];
  const errs = [];
  return {
    out, errs, log: (m) => out.push(String(m)), err: (m) => errs.push(String(m)),
  };
}

// git status --porcelain reporting a clean tree.
const CLEAN_TREE = () => '';

// runCapture's shape, one queued response per call; the last repeats.
function captureQueue(responses) {
  let i = 0;
  return () => {
    const response = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return response;
  };
}

const GREEN = { status: 0, stdout: '', stderr: '' };
const RED_AS_PREDICTED = { status: 1, stdout: 'AssertionError: hi ada\n', stderr: '' };

test('runCli returns 0 and renders text then markdown on an evidential run', (t) => {
  const dir = cheapWorkdir(t);
  const manifestPath = writeManifest(dir, [BREAKS_IT]);
  const s = sinks();

  const code = runCli([manifestPath], {
    cwd: dir,
    log: s.log,
    err: s.err,
    runner: CLEAN_TREE,
    capture: captureQueue([GREEN, RED_AS_PREDICTED]),
  });

  assert.equal(code, 0);
  assert.deepEqual(s.errs, []);
  assert.equal(s.out.length, 3, 'text, a blank separator, then markdown');
  assert.match(s.out[0], /RED-AS-PREDICTED/);
  assert.equal(s.out[1], '');
  assert.match(s.out[2], /\|/, 'the markdown render is a table');
});

test('runCli returns 1 when the run is not evidence', (t) => {
  const dir = cheapWorkdir(t);
  // An anchor that matches nothing: the mutation is never applied, so nothing
  // can be concluded from what the test did. A zero here is the failure this
  // whole tool exists to prevent — a /checkpoint gate waving through a manifest
  // whose anchors have rotted.
  const manifestPath = writeManifest(dir, [{ ...BREAKS_IT, find: 'no such line in src.js' }]);
  const s = sinks();

  const code = runCli([manifestPath], {
    cwd: dir,
    log: s.log,
    err: s.err,
    runner: CLEAN_TREE,
    capture: captureQueue([GREEN]),
  });

  assert.equal(code, 1, 'a run that is not evidence must exit non-zero');
  assert.match(s.out[0], /ANCHOR-MISS/);
});

test('runCli returns 0 for a GREEN run — a finding, not a broken one', (t) => {
  const dir = cheapWorkdir(t);
  const manifestPath = writeManifest(dir, [BREAKS_IT]);
  const s = sinks();

  // Baseline green, mutated ALSO green. GREEN is pointedly absent from
  // report.js's NOT_EVIDENCE set: the mutation WAS applied and reverted as
  // intended, so the run is trustworthy and what it found — a test that cannot
  // see its own subject — is the finding. Conflating "bad news" with "bad run"
  // would make the exit code unable to distinguish a hollow test from a rotted
  // anchor, which are opposite problems with opposite fixes.
  const code = runCli([manifestPath], {
    cwd: dir,
    log: s.log,
    err: s.err,
    runner: CLEAN_TREE,
    capture: captureQueue([GREEN, GREEN]),
  });

  assert.equal(code, 0, 'a GREEN run is trustworthy evidence and must exit zero');
  assert.match(s.out[0], /GREEN/);
});

test('runCli --json writes JSON only', (t) => {
  const dir = cheapWorkdir(t);
  const manifestPath = writeManifest(dir, [BREAKS_IT]);
  const s = sinks();

  const code = runCli([manifestPath, '--json'], {
    cwd: dir,
    log: s.log,
    err: s.err,
    runner: CLEAN_TREE,
    capture: captureQueue([GREEN, RED_AS_PREDICTED]),
  });

  assert.equal(code, 0);
  assert.equal(s.out.length, 1, 'no text or markdown alongside the JSON');
  const parsed = JSON.parse(s.out[0]);
  assert.equal(parsed.isEvidence, true);
  assert.equal(parsed.results[0].verdict, 'RED-AS-PREDICTED');
});

test('runCli returns 1 and reports usage when the arguments do not parse', () => {
  const s = sinks();
  const code = runCli([], {
    cwd: process.cwd(), log: s.log, err: s.err, runner: CLEAN_TREE,
  });

  assert.equal(code, 1);
  assert.deepEqual(s.out, [], 'nothing is rendered when nothing ran');
  assert.match(s.errs[0], /Usage: node mutate\.js/);
});

test('runCli refuses a dirty tree before reading the manifest', (t) => {
  const dir = cheapWorkdir(t);
  const s = sinks();

  // The manifest path does not exist: if the guard did not run first, the
  // failure would be ENOENT rather than the refusal.
  const code = runCli([path.join(dir, 'absent.json')], {
    cwd: dir,
    log: s.log,
    err: s.err,
    runner: () => ' M src.js',
  });

  assert.equal(code, 1);
  assert.match(s.errs[0], /Refusing to run with uncommitted changes/);
  assert.match(s.errs[0], /M src\.js/, 'the porcelain output must be included');
});

test('runCli restores an in-flight mutation when the run throws', (t) => {
  const dir = cheapWorkdir(t);
  const victim = path.join(dir, 'victim.js');
  fs.writeFileSync(victim, 'MUTATED');
  __setInFlight({ absPath: victim, before: 'ORIGINAL' });
  const s = sinks();

  const code = runCli([path.join(dir, 'absent.json')], {
    cwd: dir,
    log: s.log,
    err: s.err,
    runner: CLEAN_TREE,
  });

  assert.equal(code, 1);
  assert.equal(
    fs.readFileSync(victim, 'utf8'),
    'ORIGINAL',
    'a throw must revert before it reports, or the tree is left mutated',
  );
});

// Finding 4 of docs/2026-08-08-sprint-loop-findings.md. The guard's own reasons
// — telling a stranded mutation from the author's edits, and giving
// verifyRestored a known-good state — do not apply to a run that writes nothing.
test('runCli validates anchors on a dirty tree under --dry-run', (t) => {
  const dir = cheapWorkdir(t);
  const s = sinks();
  const manifestPath = writeManifest(dir, [
    { id: 'A', file: 'src.js', find: 'return "hi " + name;', replace: 'return name;', expectRed: 'boom' },
  ]);

  const code = runCli([manifestPath, '--dry-run'], {
    cwd: dir,
    log: s.log,
    err: s.err,
    // A manifest is an untracked file, so the tree is dirty by definition at the
    // moment you want to check its anchors. That is the order the guard made
    // impossible.
    runner: () => ' M src.js\n?? manifest.json',
    capture: () => { throw new Error('no test command may run under --dry-run'); },
  });

  assert.equal(code, 0);
  assert.equal(s.errs.length, 0, `no refusal expected; got: ${s.errs.join(' | ')}`);
  assert.match(s.out.join('\n'), /ANCHOR-OK/);
});

test('runCli still refuses a dirty tree for a real run', (t) => {
  const dir = cheapWorkdir(t);
  const s = sinks();
  const manifestPath = writeManifest(dir, [
    { id: 'A', file: 'src.js', find: 'return "hi " + name;', replace: 'return name;', expectRed: 'boom' },
  ]);

  // Without --dry-run the exemption must not apply: a real run writes, tests and
  // reverts, and that is exactly what the guard protects.
  const code = runCli([manifestPath], {
    cwd: dir,
    log: s.log,
    err: s.err,
    runner: () => ' M src.js',
  });

  assert.equal(code, 1);
  assert.match(s.errs[0], /Refusing to run with uncommitted changes/);
});

test('--allow-dirty and --dry-run remain independent switches', (t) => {
  const dir = cheapWorkdir(t);
  const s = sinks();
  const manifestPath = writeManifest(dir, [
    { id: 'A', file: 'src.js', find: 'return "hi " + name;', replace: 'return name;', expectRed: 'boom' },
  ]);

  // --allow-dirty alone still reaches a real run on a dirty tree; the dry-run
  // exemption must not have swallowed it.
  const code = runCli([manifestPath, '--allow-dirty'], {
    cwd: dir,
    log: s.log,
    err: s.err,
    runner: () => ' M src.js',
    capture: captureQueue([{ status: 1, output: 'boom' }]),
  });

  assert.notEqual(s.out.join('\n').includes('ANCHOR-OK'), true, '--allow-dirty alone is not a dry run');
  assert.equal(typeof code, 'number');
});