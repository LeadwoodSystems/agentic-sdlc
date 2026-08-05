const test = require('node:test');
const assert = require('node:assert/strict');
const {
  makeMarkers,
  detectEol,
  findBlock,
  upsertBlock,
} = require('../../lib/marker-block');

const MARKERS = makeMarkers('asdlc:facts:auto');

// A document shaped like a CLAUDE.md: content before AND after the span, so the
// fixtures exercise the case that actually matters — an in-place rewrite that
// must not disturb either side.
const DOC_LF = [
  '# Project',
  '',
  'Some preamble with special chars: !@#$%^&*()',
  '',
  '## Later section',
  '- keep me',
  '',
].join('\n');

const DOC_CRLF = DOC_LF.replace(/\n/g, '\r\n');

function blockFor(body, eol = '\n') {
  return [MARKERS.start, body, MARKERS.end].join(eol);
}

test('makeMarkers builds an HTML-comment open/close pair from a name', () => {
  assert.deepEqual(makeMarkers('asdlc:facts:auto'), {
    start: '<!-- asdlc:facts:auto -->',
    end: '<!-- /asdlc:facts:auto -->',
  });
});

test('detectEol reports LF for an LF document and CRLF for a CRLF one', () => {
  assert.equal(detectEol(DOC_LF), '\n');
  assert.equal(detectEol(DOC_CRLF), '\r\n');
});

test('detectEol defaults to LF for a document with no line breaks at all', () => {
  assert.equal(detectEol('single line, no newline'), '\n');
});

test('findBlock reports not-found when the span is absent', () => {
  const result = findBlock(DOC_LF, MARKERS);
  assert.equal(result.found, false);
  assert.equal(result.inner, null);
});

test('findBlock returns the span bounds and its inner text', () => {
  const content = `${DOC_LF}${blockFor('- a: **1**')}\n`;
  const result = findBlock(content, MARKERS);
  assert.equal(result.found, true);
  assert.equal(content.slice(result.start, result.start + MARKERS.start.length), MARKERS.start);
  assert.equal(content.slice(result.end - MARKERS.end.length, result.end), MARKERS.end);
  assert.equal(result.inner.trim(), '- a: **1**');
});

test('findBlock reports an unterminated span rather than guessing where it ends', () => {
  const content = `${DOC_LF}${MARKERS.start}\n- a: **1**\n`;
  const result = findBlock(content, MARKERS);
  assert.equal(result.found, true);
  assert.equal(result.end, -1);
  assert.match(result.error, /unterminated/i);
});

test('upsertBlock appends a block when none exists, preserving the original document', () => {
  const result = upsertBlock(DOC_LF, MARKERS, '- a: **1**');
  assert.ok(result.startsWith(DOC_LF.replace(/\s+$/, '')), 'original document must be a prefix');
  assert.equal(findBlock(result, MARKERS).inner.trim(), '- a: **1**');
});

test('upsertBlock appends to an empty document without a leading blank line', () => {
  const result = upsertBlock('', MARKERS, '- a: **1**');
  assert.ok(result.startsWith(MARKERS.start), `unexpected leading text: ${JSON.stringify(result)}`);
});

test('upsertBlock replaces an existing block exactly once, leaving surrounding bytes identical', () => {
  const before = '# Heading\n\nsome discussion\n\n';
  const after = '\n\n## A later section\n\nmore discussion\n';
  const content = `${before}${blockFor('- a: **OLD**')}${after}`;

  const result = upsertBlock(content, MARKERS, '- a: **NEW**');

  assert.ok(result.startsWith(before), 'text before the block must be untouched');
  assert.ok(result.endsWith(after), 'text after the block must be untouched');
  assert.equal(result.split(MARKERS.start).length - 1, 1, 'exactly one start marker');
  assert.equal(result.split(MARKERS.end).length - 1, 1, 'exactly one end marker');
  assert.ok(result.includes('- a: **NEW**'));
  assert.ok(!result.includes('OLD'));
});

test('upsertBlock is idempotent — a second run is a byte-for-byte no-op', () => {
  const once = upsertBlock(DOC_LF, MARKERS, '- a: **1**');
  assert.equal(upsertBlock(once, MARKERS, '- a: **1**'), once);
});

test('upsertBlock preserves a CRLF document\'s line endings', () => {
  const result = upsertBlock(DOC_CRLF, MARKERS, '- a: **1**\n- b: **2**');
  assert.ok(!/[^\r]\n/.test(result), 'result must not contain a bare LF');
  assert.equal(upsertBlock(result, MARKERS, '- a: **1**\n- b: **2**'), result, 'and stays a no-op');
});

test('upsertBlock normalises a multi-line body to the document\'s line ending', () => {
  const result = upsertBlock(DOC_LF, MARKERS, '- a: **1**\r\n- b: **2**');
  assert.ok(!result.includes('\r'), 'CRLF in the body must not leak into an LF document');
});

test('upsertBlock rejects a body containing the start marker text', () => {
  assert.throws(
    () => upsertBlock(DOC_LF, MARKERS, `- a: **1** ${MARKERS.start} injected`),
    /must not contain the asdlc:facts:auto marker/i,
  );
});

test('upsertBlock rejects a body containing the end marker text', () => {
  assert.throws(
    () => upsertBlock(DOC_LF, MARKERS, `- a: **1** ${MARKERS.end} injected`),
    /must not contain the asdlc:facts:auto marker/i,
  );
});

test('upsertBlock does not modify its input when it rejects a body', () => {
  const content = `${DOC_LF}${blockFor('- a: **OLD**')}\n`;
  assert.throws(() => upsertBlock(content, MARKERS, `evil ${MARKERS.end}`), /marker/i);
  assert.ok(content.includes('- a: **OLD**'), 'input string is untouched (it is immutable, but assert the contract)');
});

test('upsertBlock refuses to rewrite an unterminated span', () => {
  const content = `${DOC_LF}${MARKERS.start}\n- a: **1**\n`;
  assert.throws(() => upsertBlock(content, MARKERS, '- a: **2**'), /unterminated/i);
});

test('upsertBlock renders an empty body as an empty span', () => {
  const result = upsertBlock(DOC_LF, MARKERS, '');
  assert.equal(findBlock(result, MARKERS).inner.trim(), '');
});
