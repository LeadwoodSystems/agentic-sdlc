const test = require('node:test');
const assert = require('node:assert/strict');
const { applyMutation } = require('../../lib/apply-mutation');

// The fixture that would have caught two of the three bug classes gaw v0.13-s8
// hit: CRLF line endings AND an em-dash. The em-dash is the exact character the
// PowerShell `Get-Content -Raw` / `Set-Content` round-trip destroyed there.
const SRC_CRLF = [
  'def emit(spec):',
  '    # 1. Build the payload — shape only.',
  '    payload = build(spec)',
  '    # 2. The customer-facing send.',
  '    return send(payload)',
  '',
].join('\r\n');

test('an anchor authored with LF matches a CRLF source', () => {
  // The silent-skip bug: a model authors `find` into JSON with '\n', the file
  // on disk is CRLF, and the anchor is reported missing for 3 of 8 mutations.
  const { verdict, result } = applyMutation(
    SRC_CRLF,
    '    # 2. The customer-facing send.\n    return send(payload)',
    '    return send(payload)\n    # 2. The customer-facing send.',
  );
  assert.equal(verdict, 'APPLIED', 'the silent-skip bug: an LF-authored anchor did not match a CRLF source');
  assert.ok(result.includes('    return send(payload)\r\n    # 2.'));
});

test("the replacement is re-emitted in the source's own line ending", () => {
  const { result } = applyMutation(
    SRC_CRLF,
    '    payload = build(spec)',
    '    payload = None\n    x = 1',
  );
  assert.ok(result.includes('    payload = None\r\n    x = 1'));
  assert.ok(!/[^\r]\n/.test(result), 'no bare LF may survive in a CRLF file');
});

test('non-ASCII outside the match survives byte-for-byte', () => {
  const { result } = applyMutation(SRC_CRLF, '    return send(payload)', '    return None');
  assert.ok(result.includes('# 1. Build the payload — shape only.'));
});

test('a mixed-ending source keeps its lone LF untouched', () => {
  // Regression guard for the approach the design spec REJECTED: normalizing the
  // whole source and re-emitting in the dominant ending would promote this lone
  // \n to \r\n, changing bytes outside the mutation and guaranteeing a
  // DIRTY-REVERT the author would blame on themselves.
  const mixed = 'a\r\nb\nc\r\nTARGET\r\n';
  const { result } = applyMutation(mixed, 'TARGET', 'REPLACED');
  assert.equal(result, 'a\r\nb\nc\r\nREPLACED\r\n');
});

test('an absent anchor is ANCHOR-MISS with no result', () => {
  const { verdict, result } = applyMutation(SRC_CRLF, 'nowhere in the file', 'x');
  assert.equal(verdict, 'ANCHOR-MISS');
  assert.equal(result, null);
});

test('an anchor occurring twice is AMBIGUOUS-ANCHOR, never the first match', () => {
  const { verdict, result } = applyMutation('x = 1\r\ny = 2\r\nx = 1\r\n', 'x = 1', 'x = 2');
  assert.equal(verdict, 'AMBIGUOUS-ANCHOR');
  assert.equal(result, null);
});

test('overlapping occurrences also count as ambiguous', () => {
  assert.equal(applyMutation('aaa', 'aa', 'bb').verdict, 'AMBIGUOUS-ANCHOR');
});

test('a replace identical to find is NO-OP', () => {
  const { verdict, result } = applyMutation(
    SRC_CRLF,
    '    payload = build(spec)',
    '    payload = build(spec)',
  );
  assert.equal(verdict, 'NO-OP');
  assert.equal(result, null);
});

test('an LF source stays LF', () => {
  const { result } = applyMutation('a\nTARGET\nb\n', 'TARGET', 'ONE\nTWO');
  assert.equal(result, 'a\nONE\nTWO\nb\n');
});
