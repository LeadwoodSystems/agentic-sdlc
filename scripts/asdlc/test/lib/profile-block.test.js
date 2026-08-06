const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MARKER_START,
  MARKER_END,
  parseProfile,
  upsertProfile,
  detectEol,
} = require('../../lib/profile-block');
const markerBlock = require('../../lib/marker-block');

const PROFILE = {
  schema: 'execution-profile/v1',
  stage: 'estimated',
  source_issues: [197],
  sprint_id: null,
  complexity: 'low',
  risk: 'low',
  architecture_impact: 'low',
  expected_duration: '<30min',
  blast_radius: ['scripts/asdlc/'],
  phases: {
    planning: { class: 'standard', reason: 'Well-scoped, single file.' },
    implementation: { class: 'fast', reason: 'Documentation-only change.' },
    verification: { class: 'deterministic', runner: 'ci', tasks: ['lint'] },
    review: { class: 'fast', reason: 'No behavior change.' },
  },
  escalation: ['implementation fails twice'],
};

// A body shaped like GAW's house template, so the fixtures exercise the real
// case: an appended section landing after a trailing "## Acceptance".
const BODY_LF = [
  '## Vision',
  'Make the thing observable.',
  '',
  '## Acceptance',
  '- [ ] it works',
  '',
].join('\n');

const BODY_CRLF = BODY_LF.replace(/\n/g, '\r\n');

function blockFor(profile, eol = '\n') {
  return [
    MARKER_START,
    '## ASDLC Execution Profile',
    '',
    '```json',
    JSON.stringify(profile, null, 2).replace(/\n/g, eol),
    '```',
    MARKER_END,
  ].join(eol);
}

test('parseProfile reports not-found on a body with no block', () => {
  const result = parseProfile(BODY_LF);
  assert.equal(result.found, false);
  assert.equal(result.profile, null);
});

test('parseProfile extracts the payload from an LF body', () => {
  const body = `${BODY_LF}\n${blockFor(PROFILE)}\n`;
  const result = parseProfile(body);
  assert.equal(result.found, true);
  assert.deepEqual(result.profile, PROFILE);
});

test('parseProfile extracts the payload from a CRLF body (GitHub API shape)', () => {
  const body = `${BODY_CRLF}\r\n${blockFor(PROFILE, '\r\n')}\r\n`;
  const result = parseProfile(body);
  assert.equal(result.found, true);
  assert.deepEqual(result.profile, PROFILE);
});

test('parseProfile reports found-but-unparseable rather than throwing on bad JSON', () => {
  const body = [
    BODY_LF,
    MARKER_START,
    '```json',
    '{ this is not json',
    '```',
    MARKER_END,
    '',
  ].join('\n');
  const result = parseProfile(body);
  assert.equal(result.found, true);
  assert.equal(result.profile, null);
  assert.match(result.error, /JSON/i);
});

test('upsertProfile appends a section when none exists, preserving the original body', () => {
  const result = upsertProfile(BODY_LF, PROFILE);
  assert.ok(result.startsWith(BODY_LF.trimEnd()), 'original body must be preserved as a prefix');
  assert.ok(result.includes(MARKER_START));
  assert.ok(result.includes('## ASDLC Execution Profile'));
  assert.deepEqual(parseProfile(result).profile, PROFILE);
});

test('upsertProfile replaces the existing block and leaves surrounding text byte-identical', () => {
  const before = '# Heading\n\nsome discussion\n\n';
  const after = '\n\n## A later section\n\nmore discussion\n';
  const body = `${before}${blockFor({ ...PROFILE, complexity: 'high' })}${after}`;

  const result = upsertProfile(body, PROFILE);

  assert.ok(result.startsWith(before), 'text before the block must be untouched');
  assert.ok(result.endsWith(after), 'text after the block must be untouched');
  assert.equal(result.split(MARKER_START).length - 1, 1, 'exactly one block');
  assert.equal(parseProfile(result).profile.complexity, 'low');
});

test('upsertProfile is idempotent — a second run is a no-op', () => {
  const once = upsertProfile(BODY_LF, PROFILE);
  const twice = upsertProfile(once, PROFILE);
  assert.equal(twice, once);
});

test('upsertProfile preserves a CRLF body\'s line endings', () => {
  const result = upsertProfile(BODY_CRLF, PROFILE);
  assert.ok(!/[^\r]\n/.test(result), 'result must not contain a bare LF');
  assert.deepEqual(parseProfile(result).profile, PROFILE);
  // And re-running against the CRLF result must still be a no-op.
  assert.equal(upsertProfile(result, PROFILE), result);
});

test('upsertProfile rejects a payload containing marker text', () => {
  const hostile = { ...PROFILE, complexity: `low ${MARKER_END} injected` };
  assert.throws(() => upsertProfile(BODY_LF, hostile), /marker/i);
});

test('upsertProfile rejects a payload containing a code fence', () => {
  const hostile = { ...PROFILE, complexity: 'low ``` injected' };
  assert.throws(() => upsertProfile(BODY_LF, hostile), /fence/i);
});

// The assessment is long-form markdown written by an assessor, so it is far
// likelier to quote a fenced snippet than the payload is. Because the prose is
// emitted above the JSON fence inside the same marker span, an unguarded fence
// there makes parseProfile return the FIRST ```json block it finds — the decoy
// from the prose, not the profile. Silently: no throw, no parse error, and a
// dispatcher routes on fabricated data. Found while profiling GAW's v0.13
// backlog, where every assessment cites files and quotes config.
test('upsertProfile rejects an ASSESSMENT containing a code fence', () => {
  const fence = '`'.repeat(3);
  const hostile = [
    'The policy file shows:',
    `${fence}json`,
    '{"decoy": true}',
    fence,
    'So routing is settled.',
  ].join('\n');
  assert.throws(() => upsertProfile(BODY_LF, PROFILE, { assessment: hostile }), /fence/i);
});

test('upsertProfile allows inline backticks in an assessment', () => {
  // `file:line` citations are the house style — only the triple fence is unsafe.
  const assessment = 'Blast radius is one function (`gh-hygiene.js:45`), no ``adjacent`` coupling.';
  const result = upsertProfile(BODY_LF, PROFILE, { assessment });
  assert.deepEqual(parseProfile(result).profile, PROFILE);
});

// The three tests below pin the v0.2-s7 migration of the WRITE path onto
// lib/marker-block.js. The read path (parseProfile) stays here — it is
// fence-aware and marker-block is not — so its three error strings are
// unchanged. The write path's unterminated message deliberately CHANGES to
// marker-block's, which names the specific marker it collided with; nothing
// asserted on the old text, and "no closing marker" was ambiguous in a document
// that can hold more than one kind of span.
test('upsertProfile refuses an unterminated block with a message naming this marker', () => {
  const body = `${BODY_LF}\n${MARKER_START}\n## ASDLC Execution Profile\n`;
  assert.throws(() => upsertProfile(body, PROFILE), (err) => {
    assert.match(err.message, /asdlc:execution-profile/, 'must name the marker it collided with');
    assert.match(err.message, /Refusing to guess where it ends/);
    return true;
  });
});

test('profile-block re-exports marker-block\'s detectEol rather than duplicating it', () => {
  // Two byte-identical copies of a line-ending heuristic is exactly the drift
  // marker-block.js was created to end; identity is the only assertion that
  // catches a re-divergence.
  assert.equal(detectEol, markerBlock.detectEol);
});

test('upsertProfile writes a span marker-block can locate and round-trip', () => {
  // The seam itself: whatever profile-block writes, the shared reader must be
  // able to find. A hand-rolled splice that drifted from upsertBlock's shape
  // would still satisfy every other test in this file.
  const result = upsertProfile(BODY_LF, PROFILE);
  const markers = markerBlock.makeMarkers('asdlc:execution-profile');
  const located = markerBlock.findBlock(result, markers);

  assert.equal(located.found, true);
  assert.equal(located.error, null);
  assert.ok(located.inner.includes('## ASDLC Execution Profile'));

  // findBlock's `inner` carries the newlines adjacent to each marker, which
  // upsertBlock supplies itself — so the round-trip strips exactly one from
  // each end. Getting this wrong is what a drifted hand-rolled splice looks
  // like: an extra blank line inside the span on every write.
  const innerBody = located.inner.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  assert.equal(
    markerBlock.upsertBlock(result, markers, innerBody),
    result,
    'a marker-block round-trip of the written span must be a no-op',
  );
});

test('upsertProfile places assessment prose above the fence', () => {
  const result = upsertProfile(BODY_LF, PROFILE, {
    assessment: 'Touches one file; no hidden coupling found (`scripts/asdlc/gh-hygiene.js:45`).',
  });
  assert.ok(result.includes('no hidden coupling found'));
  assert.ok(
    result.indexOf('no hidden coupling found') < result.indexOf('```json'),
    'prose must appear above the JSON fence',
  );
  assert.deepEqual(parseProfile(result).profile, PROFILE);
});
