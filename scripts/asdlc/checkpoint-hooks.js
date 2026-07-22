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

  // Sanitize summary: replace newlines with spaces to maintain one-line-per-entry invariant
  const sanitizedSummary = summary.replace(/\n/g, ' ');

  const line = `- ${date} **${sprintId}** — ${sanitizedSummary} — [handoff](${handoffRelPath}) — status: awaiting-merge\n`;
  fs.appendFileSync(statusPath, line);
}

module.exports = { appendStatusEntry };
