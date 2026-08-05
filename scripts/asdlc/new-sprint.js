const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./lib/exec');
const { isBranchMerged } = require('./lib/branch-status');

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

// findStaleWorktrees is added to gh-hygiene.js by a sibling task of this same
// sprint. It is resolved lazily and defensively rather than destructured at
// module load so that this gate keeps loading — and keeps performing its branch
// and plan checks — against a gh-hygiene.js that predates the export. Losing
// the worktree check degrades the gate; a hard require failure would disable it
// entirely, which is the worse failure for something that is meant to block.
function resolveWorktreeFinder() {
  try {
    const { findStaleWorktrees } = require('./gh-hygiene');
    return typeof findStaleWorktrees === 'function' ? findStaleWorktrees : null;
  } catch {
    return null;
  }
}

// findStaleWorktrees' entries are shaped by that sibling task; tolerate a bare
// string as well as the expected object so a shape change there degrades this
// message rather than throwing inside the gate.
function describeWorktree(entry) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return String(entry);
  const label = [entry.branch, entry.path].filter(Boolean).join(' at ') || JSON.stringify(entry);
  const reasons = Array.isArray(entry.reasons)
    ? entry.reasons
    : [entry.reason].filter(Boolean);
  return reasons.length > 0 ? `${label} (${reasons.join(', ')})` : label;
}

function checkGate(cwd, {
  trunk = 'main',
  runner = run,
  findStaleWorktrees = resolveWorktreeFinder(),
} = {}) {
  // Check order is deliberate and was wrong before. The worktree and branch
  // checks are MEASURED facts about repo state — a resource the new sprint
  // would collide with. The plan/handoff check is a filename *convention*
  // check about tidiness. Running the convention check first let a stale
  // convention hide a stale resource: measured on this repo, a legacy plan
  // filename predating the vMAJOR.MINOR-sN-<slug>.md scheme returned
  // `unmatched-plan` and the branch check never ran at all. Correctness first,
  // tidiness last.

  if (findStaleWorktrees) {
    // A branch can be checked out in exactly one worktree at a time, so a
    // leftover worktree still holding a sprint branch will fight the new sprint
    // over HEAD — the same class of resource conflict the branch check covers.
    const stale = findStaleWorktrees(cwd, { trunk, runner });
    if (Array.isArray(stale) && stale.length > 0) {
      return {
        blocked: true,
        reason: 'stale-worktree',
        detail: stale.map(describeWorktree).join('; '),
      };
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
    // Was `git log <trunk>..<branch>` being non-empty. That test is blind to a
    // squash-merge — the branch's own commits are never on trunk afterwards —
    // so it blocked forever on branches that were in fact merged. See
    // lib/branch-status.js for why `git cherry` is not the fix either.
    if (!isBranchMerged(cwd, branch, { trunk, runner })) {
      return {
        blocked: true,
        reason: 'unmerged-branch',
        detail: `${branch} has work not in ${trunk}`,
      };
    }
  }

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
        // Report the slug as well as the filename: when the plan predates the
        // naming convention the two differ, and the slug is the only thing that
        // explains why an apparently-present handoff didn't match.
        return {
          blocked: true,
          reason: 'unmatched-plan',
          detail: `docs/superpowers/plans/${newestPlan} has no handoff in docs/handoffs matching slug "${slug}"`,
        };
      }
    }
  }

  return { blocked: false, reason: null };
}

const SAFE_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

// Guards against path-traversal: sprintId/slug are joined directly into a
// filesystem path, so they must not contain path separators or ".." segments.
function assertSafePathSegment(value, label) {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${label} "${value}": must match ${SAFE_ID_PATTERN} and must not contain ".."`);
  }
}

// Resolved from THIS script, not from cwd. When the plugin's own scripts/asdlc
// runs against a consumer repo, the plugin's skills/ sits two levels up and
// carries the canonical template. A repo bootstrapped by /bootstrap-asdlc has
// copied these scripts into its own tree, where that path does not resolve —
// and does not need to, because bootstrap also writes plans/_TEMPLATE.md, which
// is checked first. So this repo needs no copy of its own template, and a
// consumer's behaviour is unchanged.
const REFERENCE_TEMPLATE_PATH = path.join(
  __dirname, '..', '..', 'skills', 'agentic-sdlc', 'references', 'plan-template.md',
);

function createSprint(cwd, sprintId, slug, {
  runner = run,
  referenceTemplatePath = REFERENCE_TEMPLATE_PATH,
} = {}) {
  assertSafePathSegment(sprintId, 'sprintId');
  assertSafePathSegment(slug, 'slug');

  runner('git', ['checkout', '-b', `sprint/${sprintId}`], { cwd });

  const plansDir = path.join(cwd, 'docs/superpowers/plans');
  fs.mkdirSync(plansDir, { recursive: true });

  // First existing wins: the project's own template, then the plugin's, then a
  // stub. The stub stays as the last rung so a repo with neither still gets a
  // file rather than a crash.
  const templatePath = [path.join(plansDir, '_TEMPLATE.md'), referenceTemplatePath]
    .find((candidate) => candidate && fs.existsSync(candidate));
  const relPlanPath = path.join('docs/superpowers/plans', `${sprintId}-${slug}.md`);
  const absPlanPath = path.join(cwd, relPlanPath);

  let content;
  if (templatePath) {
    const substituted = `${sprintId} — ${slug}`;
    content = fs.readFileSync(templatePath, 'utf8')
      .replace(/<Sprint id> — <Name>/g, substituted);
    // Check that the substitution actually took effect, rather than merely
    // checking that the placeholder is gone: a template with zero occurrences
    // of "<Sprint id> — <Name>" would pass a "placeholder absent" check
    // without ever having sprintId/slug substituted in, silently writing a
    // broken plan file. Requiring the substituted string to be present
    // catches both that case and the "placeholder survives mismatched" case.
    if (!content.includes(substituted)) {
      throw new Error(
        `Template at ${templatePath} does not contain the expected "<Sprint id> — <Name>" placeholder — update the template or new-sprint.js's substitution pattern.`,
      );
    }
  } else {
    content = `# ${sprintId} — ${slug} · Plan\n\n## Context (why)\n<fill in>\n`;
  }
  fs.writeFileSync(absPlanPath, content);

  return { branch: `sprint/${sprintId}`, planPath: relPlanPath };
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');

  // --trunk <name>: the branch new sprint branches are compared against for
  // the unmerged-branch gate check. Defaults to 'main' for repos that use the
  // conventional trunk name; pass --trunk <name> for repos (e.g. one whose
  // trunk is `build/v0.1`) where that default doesn't hold.
  let trunk = 'main';
  const trunkIdx = args.indexOf('--trunk');
  if (trunkIdx !== -1) {
    trunk = args[trunkIdx + 1];
    if (!trunk) {
      console.error('Usage: node new-sprint.js <sprint-id> <slug> [--force] [--trunk <name>]');
      process.exit(1);
    }
  }

  const trunkValueIdx = trunkIdx === -1 ? -1 : trunkIdx + 1;
  const positional = args.filter((a, i) => a !== '--force' && a !== '--trunk' && i !== trunkValueIdx);
  const [sprintId, slug] = positional;

  if (!sprintId || !slug) {
    console.error('Usage: node new-sprint.js <sprint-id> <slug> [--force] [--trunk <name>]');
    process.exit(1);
  }

  const cwd = process.cwd();
  const gate = checkGate(cwd, { trunk });
  // `detail` is present only on the blocked path — the not-blocked shape is
  // exactly { blocked, reason } and callers assert on it — so render it
  // conditionally rather than always appending an "undefined".
  const detail = gate.detail ? ` — ${gate.detail}` : '';
  if (gate.blocked && !force) {
    console.error(`Blocked: ${gate.reason}${detail}. Resolve it, or re-run with --force to override.`);
    process.exit(1);
  }
  if (gate.blocked && force) {
    console.warn(`WARNING: overriding gate (${gate.reason}${detail}) via --force.`);
  }

  let result;
  try {
    result = createSprint(cwd, sprintId, slug);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
    return;
  }

  const { branch, planPath } = result;
  console.log(`Created branch ${branch} and plan ${planPath}`);
}

module.exports = { checkGate, createSprint };

if (require.main === module) {
  main();
}
