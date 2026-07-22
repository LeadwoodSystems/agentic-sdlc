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

  const line = `- ${date} **${sanitizedSprintId}** — ${sanitizedSummary} — [handoff](${sanitizedHandoffRelPath}) — status: awaiting-merge\n`;
  fs.appendFileSync(statusPath, line);
}

module.exports = { appendStatusEntry };
