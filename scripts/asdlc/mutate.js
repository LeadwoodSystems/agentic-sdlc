// Executes a model-authored mutation manifest: apply a literal edit, run the
// project's own test command, classify what happened, revert, verify the revert.
//
// Deliberately NOT a mutation generator. Auto-generated mutants answer "is this
// line covered?"; the question this serves is "does this test's assertion match
// the claim in its docstring?", which only the author of the claim can pose.
// The script executes what the manifest says and reports faithfully — the
// judgment stays with the reader.
//
// The one thing it must never do is report a clean run for a mutation that was
// not applied. A silently-skipped mutation reads exactly like a passing one,
// which is the failure class the practice exists to prevent; reproducing it in
// the tooling would be worse than having no tooling.

const fs = require('node:fs');
const path = require('node:path');
const { run, runCapture } = require('./lib/exec');
const { applyMutation } = require('./lib/apply-mutation');
const { parseManifest } = require('./lib/manifest');
const {
  renderText,
  renderMarkdown,
  renderJson,
  summarize,
} = require('./lib/report');

const USAGE = 'Usage: node mutate.js <manifest.json> [--only <id>[,<id>...]] [--dry-run] [--json] [--allow-dirty]';

// Module-level so the signal handlers can reach it. At most one mutation is
// applied at a time — serializing is the whole point, since they all edit one
// working tree — so a single slot is sufficient, and a stack would imply a
// concurrency this tool deliberately does not have.
let inFlight = null; // { absPath, before }

function restoreInFlight() {
  if (!inFlight) return;
  fs.writeFileSync(inFlight.absPath, inFlight.before);
  inFlight = null;
}

// Test seam: lets the crash-safety test strand a mutation without having to
// interrupt a real run.
function __setInFlight(record) {
  inFlight = record;
}

// "We wrote the original back" and "the original is on disk" are not the same
// statement. The bug that motivated this tool was exactly that gap: the revert
// went out through a codec that read BOM-less UTF-8 as ANSI, so every em-dash
// came back as mojibake and the file had to be rewritten from scratch. Reading
// the bytes back is the only way to know.
function verifyRestored(absPath, before) {
  const onDisk = fs.readFileSync(absPath, 'utf8');
  if (onDisk !== before) {
    throw new Error(
      `DIRTY-REVERT: ${absPath} does not match its pre-mutation content after the revert. `
      + 'Repair the working tree by hand — every later result would be measured against a source nobody authored.',
    );
  }
}

function assertCleanTree(cwd, { runner = run } = {}) {
  const status = runner('git', ['status', '--porcelain'], { cwd });
  if (status) {
    // The porcelain output is included on purpose: if a run is interrupted, the
    // author needs to tell a stranded mutation from their own edits, and a bare
    // "working tree is dirty" leaves them diffing to find out.
    throw new Error(
      `Refusing to run with uncommitted changes:\n${status}\n\n`
      + 'Commit or stash them, or pass --allow-dirty.',
    );
  }
}

// One concatenation, used for both the baseline and the mutated run. They must
// be built identically: "absent from the baseline" is only a guarantee about
// "present in the mutated run" if both statements are about the same string.
function combined({ stdout, stderr }) {
  return `${stdout}${stderr}`;
}

// The unmutated run of this mutation's test command. Memoized per argv, because
// mutation cost is dominated by test bootstrap — measured in this repo at 16.7s
// for a test that builds real git fixture repos against 0.2s for a library one —
// and a per-mutation baseline would double every manifest's cost instead of
// adding one run per distinct arg-set.
function getBaseline(workdir, manifest, mutation, { runner, baselines }) {
  const args = [...manifest.testCommand.slice(1), ...(mutation.testArgs || [])];
  const key = JSON.stringify([manifest.testCommand[0], ...args]);
  if (!baselines.has(key)) {
    baselines.set(key, runner(manifest.testCommand[0], args, { cwd: workdir, env: manifest.env }));
  }
  return baselines.get(key);
}

function classify(status, stdout, stderr, expectRed) {
  if (status === 0) return 'GREEN';
  // The substring check is what separates "it went red" from "it went red FOR
  // THE REASON PREDICTED". A RED without it is collateral damage — a fixture
  // collision, a broader break than intended — and must not be recorded as
  // evidence that the test guards its claim.
  return `${stdout}${stderr}`.includes(expectRed) ? 'RED-AS-PREDICTED' : 'RED-WRONG-REASON';
}

function selectMutations(mutations, only) {
  if (!only) return mutations;
  const byId = new Map(mutations.map((m) => [m.id, m]));
  return only.map((id) => {
    const found = byId.get(id);
    if (!found) {
      throw new Error(
        `--only names an unknown mutation id "${id}". The manifest defines: ${[...byId.keys()].join(', ')}`,
      );
    }
    return found;
  });
}

function runOne(workdir, manifest, mutation, { runner, dryRun, baselines }) {
  const absPath = path.resolve(workdir, mutation.file);
  const base = {
    id: mutation.id,
    label: mutation.label,
    why: mutation.why,
    expectRed: mutation.expectRed,
    durationMs: 0,
  };

  const before = fs.readFileSync(absPath, 'utf8');
  const { verdict, result } = applyMutation(before, mutation.find, mutation.replace);

  // A mutation that could not be applied never gets a test run, and its
  // duration stays 0 — a timing borrowed from a test that did not execute is
  // the sort of detail that makes a skipped mutation read as a real one.
  if (verdict !== 'APPLIED') return { ...base, verdict };

  // --dry-run stops here: anchors are authored blind against files the author
  // is not looking at, so checking them all without paying for a single test
  // run is the cheapest thing this tool does.
  if (dryRun) return { ...base, verdict: 'ANCHOR-OK' };

  // The test command is run unmutated first. Everything below this point is a
  // statement about the DIFFERENCE the mutation made, and a difference needs
  // something to differ from.
  const baseline = getBaseline(workdir, manifest, mutation, { runner, baselines });

  // Nothing is measurable against a red baseline: the mutated run would fail
  // too, and expectRed's presence would say nothing about which failure
  // produced it. Recorded per mutation rather than thrown, because a red
  // baseline belongs to one testArgs set and the loop already continues past a
  // bad anchor for the same reason.
  if (baseline.status !== 0) return { ...base, verdict: 'BASELINE-RED' };

  const cmd = manifest.testCommand[0];
  const args = [...manifest.testCommand.slice(1), ...(mutation.testArgs || [])];

  const startedAt = process.hrtime.bigint();
  let outcome;
  inFlight = { absPath, before };
  try {
    fs.writeFileSync(absPath, result);
    outcome = runner(cmd, args, { cwd: workdir, env: manifest.env });

    // Contamination check, distinct from the revert check below: if the test
    // command rewrote the file while it ran (a formatter, a codegen step, a
    // test that writes its own fixtures), then what was measured is not the
    // mutation that was applied, and every later mutation would be measured
    // against a source nobody authored. Abort rather than report.
    const afterRun = fs.readFileSync(absPath, 'utf8');
    if (afterRun !== result) {
      throw new Error(
        `DIRTY-REVERT: ${mutation.file} was modified while the test command ran, so mutation `
        + `${mutation.id} did not measure what it applied. Aborting the run.`,
      );
    }
  } finally {
    // Runs on every path — a thrown runner, a contaminated file, a failed
    // assertion — so the tree is never left holding a mutation.
    restoreInFlight();
  }

  verifyRestored(absPath, before);

  return {
    ...base,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    verdict: classify(outcome.status, outcome.stdout, outcome.stderr, mutation.expectRed),
  };
}

function runMutations(cwd, manifest, { runner = runCapture, only = null, dryRun = false } = {}) {
  const workdir = path.resolve(cwd, manifest.cwd || '.');
  const selected = selectMutations(manifest.mutations, only);

  const results = [];
  const baselines = new Map();
  for (const mutation of selected) {
    // A bad anchor records its verdict and the loop continues. Aborting on the
    // first one would make a twelve-mutation manifest cost twelve cycles to
    // debug, and anchors written blind in one pass fail in batches. The RUN is
    // still marked not-evidence, via summarize().isEvidence.
    results.push(runOne(workdir, manifest, mutation, { runner, dryRun, baselines }));
  }
  return results;
}

function parseArgs(argv) {
  const args = {
    manifestPath: null, only: null, dryRun: false, json: false, allowDirty: false,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--only') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`--only needs a value. ${USAGE}`);
      args.only = value.split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--allow-dirty') {
      args.allowDirty = true;
    } else if (arg.startsWith('--')) {
      // Refused rather than ignored: a typo'd flag that silently does nothing
      // means the author believes a guard is on when it is not.
      throw new Error(`Unknown flag "${arg}". ${USAGE}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length === 0) throw new Error(USAGE);
  [args.manifestPath] = positional;
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
    return;
  }

  // Registered here rather than at module load, so importing this module in a
  // test does not install process-wide handlers.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      restoreInFlight();
      console.error(`\n${signal} — reverted the in-flight mutation. Check 'git status' before trusting the tree.`);
      process.exit(130);
    });
  }
  process.on('uncaughtException', (err) => {
    restoreInFlight();
    console.error(err.stack || err.message);
    process.exit(1);
  });

  const cwd = process.cwd();
  try {
    if (!args.allowDirty) assertCleanTree(cwd);
    const manifest = parseManifest(fs.readFileSync(args.manifestPath, 'utf8'));
    const results = runMutations(cwd, manifest, { only: args.only, dryRun: args.dryRun });

    if (args.json) {
      console.log(renderJson(results));
    } else {
      console.log(renderText(results));
      console.log('');
      console.log(renderMarkdown(results));
    }

    // Non-zero when any mutation was not applied as intended. Those runs are
    // not evidence, and a green exit code would let a /checkpoint gate wave
    // through a manifest whose anchors have rotted.
    process.exit(summarize(results).isEvidence ? 0 : 1);
  } catch (err) {
    restoreInFlight();
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = {
  runMutations,
  assertCleanTree,
  restoreInFlight,
  verifyRestored,
  parseArgs,
  __setInFlight,
};

if (require.main === module) {
  main();
}
