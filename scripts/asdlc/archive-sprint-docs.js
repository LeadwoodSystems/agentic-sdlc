const fs = require('node:fs');
const path = require('node:path');

// Safe character allowlist for path segments (same pattern as new-sprint.js)
const SAFE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

// Guards against path-traversal: milestoneVersion is joined directly into a
// filesystem path, so it must not contain path separators or ".." segments.
function assertSafePathSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${label} "${value}": must match ${SAFE_ID_PATTERN} and must not contain ".."`);
  }
}

function archiveOneDir(cwd, dir, milestoneVersion) {
  if (!fs.existsSync(dir)) return [];
  const archiveDir = path.join(dir, 'archive', milestoneVersion);
  const moved = [];

  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${milestoneVersion}-`));

  if (files.length > 0) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  for (const entry of files) {
    const from = path.join(dir, entry.name);
    const to = path.join(archiveDir, entry.name);
    fs.renameSync(from, to);
    // Convert to relative path before pushing to moved array
    moved.push(path.relative(cwd, to));
  }
  return moved;
}

function archiveMilestone(cwd, milestoneVersion) {
  // Validate milestoneVersion before any fs operations
  assertSafePathSegment(milestoneVersion, 'milestoneVersion');

  const handoffsMoved = archiveOneDir(cwd, path.join(cwd, 'docs/handoffs'), milestoneVersion);
  const plansMoved = archiveOneDir(cwd, path.join(cwd, 'docs/superpowers/plans'), milestoneVersion);
  return { moved: [...handoffsMoved, ...plansMoved] };
}

function main() {
  const [milestoneVersion] = process.argv.slice(2);
  if (!milestoneVersion) {
    console.error('Usage: node archive-sprint-docs.js <milestone-version>');
    process.exit(1);
  }
  const { moved } = archiveMilestone(process.cwd(), milestoneVersion);
  console.log(`Archived ${moved.length} file(s) under milestone ${milestoneVersion}.`);
  moved.forEach((p) => console.log(`  ${p}`));
}

module.exports = { archiveMilestone };

if (require.main === module) {
  main();
}
