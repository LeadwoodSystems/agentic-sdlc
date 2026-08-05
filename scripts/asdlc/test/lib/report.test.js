const test = require('node:test');
const assert = require('node:assert/strict');
const {
  renderText,
  renderMarkdown,
  renderJson,
  summarize,
} = require('../../lib/report');

const RESULTS = [
  {
    id: 'A',
    label: 'full_sequence',
    verdict: 'RED-AS-PREDICTED',
    durationMs: 14700,
    expectRed: 'the recap must run after the send is parked',
  },
  {
    id: 'I',
    label: 'module_level_monkeypatch',
    verdict: 'GREEN',
    durationMs: 40200,
    expectRed: 'resolves at call time',
  },
];

test('renderText shows id, label, verdict and duration on one line', () => {
  assert.match(renderText(RESULTS), /MUT A \[full_sequence\] RED-AS-PREDICTED \(14\.7s\)/);
});

test('a GREEN carries the decision the model still owes', () => {
  // GREEN is ambiguous by nature: the test is HOLLOW or the mutation is INERT.
  // Reporting it without that prompt is how an inert mutation becomes a false
  // "this test is weak" finding.
  assert.match(renderText(RESULTS), /HOLLOW or the mutation is INERT/);
});

test('a RED-AS-PREDICTED shows the predicted reason it was matched against', () => {
  assert.match(renderText(RESULTS), /the recap must run after the send is parked/);
});

test('label falls back to id when absent', () => {
  const bare = [{ id: 'Z', verdict: 'GREEN', durationMs: 1000, expectRed: 'x' }];
  assert.match(renderText(bare), /MUT Z \[Z\] GREEN/);
});

test('summarize counts by verdict', () => {
  assert.deepEqual(summarize(RESULTS).counts, { 'RED-AS-PREDICTED': 1, GREEN: 1 });
});

test('a run with only RED-AS-PREDICTED and GREEN is evidence', () => {
  assert.equal(summarize(RESULTS).isEvidence, true);
});

test('an anchor-class verdict makes the whole run not-evidence', () => {
  const withMiss = [...RESULTS, { id: 'C', verdict: 'ANCHOR-MISS', durationMs: 0, expectRed: 'x' }];
  assert.equal(summarize(withMiss).isEvidence, false);
});

test('AMBIGUOUS-ANCHOR, NO-OP and DIRTY-REVERT each make a run not-evidence', () => {
  for (const verdict of ['AMBIGUOUS-ANCHOR', 'NO-OP', 'DIRTY-REVERT']) {
    const results = [{ id: 'C', verdict, durationMs: 0, expectRed: 'x' }];
    assert.equal(summarize(results).isEvidence, false, verdict);
  }
});

test('RED-WRONG-REASON is a finding, not a broken instrument', () => {
  // It means "discard this mutation", which the model reads and acts on. The
  // run itself is still trustworthy, so the exit code stays clean.
  const wrong = [{ id: 'C', verdict: 'RED-WRONG-REASON', durationMs: 100, expectRed: 'x' }];
  assert.equal(summarize(wrong).isEvidence, true);
});

test('the summary line names every verdict present', () => {
  assert.match(renderText(RESULTS), /2 mutations: 1 RED-AS-PREDICTED, 1 GREEN/);
});

test('the summary line reports reverts clean only when they were', () => {
  assert.match(renderText(RESULTS), /Reverts verified clean/);
  const dirty = [{ id: 'C', verdict: 'DIRTY-REVERT', durationMs: 0, expectRed: 'x' }];
  assert.doesNotMatch(renderText(dirty), /Reverts verified clean/);
});

test('renderMarkdown emits a paste-ready table with a header row', () => {
  const md = renderMarkdown(RESULTS);
  assert.match(md, /^\| id \| label \| verdict \| evidence \|$/m);
  assert.match(md, /^\|---\|/m);
  assert.match(md, /\| A \| full_sequence \| RED-AS-PREDICTED \|/);
});

test('a pipe in the evidence text is escaped so the table survives', () => {
  const piped = [{ id: 'A', verdict: 'RED-AS-PREDICTED', durationMs: 1, expectRed: 'a | b' }];
  assert.match(renderMarkdown(piped), /a \\\| b/);
});

test('a newline in the evidence text is flattened so the table survives', () => {
  const multi = [{ id: 'A', verdict: 'RED-AS-PREDICTED', durationMs: 1, expectRed: 'line one\nline two' }];
  const md = renderMarkdown(multi);
  assert.match(md, /line one line two/);
  // Header, separator, one row — a stray newline would make it four.
  assert.equal(md.trim().split('\n').length, 3);
});

test('renderJson round-trips the results and the summary', () => {
  const parsed = JSON.parse(renderJson(RESULTS));
  assert.equal(parsed.results.length, 2);
  assert.equal(parsed.counts['RED-AS-PREDICTED'], 1);
  assert.equal(parsed.isEvidence, true);
});

test('an empty result set is reported as such rather than as a clean run', () => {
  // A run that executed nothing must not read like a run that passed.
  assert.match(renderText([]), /0 mutations/);
  assert.equal(summarize([]).isEvidence, true);
});
