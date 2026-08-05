// Measure the numbers a CLAUDE.md asserts, instead of trusting the session that
// typed them.
//
// WHY: a durable-context file accumulates counts, timings and ports that someone
// wrote down once and nobody re-measured. Observed in GAW's CLAUDE.md: three test
// counts had drifted (fast 722→802, smoke 35→45, full 1683→1917), a port was
// wrong, and one line instructed the reader to "keep the timings honest"
// immediately above the wrong timings. Prose self-discipline does not hold —
// only a command that runs does.
//
// THE ONE RULE: a failing command records a VISIBLE GAP, never a stale number.
// A measurement that silently skips and leaves the old value reads as a clean
// run and is worse than no automation at all, because it launders a stale number
// into a fresh-looking one. Every failure path here writes `**UNMEASURED**` with
// the reason, and the process exits non-zero.
//
// MANIFEST CONTRACT — `.asdlc/facts.json`:
//
//   {
//     "schema": "asdlc-facts/v1",          // optional; rejected if it is some other version
//     "facts": [
//       {
//         "label":   "asdlc unit tests",   // required; the human-visible name in the block
//         "command": ["node", "--test", "scripts/asdlc/test/**/*.test.js"],
//         "capture": "tests (\\d+)"        // optional regex; group 1 is the value
//       }
//     ]
//   }
//
// `command` is an ARGV ARRAY, not a shell string, even though a string reads
// nicer. `lib/exec.js` runs with `shell: false`, so a string would have to be
// split here — and the very first realistic fact ("node --test \"a/**/*.js\"")
// contains a quoted argument with a space, which no naive split gets right and a
// correct split is a shell parser nobody should be maintaining in this package.
// A string `command` is rejected loudly rather than silently mis-split.
//
// `capture` is optional. Without it the fact records the trimmed LAST line of
// stdout — right for `node -v`-shaped commands, wrong for chatty ones, which is
// what `capture` is for. A `capture` that fails to match is a gap, not a
// fallback to the last line: falling back would quietly report the wrong number,
// which is the failure mode this whole file exists to prevent.
//
// Deliberately NOT recorded in the block: a "last measured" timestamp. It would
// make `--check` report staleness on every run, which trains people to ignore
// it. The block's honesty comes from being re-derivable, not from being dated.

const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./lib/exec');
const { makeMarkers, upsertBlock } = require('./lib/marker-block');

const FACTS_MARKERS = makeMarkers('asdlc:facts:auto');
const MANIFEST_REL_PATH = '.asdlc/facts.json';
const CLAUDE_MD_REL_PATH = 'CLAUDE.md';
const SCHEMA = 'asdlc-facts/v1';

const BLOCK_NOTE =
  '<!-- Measured by `node scripts/asdlc/facts.js` from .asdlc/facts.json. Do not hand-edit: your numbers will be overwritten, and `--check` will fail until they are. -->';

// Collapses to a single line and caps the length, so one fact is always exactly
// one list item no matter how noisy a command's stderr is.
function summarize(text, max = 120) {
  const oneLine = String(text == null ? '' : text).replace(/[\r\n]+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function loadManifest(cwd) {
  const manifestPath = path.join(cwd, MANIFEST_REL_PATH);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `${MANIFEST_REL_PATH} not found (looked in ${manifestPath}) — declare the facts to measure there first.`,
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    throw new Error(`${MANIFEST_REL_PATH} is not valid JSON: ${err.message}`);
  }

  if (manifest.schema !== undefined && manifest.schema !== SCHEMA) {
    throw new Error(
      `${MANIFEST_REL_PATH} declares schema "${manifest.schema}", but this script speaks "${SCHEMA}".`,
    );
  }
  if (!Array.isArray(manifest.facts)) {
    throw new Error(`${MANIFEST_REL_PATH} must contain a "facts" array.`);
  }

  // Validated eagerly and as a whole, before any command runs: a typo in the
  // fifth fact should not be discovered after the first four have each spent a
  // minute running a test suite.
  manifest.facts.forEach((fact, i) => {
    const where = `${MANIFEST_REL_PATH} facts[${i}]`;
    if (!fact || typeof fact.label !== 'string' || fact.label.trim() === '') {
      throw new Error(`${where} needs a non-empty "label".`);
    }
    if (typeof fact.command === 'string') {
      throw new Error(
        `${where} ("${fact.label}") has a string "command". It must be an argv array, e.g. ["node", "--test", "scripts/**/*.test.js"] — commands run without a shell, so a string cannot be split safely.`,
      );
    }
    if (!Array.isArray(fact.command) || fact.command.length === 0
        || !fact.command.every((a) => typeof a === 'string')) {
      throw new Error(`${where} ("${fact.label}") needs a non-empty "command" argv array of strings.`);
    }
    if (fact.capture !== undefined && typeof fact.capture !== 'string') {
      throw new Error(`${where} ("${fact.label}") has a non-string "capture" — it must be a regex source string.`);
    }
  });

  return manifest;
}

function describeRunFailure(err) {
  // `run()` attaches the child's exit code and stderr. A numeric status means
  // the command ran and rejected; anything else (spawn ENOENT, etc.) only has a
  // message worth showing.
  if (typeof err.status === 'number') {
    const detail = summarize(err.stderr);
    return detail ? `command failed: exit ${err.status} — ${detail}` : `command failed: exit ${err.status}`;
  }
  return `command failed: ${summarize(err.message)}`;
}

function measureFact(cwd, fact, { runner = run } = {}) {
  const gap = (error) => ({ label: fact.label, value: null, error });

  let output;
  try {
    output = runner(fact.command[0], fact.command.slice(1), { cwd });
  } catch (err) {
    return gap(describeRunFailure(err));
  }

  const trimmed = String(output).trim();
  if (trimmed === '') return gap('command produced no output to measure');

  if (fact.capture === undefined) {
    return { label: fact.label, value: trimmed.split(/\r?\n/).pop().trim(), error: null };
  }

  let pattern;
  try {
    pattern = new RegExp(fact.capture);
  } catch (err) {
    return gap(`invalid capture pattern "${fact.capture}": ${err.message}`);
  }

  const match = trimmed.match(pattern);
  if (!match) {
    // NOT a fallback to the last line. See the header: a silent fallback here
    // reports a confidently wrong number, which is the exact failure mode.
    return gap(`capture pattern "${fact.capture}" did not match the command output`);
  }
  return {
    label: fact.label,
    // `match[1]` when the pattern has a group, the whole match when it does not.
    value: (match[1] === undefined ? match[0] : match[1]).trim(),
    error: null,
  };
}

function measureFacts(cwd, manifest, { runner = run } = {}) {
  return manifest.facts.map((fact) => measureFact(cwd, fact, { runner }));
}

function formatResult(result) {
  const label = summarize(result.label, 200);
  if (result.error) {
    // Rendered so an eye catches it in a wall of markdown: the bold token where
    // the number would have been, plus why.
    return `- ${label}: **UNMEASURED** (${result.error})`;
  }
  return `- ${label}: **${summarize(result.value)}**`;
}

function renderFactsBody(results) {
  const lines = [BLOCK_NOTE, ''];
  if (results.length === 0) {
    lines.push('_No facts declared in `.asdlc/facts.json`._');
  } else {
    lines.push(...results.map(formatResult));
  }
  return lines.join('\n');
}

// The reusable seam. Runs every declared command and works out what CLAUDE.md
// WOULD become — but writes nothing, so `--check` and `asdlc-lint.js` can ask
// "is this stale?" without a side effect.
function computeFactsUpdate(cwd, { runner = run, manifest } = {}) {
  const resolvedManifest = manifest || loadManifest(cwd);

  // Checked before any command runs: discovering a missing CLAUDE.md after a
  // three-minute test suite is a bad trade, and this repo genuinely had no
  // CLAUDE.md when this script was written.
  const claudeMdPath = path.join(cwd, CLAUDE_MD_REL_PATH);
  if (!fs.existsSync(claudeMdPath)) {
    throw new Error(
      `${CLAUDE_MD_REL_PATH} not found (looked in ${claudeMdPath}) — there is nowhere to write the facts block.`,
    );
  }

  const current = fs.readFileSync(claudeMdPath, 'utf8');
  const results = measureFacts(cwd, resolvedManifest, { runner });
  // upsertBlock applies the injection guard: a command whose output contains the
  // marker text throws here rather than corrupting the span on a later run.
  const next = upsertBlock(current, FACTS_MARKERS, renderFactsBody(results));

  return {
    claudeMdPath,
    current,
    next,
    changed: next !== current,
    results,
    gaps: results.filter((r) => r.error),
  };
}

function writeFactsBlock(cwd, options = {}) {
  const update = computeFactsUpdate(cwd, options);
  if (update.changed) fs.writeFileSync(update.claudeMdPath, update.next);
  return update;
}

function isFactsBlockStale(cwd, options = {}) {
  return computeFactsUpdate(cwd, options).changed;
}

function main(argv = process.argv.slice(2), { cwd = process.cwd(), runner = run } = {}) {
  const unknown = argv.filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    console.error(`facts.js: unrecognized argument(s): ${unknown.join(', ')}`);
    console.error('Usage: node scripts/asdlc/facts.js [--check]');
    process.exitCode = 1;
    return 1;
  }
  const checkOnly = argv.includes('--check');

  let update;
  try {
    update = checkOnly ? computeFactsUpdate(cwd, { runner }) : writeFactsBlock(cwd, { runner });
  } catch (err) {
    // Every throw out of here is a configuration problem with a written-out
    // message. Printing the message alone (not the stack) keeps the CLI's
    // failures readable; an unexpected error still surfaces its message.
    console.error(`facts.js: ${err.message}`);
    process.exitCode = 1;
    return 1;
  }

  for (const result of update.results) {
    console.log(formatResult(result));
  }

  if (checkOnly) {
    if (update.changed) {
      console.error('CLAUDE.md facts block is stale — run `node scripts/asdlc/facts.js` to refresh it.');
      process.exitCode = 1;
      return 1;
    }
    console.log('CLAUDE.md facts block is up to date.');
    return 0;
  }

  console.log(update.changed
    ? `Rewrote the facts block in ${update.claudeMdPath}.`
    : 'CLAUDE.md facts block was already up to date.');

  if (update.gaps.length > 0) {
    // Non-zero even though the write succeeded: the block is honest, but a
    // declared fact is unknown, and that is a state a human has to resolve.
    console.error(`${update.gaps.length} declared fact(s) could not be measured — the block records the gap.`);
    process.exitCode = 1;
    return 1;
  }
  return 0;
}

module.exports = {
  FACTS_MARKERS,
  MANIFEST_REL_PATH,
  SCHEMA,
  loadManifest,
  measureFact,
  measureFacts,
  renderFactsBody,
  computeFactsUpdate,
  writeFactsBlock,
  isFactsBlockStale,
  main,
};

if (require.main === module) {
  main();
}
