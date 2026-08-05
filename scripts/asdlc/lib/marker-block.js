// Find a `<!-- asdlc:<name> -->` … `<!-- /asdlc:<name> -->` span in a document
// and rewrite it in place — replace when present, append when absent — without
// disturbing a single byte outside the span.
//
// WHY THIS EXISTS: three independent implementations of the same idea had grown
// up in this package (`checkpoint-hooks.js:34-60`, `lib/profile-block.js`, and
// the facts block in `facts.js`). The piece that must never be re-derived by a
// fourth is `assertNoMarkerText` — a payload that happens to contain the marker
// text corrupts the span on the NEXT update, when `indexOf` finds the injected
// copy instead of the real boundary. That is a silent, delayed corruption, so it
// is the one rule a hand-rolled reimplementation is most likely to miss and
// least likely to notice missing.
//
// DELIBERATELY NOT MIGRATED: `profile-block.js` and `checkpoint-hooks.js` still
// carry their own copies. They shipped last week with behaviour this module does
// not reproduce — profile-block additionally guards ``` fences (its span holds a
// JSON fence, this one holds plain markdown) and checkpoint-hooks writes only
// between the markers while keeping whatever the file already had around them.
// Moving them here is a separate, riskier change that was explicitly left out of
// this sprint's scope. `facts.js` is the only consumer. Please do not "finish
// the job" unbidden — the migration needs its own tests, not a drive-by.

// Both marker conventions already in the tree (`asdlc:current-state:auto`,
// `asdlc:execution-profile`) are the same shape, so the name is the only input.
// The markers stay UNVERSIONED on purpose: a v2 writer that stopped matching a
// v1 span would append a duplicate — the exact failure markers exist to prevent.
function makeMarkers(name) {
  return { start: `<!-- ${name} -->`, end: `<!-- /${name} -->` };
}

// Files in this repo are CRLF on disk (`core.autocrlf` is on), and GitHub hands
// back issue bodies as CRLF. Emitting LF into either would turn every re-run
// into a whole-file diff, so the writer matches what it finds rather than
// imposing a house style.
function detectEol(content) {
  const crlf = (content.match(/\r\n/g) || []).length;
  const lf = (content.match(/\n/g) || []).length;
  return crlf * 2 > lf ? '\r\n' : '\n';
}

// Locates the span. `start` is the index of the opening marker; `end` is the
// index just PAST the closing marker, so `content.slice(0, start) + block +
// content.slice(end)` is the whole replacement.
function findBlock(content, markers) {
  const start = content.indexOf(markers.start);
  if (start === -1) {
    return { found: false, start: -1, end: -1, inner: null, error: null };
  }

  const endMarkerIdx = content.indexOf(markers.end, start);
  if (endMarkerIdx === -1) {
    // Reported rather than thrown: a reader (a lint, a report) wants to say
    // "your block is broken" without crashing. Only the WRITER refuses.
    return {
      found: true,
      start,
      end: -1,
      inner: null,
      error: `Block ${markers.start} is unterminated (no closing ${markers.end}).`,
    };
  }

  return {
    found: true,
    start,
    end: endMarkerIdx + markers.end.length,
    inner: content.slice(start + markers.start.length, endMarkerIdx),
    error: null,
  };
}

// The guard. See the header comment for why this is the load-bearing part.
function assertNoMarkerText(body, markers) {
  if (body.includes(markers.start) || body.includes(markers.end)) {
    // The name is dug back out of the marker so the message names the specific
    // marker the caller collided with, not a generic "the marker".
    const name = markers.start.replace(/^<!--\s*/, '').replace(/\s*-->$/, '');
    throw new Error(
      `Block content must not contain the ${name} marker text — this would corrupt the block on a future update.`,
    );
  }
}

// Replaces an existing block in place, or appends one when absent. Everything
// outside the span is preserved byte-for-byte.
//
// `body` is the span's inner content WITHOUT the markers, with '\n' separators;
// it is re-joined with the document's own line ending.
function upsertBlock(content, markers, body, { eol = detectEol(content) } = {}) {
  assertNoMarkerText(body, markers);

  const normalizedBody = String(body).replace(/\r\n/g, '\n').replace(/\n/g, eol);
  const block = normalizedBody === ''
    ? `${markers.start}${eol}${markers.end}`
    : `${markers.start}${eol}${normalizedBody}${eol}${markers.end}`;

  const existing = findBlock(content, markers);
  if (existing.found) {
    if (existing.end === -1) {
      // A writer cannot recover from this: with no closing marker there is no
      // way to know how much of the file the author meant to be inside the
      // span, and guessing would silently delete unrelated content.
      throw new Error(
        `${existing.error} Refusing to guess where it ends — fix the file by hand.`,
      );
    }
    return content.slice(0, existing.start) + block + content.slice(existing.end);
  }

  const trimmed = content.replace(/\s+$/, '');
  const separator = trimmed.length > 0 ? eol + eol : '';
  return `${trimmed}${separator}${block}${eol}`;
}

module.exports = {
  makeMarkers,
  detectEol,
  findBlock,
  assertNoMarkerText,
  upsertBlock,
};
