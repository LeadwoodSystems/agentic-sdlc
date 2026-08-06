// Read/write the machine-readable Execution Profile block embedded in a GitHub
// issue body (and, later, in plan/handoff documents).
//
// The markers are deliberately UNVERSIONED. The schema version lives inside the
// payload (`schema: "execution-profile/v1"`). Versioning the marker itself would
// mean a v2 writer stops matching a v1 span and appends a duplicate — the exact
// failure the markers exist to prevent.
//
// The payload is JSON, not YAML: Node core has no YAML parser, this package has
// no dependencies, and the PowerShell ports GAW runs have no ConvertFrom-Yaml
// either. JSON.parse / ConvertFrom-Json are built into both.
//
// MIGRATED IN v0.2-s7: the WRITE path now delegates its splice to
// lib/marker-block.js, which ends the last of the three hand-rolled marker
// implementations. What did NOT move, and why:
//
//   - `assertSafePayload` guards the CALLER'S INPUTS — the serialized profile
//     and the assessment prose — before anything is rendered. upsertBlock never
//     sees those values. The v0.2-s6 note in marker-block.js read this as "that
//     module guards fences and this one can't", which conflated an input guard
//     with a span mechanic and made the migration look bigger than it was.
//   - `parseProfile` stays here because it is fence-aware: it must dig a ```json
//     payload out of the span, where marker-block returns the span's raw inner
//     text. It delegates span LOCATION to findBlock and keeps the extraction.
//
// The rendered body legitimately contains ``` fences but never marker text, so
// upsertBlock's assertNoMarkerText passes on it unchanged.

const {
  makeMarkers,
  detectEol,
  findBlock,
  upsertBlock,
} = require('./marker-block');

const MARKERS = makeMarkers('asdlc:execution-profile');
const MARKER_START = MARKERS.start;
const MARKER_END = MARKERS.end;
const SECTION_HEADING = '## ASDLC Execution Profile';
const FENCE = '```';

const FENCE_PATTERN = /```json\r?\n([\s\S]*?)\r?\n```/;

function parseProfile(body) {
  const located = findBlock(body, MARKERS);

  if (!located.found) {
    return {
      found: false, profile: null, error: null, start: -1, end: -1,
    };
  }

  if (located.end === -1) {
    return {
      found: true,
      profile: null,
      error: 'Execution profile block is unterminated (no closing marker).',
      start: located.start,
      end: -1,
    };
  }

  const match = located.inner.match(FENCE_PATTERN);
  if (!match) {
    return {
      found: true,
      profile: null,
      error: 'Execution profile block contains no ```json fence.',
      start: located.start,
      end: located.end,
    };
  }

  try {
    return {
      found: true,
      profile: JSON.parse(match[1]),
      error: null,
      start: located.start,
      end: located.end,
    };
  } catch (err) {
    return {
      found: true,
      profile: null,
      error: `Execution profile block contains invalid JSON: ${err.message}`,
      start: located.start,
      end: located.end,
    };
  }
}

// A `reason` string carrying marker or fence text would corrupt the span on the
// next write. This runs on the INPUTS, before rendering — which is why it stays
// in this module rather than moving into marker-block.js with the splice.
function assertSafePayload(serialized, assessment) {
  const haystack = `${serialized}\n${assessment || ''}`;
  if (haystack.includes(MARKER_START) || haystack.includes(MARKER_END)) {
    throw new Error(
      'Execution profile must not contain the asdlc:execution-profile marker text — this would corrupt the block on a future update.',
    );
  }
  // Checked against the assessment too, not just the payload: the prose is
  // emitted above the JSON fence inside the same marker span, so a fence there
  // makes parseProfile match the prose's block instead of the profile's and
  // return a decoy object with no error raised.
  if (haystack.includes(FENCE)) {
    throw new Error(
      'Execution profile and its assessment must not contain a ``` code fence — this would terminate the JSON fence early, or shadow it with an earlier one.',
    );
  }
}

// The span's INNER content — no markers, '\n' separators. upsertBlock adds the
// markers and re-joins with the document's own line ending, so emitting either
// here would double the work and trip assertNoMarkerText.
function renderInner(profile, { assessment } = {}) {
  const serialized = JSON.stringify(profile, null, 2);
  assertSafePayload(serialized, assessment);

  const lines = [SECTION_HEADING, ''];
  if (assessment) {
    lines.push(assessment, '');
  }
  lines.push('```json', serialized, '```');

  return lines.join('\n');
}

// Replaces an existing block in place, or appends a new section when absent.
// Everything outside the marker span is preserved byte-for-byte.
function upsertProfile(body, profile, options = {}) {
  return upsertBlock(body, MARKERS, renderInner(profile, options));
}

module.exports = {
  MARKER_START,
  MARKER_END,
  SECTION_HEADING,
  detectEol,
  parseProfile,
  upsertProfile,
};
