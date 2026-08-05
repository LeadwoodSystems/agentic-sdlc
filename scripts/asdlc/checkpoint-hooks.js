const fs = require('node:fs');
const path = require('node:path');
const { makeMarkers, detectEol, findBlock, upsertBlock } = require('./lib/marker-block');

const STATUS_HEADER = [
  '# STATUS',
  '',
  'Append-only running history, oldest to newest. Never hand-edit — corrections',
  'happen by re-running `scripts/asdlc/checkpoint-hooks.js` / `finish-sprint.js`,',
  'not by typing into this file.',
  '',
  '',
].join('\n');

function appendStatusEntry(cwd, { sprintId, date, summary, handoffRelPath }) {
  const statusPath = path.join(cwd, 'docs/STATUS.md');
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });

  // An EXISTING file's own ending is authoritative — appending LF to a CRLF
  // document is what produced the mixed endings this replaces. A file created
  // here has nothing to detect, so it gets LF and autocrlf normalises it.
  const existing = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf8') : null;
  const eol = existing === null ? '\n' : detectEol(existing);
  if (existing === null) {
    fs.writeFileSync(statusPath, STATUS_HEADER.replace(/\n/g, eol));
  }

  // Sanitize all interpolated fields: replace CR/LF with spaces to maintain the
  // one-line-per-entry invariant (a bare \r, not just \r\n, also renders as a
  // line break in Markdown and must be stripped).
  const sanitizedSprintId = sprintId.replace(/[\r\n]/g, ' ');
  const sanitizedSummary = summary.replace(/[\r\n]/g, ' ');
  const sanitizedHandoffRelPath = handoffRelPath.replace(/[\r\n]/g, ' ');
  const sanitizedDate = date.replace(/[\r\n]/g, ' ');

  const line = `- ${sanitizedDate} **${sanitizedSprintId}** — ${sanitizedSummary} — [handoff](${sanitizedHandoffRelPath}) — status: awaiting-merge${eol}`;
  fs.appendFileSync(statusPath, line);
}

const CURRENT_STATE_MARKERS = makeMarkers('asdlc:current-state:auto');

function updateClaudeMdPointer(cwd, summaryLine) {
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  const content = fs.readFileSync(claudeMdPath, 'utf8');

  // upsertBlock APPENDS an absent span. That is right for the facts block, which
  // may legitimately be created at the end of a file, and wrong here: the
  // current-state pointer's POSITION in CLAUDE.md is part of its meaning, and
  // silently re-homing it to the bottom is worse than refusing. So absence is
  // checked here rather than delegated.
  if (!findBlock(content, CURRENT_STATE_MARKERS).found) {
    throw new Error(
      `CLAUDE.md is missing the ${CURRENT_STATE_MARKERS.start} marker — cannot safely update the pointer.`,
    );
  }

  // The injection guard is assertNoMarkerText, inside upsertBlock — a payload
  // containing the marker text throws before anything is written, so the file
  // is not corrupted on this run or the next. The hand-rolled copy that used to
  // live here is gone; this is the whole reason marker-block.js exists.
  fs.writeFileSync(
    claudeMdPath,
    upsertBlock(content, CURRENT_STATE_MARKERS, `**Current state:** ${summaryLine}`),
  );
}

function main() {
  const [sprintId, date, handoffRelPath, ...summaryParts] = process.argv.slice(2);
  if (!sprintId || !date || !handoffRelPath || summaryParts.length === 0) {
    console.error('Usage: node checkpoint-hooks.js <sprint-id> <date> <handoff-rel-path> <summary...>');
    process.exit(1);
  }
  const summary = summaryParts.join(' ');
  const cwd = process.cwd();

  appendStatusEntry(cwd, { sprintId, date, summary, handoffRelPath });
  console.log(`Appended STATUS.md entry for ${sprintId}.`);

  try {
    updateClaudeMdPointer(cwd, `${summary} — see [handoff](${handoffRelPath})`);
    console.log('Updated CLAUDE.md current-state pointer.');
  } catch (err) {
    console.warn(`Skipped CLAUDE.md pointer update: ${err.message}`);
  }
}

module.exports = { appendStatusEntry, updateClaudeMdPointer };

if (require.main === module) {
  main();
}
