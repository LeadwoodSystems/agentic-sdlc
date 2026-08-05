// Renders mutation results. Pure string building — there is deliberately no
// `console` call anywhere in this module, which is what lets every rendering be
// asserted directly instead of through captured output.
//
// The renderers carry one job beyond formatting: making a GREEN unmissable.
// A GREEN means the test passed WITH the mutation applied, and that is
// ambiguous — either the test is HOLLOW (its assertion cannot see the claim in
// its own docstring) or the mutation was INERT (it never changed behaviour, so
// the test was never given a chance to fail). Read naively as "the test is
// weak", an inert mutation manufactures a false finding out of a broken
// instrument. Every GREEN therefore prints the decision the reader still owes.

// Fixed rather than first-appearance order, so the same run always renders the
// same summary line regardless of how the manifest happened to be ordered.
const VERDICT_ORDER = [
  'RED-AS-PREDICTED',
  'RED-WRONG-REASON',
  'GREEN',
  'ANCHOR-OK',
  'ANCHOR-MISS',
  'AMBIGUOUS-ANCHOR',
  'NO-OP',
  'DIRTY-REVERT',
];

// The verdicts that mean THE RUN IS NOT EVIDENCE — the mutation was never
// applied as intended, so nothing can be concluded from what the test did.
// RED-WRONG-REASON is pointedly not in this set: it is a finding about the
// mutation ("something else broke; discard it"), and the run around it is still
// trustworthy.
const NOT_EVIDENCE = new Set(['ANCHOR-MISS', 'AMBIGUOUS-ANCHOR', 'NO-OP', 'DIRTY-REVERT']);

const EVIDENCE_TEXT = {
  'RED-WRONG-REASON': 'failed, but not for the predicted reason — discard this mutation.',
  GREEN: 'no failure — the test is HOLLOW or the mutation is INERT. Decide and record which.',
  'ANCHOR-OK': 'anchor verified; no test was run (dry run).',
  'ANCHOR-MISS': 'find is not present in the file — the run is not evidence.',
  'AMBIGUOUS-ANCHOR': 'find occurs more than once — the run is not evidence.',
  'NO-OP': 'replace produced an identical file — the mutation cannot change behaviour.',
  'DIRTY-REVERT': 'the file did not revert cleanly — the run was aborted.',
};

// For a RED-AS-PREDICTED the useful line is the predicted reason that was
// matched, because that string is the whole difference between "it went red"
// and "it went red for the reason predicted".
function evidenceFor(result) {
  if (result.verdict === 'RED-AS-PREDICTED') return result.expectRed || '';
  return EVIDENCE_TEXT[result.verdict] || result.detail || '';
}

function seconds(durationMs) {
  return ((durationMs || 0) / 1000).toFixed(1);
}

function summarize(results) {
  const counts = {};
  for (const result of results) {
    counts[result.verdict] = (counts[result.verdict] || 0) + 1;
  }
  return {
    counts,
    isEvidence: !results.some((r) => NOT_EVIDENCE.has(r.verdict)),
  };
}

function summaryLine(results) {
  const { counts } = summarize(results);
  const parts = VERDICT_ORDER
    .filter((verdict) => counts[verdict])
    .map((verdict) => `${counts[verdict]} ${verdict}`);
  const noun = results.length === 1 ? 'mutation' : 'mutations';
  const breakdown = parts.length > 0 ? `: ${parts.join(', ')}` : '';
  const reverts = results.some((r) => r.verdict === 'DIRTY-REVERT')
    ? '  REVERT FAILED — the working tree was left modified.'
    : '  Reverts verified clean.';
  return `${results.length} ${noun}${breakdown}.${reverts}`;
}

function renderText(results) {
  const lines = [];
  for (const result of results) {
    const label = result.label || result.id;
    lines.push(`MUT ${result.id} [${label}] ${result.verdict} (${seconds(result.durationMs)}s)`);
    const evidence = evidenceFor(result);
    if (evidence) {
      // The bang marks the entries a reader must act on, so a long run's
      // GREENs and misses do not scroll past looking like the RED lines.
      const marker = result.verdict === 'RED-AS-PREDICTED' ? '     ' : '     !! ';
      lines.push(`${marker}${evidence}`);
    }
  }
  lines.push('');
  lines.push(summaryLine(results));
  return lines.join('\n');
}

// A cell must never break the table: a literal pipe would open a phantom
// column, and a newline would end the row early. Both arrive routinely, since
// expectRed is copied from real test output.
function cell(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\|/g, '\\|');
}

function renderMarkdown(results) {
  const rows = [
    '| id | label | verdict | evidence |',
    '|---|---|---|---|',
  ];
  for (const result of results) {
    rows.push(`| ${cell(result.id)} | ${cell(result.label || result.id)} | ${cell(result.verdict)} | ${cell(evidenceFor(result))} |`);
  }
  return rows.join('\n');
}

function renderJson(results) {
  const { counts, isEvidence } = summarize(results);
  return JSON.stringify({ counts, isEvidence, results }, null, 2);
}

module.exports = {
  renderText,
  renderMarkdown,
  renderJson,
  summarize,
  evidenceFor,
};
