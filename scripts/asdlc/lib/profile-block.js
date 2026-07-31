// Read/write the machine-readable Execution Profile block embedded in a GitHub
// issue body (and, later, in plan/handoff documents).
//
// The markers are deliberately UNVERSIONED. The schema version lives inside the
// payload (`schema: "execution-profile/v1"`). Versioning the marker itself would
// mean a v2 writer stops matching a v1 span and appends a duplicate — the exact
// failure the markers exist to prevent. This mirrors the existing
// `<!-- asdlc:current-state:auto -->` precedent in checkpoint-hooks.js.
//
// The payload is JSON, not YAML: Node core has no YAML parser, this package has
// no dependencies, and the PowerShell ports GAW runs have no ConvertFrom-Yaml
// either. JSON.parse / ConvertFrom-Json are built into both.

const MARKER_START = '<!-- asdlc:execution-profile -->';
const MARKER_END = '<!-- /asdlc:execution-profile -->';
const SECTION_HEADING = '## ASDLC Execution Profile';
const FENCE = '```';

// The whole section (heading, prose, fence) lives INSIDE the marker span, so an
// upsert replaces it atomically and everything outside stays byte-identical.
const FENCE_PATTERN = /```json\r?\n([\s\S]*?)\r?\n```/;

// GitHub returns issue bodies with CRLF. Emitting LF into a CRLF body would
// make every re-run a whole-body diff, so the writer matches what it finds.
function detectEol(body) {
  const crlf = (body.match(/\r\n/g) || []).length;
  const lf = (body.match(/\n/g) || []).length;
  return crlf * 2 > lf ? '\r\n' : '\n';
}

function parseProfile(body) {
  const startIdx = body.indexOf(MARKER_START);
  if (startIdx === -1) {
    return { found: false, profile: null, error: null, start: -1, end: -1 };
  }

  const endMarkerIdx = body.indexOf(MARKER_END, startIdx);
  if (endMarkerIdx === -1) {
    return {
      found: true,
      profile: null,
      error: 'Execution profile block is unterminated (no closing marker).',
      start: startIdx,
      end: -1,
    };
  }

  const end = endMarkerIdx + MARKER_END.length;
  const inner = body.slice(startIdx + MARKER_START.length, endMarkerIdx);
  const match = inner.match(FENCE_PATTERN);
  if (!match) {
    return {
      found: true,
      profile: null,
      error: 'Execution profile block contains no ```json fence.',
      start: startIdx,
      end,
    };
  }

  try {
    return {
      found: true,
      profile: JSON.parse(match[1]),
      error: null,
      start: startIdx,
      end,
    };
  } catch (err) {
    return {
      found: true,
      profile: null,
      error: `Execution profile block contains invalid JSON: ${err.message}`,
      start: startIdx,
      end,
    };
  }
}

// A `reason` string carrying marker or fence text would corrupt the span on the
// next write — the same class of guard as checkpoint-hooks.js:41-46.
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

function renderBlock(profile, { assessment } = {}, eol = '\n') {
  const serialized = JSON.stringify(profile, null, 2);
  assertSafePayload(serialized, assessment);

  const lines = [MARKER_START, SECTION_HEADING, ''];
  if (assessment) {
    lines.push(assessment, '');
  }
  lines.push('```json', serialized.replace(/\r?\n/g, eol), '```', MARKER_END);

  return lines.join(eol);
}

// Replaces an existing block in place, or appends a new section when absent.
// Everything outside the marker span is preserved byte-for-byte.
function upsertProfile(body, profile, options = {}) {
  const eol = detectEol(body);
  const block = renderBlock(profile, options, eol);
  const existing = parseProfile(body);

  if (existing.found) {
    if (existing.end === -1) {
      throw new Error(
        'Execution profile block is unterminated (no closing marker) — refusing to guess where it ends.',
      );
    }
    return body.slice(0, existing.start) + block + body.slice(existing.end);
  }

  const trimmed = body.replace(/\s+$/, '');
  const separator = trimmed.length > 0 ? eol + eol : '';
  return `${trimmed}${separator}${block}${eol}`;
}

module.exports = {
  MARKER_START,
  MARKER_END,
  SECTION_HEADING,
  detectEol,
  parseProfile,
  upsertProfile,
};
