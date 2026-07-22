const fs = require('node:fs');
const path = require('node:path');

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

  if (!fs.existsSync(statusPath)) {
    fs.writeFileSync(statusPath, STATUS_HEADER);
  }

  // Sanitize all interpolated fields: replace CR/LF with spaces to maintain the
  // one-line-per-entry invariant (a bare \r, not just \r\n, also renders as a
  // line break in Markdown and must be stripped).
  const sanitizedSprintId = sprintId.replace(/[\r\n]/g, ' ');
  const sanitizedSummary = summary.replace(/[\r\n]/g, ' ');
  const sanitizedHandoffRelPath = handoffRelPath.replace(/[\r\n]/g, ' ');
  const sanitizedDate = date.replace(/[\r\n]/g, ' ');

  const line = `- ${sanitizedDate} **${sanitizedSprintId}** — ${sanitizedSummary} — [handoff](${sanitizedHandoffRelPath}) — status: awaiting-merge\n`;
  fs.appendFileSync(statusPath, line);
}

const START_MARKER = '<!-- asdlc:current-state:auto -->';
const END_MARKER = '<!-- /asdlc:current-state:auto -->';

function updateClaudeMdPointer(cwd, summaryLine) {
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  const content = fs.readFileSync(claudeMdPath, 'utf8');

  if (summaryLine.includes(START_MARKER) || summaryLine.includes(END_MARKER)) {
    throw new Error(
      'summaryLine must not contain the asdlc:current-state:auto marker text — this would corrupt the marker span on a future update.'
    );
  }

  const startIdx = content.indexOf(START_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `CLAUDE.md is missing the asdlc:current-state:auto marker pair — cannot safely update the pointer.`
    );
  }

  const before = content.slice(0, startIdx + START_MARKER.length);
  const after = content.slice(endIdx);
  const rewritten = `${before}\n**Current state:** ${summaryLine}\n${after}`;

  fs.writeFileSync(claudeMdPath, rewritten);
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
