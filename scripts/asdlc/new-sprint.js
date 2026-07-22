const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./lib/exec');

function slugFromFilename(filename) {
  // vX.Y-sN-<slug>.md -> <slug>
  return filename.replace(/\.md$/, '').replace(/^v[\d.]+-s\d+-/, '');
}

function checkGate(cwd, { runner = run } = {}) {
  const plansDir = path.join(cwd, 'docs/superpowers/plans');
  const handoffsDir = path.join(cwd, 'docs/handoffs');

  if (fs.existsSync(plansDir)) {
    const plans = fs.readdirSync(plansDir)
      .filter((f) => f.endsWith('.md') && f !== '_TEMPLATE.md')
      .sort();
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

  const branches = runner('git', ['branch', '--list', 'sprint/*'], { cwd })
    .split('\n')
    .map((l) => l.replace(/^\*?\s*/, '').trim())
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
