const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseManifest } = require('../lib/manifest');
const { applyMutation } = require('../lib/apply-mutation');

// scripts/asdlc/test -> scripts/asdlc -> scripts -> repo root
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MANIFEST_DIR = path.join(REPO_ROOT, 'docs', 'mutation-manifests');

// WHY THIS EXISTS: a committed manifest is cited by a handoff as evidence that a
// test bites, but it is only ever checked when someone chooses to run the
// harness - a deliberate, occasional act, because it is expensive. Between runs
// the anchors rot silently: a refactor moves the line, or a review rewords the
// prose, and the manifest still LOOKS like evidence while proving nothing.
//
// v0.3-s3 hit exactly this. A review required the one README line WIDEDIAGRAM
// anchored on to be reworded; the manifest had to be re-anchored and the harness
// re-run, and nothing but a human noticing stood between that and a manifest
// that would have reported ANCHOR-MISS the next time anyone looked.
//
// This test is the cheap half of the harness: no mutation is applied, no test
// command runs. It reads each target file once and asks applyMutation whether
// the anchor would resolve. Milliseconds, and it moves both ANCHOR-MISS and
// AMBIGUOUS-ANCHOR from discovered-on-next-harness-run to caught-at-commit.

function manifestFiles() {
  return fs.readdirSync(MANIFEST_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

// Returns { name, manifest } or { name, error } - never throws, so one unparseable
// manifest reports as a finding rather than aborting the walk before the rest are
// checked.
function loadManifests() {
  return manifestFiles().map((name) => {
    try {
      return { name, manifest: parseManifest(fs.readFileSync(path.join(MANIFEST_DIR, name), 'utf8')) };
    } catch (err) {
      return { name, error: err.message };
    }
  });
}

test('every committed mutation manifest parses', () => {
  const loaded = loadManifests();
  // Without this a rename of the directory - or a glob that stops matching -
  // makes the gate below pass by walking nothing. An inert gate that reports
  // success is worse than no gate; same guard as command-prose.test.js.
  assert.ok(loaded.length > 0, `no manifests found under ${MANIFEST_DIR}; the anchor gate is inspecting nothing`);

  const unparseable = loaded
    .filter((entry) => entry.error)
    .map((entry) => `${entry.name}: ${entry.error}`);
  assert.deepEqual(unparseable, [], `these manifests no longer parse: ${unparseable.join('; ')}`);
});

test('every mutation anchor still resolves uniquely in its target file', () => {
  const problems = [];
  let checked = 0;

  for (const { name, manifest, error } of loadManifests()) {
    if (error) {
      // Reported in full by the parse test; recorded here too so an unparseable
      // manifest is never silently skipped by the check that matters.
      problems.push(`${name}: could not parse, so its anchors were not checked`);
      continue;
    }

    for (const mutation of manifest.mutations) {
      checked += 1;
      const target = path.join(REPO_ROOT, manifest.cwd || '.', mutation.file);

      // A missing target is a different defect from a missed anchor - the file
      // was renamed or deleted - and saying so beats reporting ANCHOR-MISS
      // against a file that is not there.
      if (!fs.existsSync(target)) {
        problems.push(`${name} ${mutation.id}: target file ${mutation.file} no longer exists`);
        continue;
      }

      // applyMutation rather than a substring count, so this test cannot drift
      // from the matching the harness actually performs - it owns the CRLF
      // anchor conversion and the overlapping-occurrence rule. APPLIED is the
      // only verdict that means "this mutation would still run": it excludes
      // ANCHOR-MISS, AMBIGUOUS-ANCHOR, and NO-OP (an anchor whose replacement
      // cannot change the file, which would make a GREEN meaningless).
      const { verdict } = applyMutation(fs.readFileSync(target, 'utf8'), mutation.find, mutation.replace);
      if (verdict !== 'APPLIED') {
        problems.push(`${name} ${mutation.id}: ${verdict} against ${mutation.file}`);
      }
    }
  }

  assert.ok(checked > 0, 'the manifests hold no mutations at all; this gate is inspecting nothing');
  assert.deepEqual(
    problems,
    [],
    'these mutation anchors no longer resolve, so the evidence citing them is stale. '
    + 'Re-anchor the manifest against the current file and re-run '
    + '`node scripts/asdlc/mutate.js <manifest>` to regenerate the table its handoff quotes: '
    + `${problems.join('; ')}`,
  );
});
