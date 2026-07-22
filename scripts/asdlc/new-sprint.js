const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./lib/exec');

function slugFromFilename(filename) {
  // vX.Y-sN-<slug>.md -> <slug>
  return filename.replace(/\.md$/, '').replace(/^v[\d.]+-s\d+-/, '');
}

const PLAN_VERSION_RE = /^v(\d+)\.(\d+)-s(\d+)-/;

// Numeric-aware comparator for plan filenames named vMAJOR.MINOR-sN-<slug>.md.
// Filenames that don't match the canonical pattern sort before all that do
// (treated as oldest) instead of throwing.
function compareByVersion(a, b) {
  const matchA = a.match(PLAN_VERSION_RE);
  const matchB = b.match(PLAN_VERSION_RE);

  if (!matchA && !matchB) return a.localeCompare(b);
  if (!matchA) return -1;
  if (!matchB) return 1;

  for (let i = 1; i <= 3; i += 1) {
    const numA = Number(matchA[i]);
    const numB = Number(matchB[i]);
    if (numA !== numB) return numA - numB;
  }
  return 0;
}

function checkGate(cwd, { runner = run } = {}) {
  const plansDir = path.join(cwd, 'docs/superpowers/plans');
  const handoffsDir = path.join(cwd, 'docs/handoffs');

  if (fs.existsSync(plansDir)) {
    const plans = fs.readdirSync(plansDir)
      .filter((f) => f.endsWith('.md') && f !== '_TEMPLATE.md')
      .sort(compareByVersion);
    if (plans.length > 0) {
      const newestPlan = plans[plans.length - 1];
      const slug = slugFromFilename(newestPlan);
      const handoffs = fs.existsSync(handoffsDir)
        ? fs.readdirSync(handoffsDir).filter((f) => f.endsWith('.md'))
        : [];
      const hasMatch = handoffs.some((f) => slugFromFilename(f) === slug);
      if (!hasMatch) {
        return { blocked: true, reason: 'unmatched-plan' };
      }
    }
  }

  const branches = runner(
    'git',
    ['for-each-ref', 'refs/heads/sprint/*', '--format=%(refname:short)'],
    { cwd },
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const branch of branches) {
    const unmerged = runner('git', ['log', `main..${branch}`, '--oneline'], { cwd });
    if (unmerged.length > 0) {
      return { blocked: true, reason: 'unmerged-branch' };
    }
  }

  return { blocked: false, reason: null };
}

module.exports = { checkGate };
