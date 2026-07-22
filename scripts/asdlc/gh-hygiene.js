const { run } = require('./lib/exec');

function findStaleBranches(cwd, { trunk = 'main', runner = run } = {}) {
  // Use git for-each-ref instead of git branch --list to avoid the `+` marker
  // (which marks branches checked out in other worktrees) and the `*` marker
  // (which marks the current branch). for-each-ref with --format=%(refname:short)
  // emits clean branch names without any prefix.
  const branches = runner(
    'git',
    ['for-each-ref', 'refs/heads/sprint/*', '--format=%(refname:short)'],
    { cwd },
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return branches.filter((branch) => {
    const unmerged = runner('git', ['log', `${trunk}..${branch}`, '--oneline'], { cwd });
    return unmerged.length === 0;
  });
}

function checkDefaultBranch(cwd, declaredTrunk, { runner = run } = {}) {
  let ref;
  try {
    ref = runner('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd });
  } catch (err) {
    // origin/HEAD doesn't exist (e.g., fresh clone, no remote, or fixture repo).
    // Git's real error for this specific case is:
    //   fatal: ref refs/remotes/origin/HEAD is not a symbolic ref
    // Since this is a read-only audit tool, we handle *that specific* failure
    // gracefully and return a clear "unknown" state rather than crashing.
    // Any other failure (corrupted .git, git missing, permission denied, wrong
    // cwd, etc.) is unexpected and must not be silently swallowed.
    if (/is not a symbolic ref/i.test(err.message)) {
      return { ok: false, actual: '<unknown>' };
    }
    throw err;
  }

  const actual = ref.replace('refs/remotes/origin/', '');
  return { ok: actual === declaredTrunk, actual };
}

function findUntriagedIssues(cwd, { runner = run } = {}) {
  const out = runner(
    'gh',
    ['issue', 'list', '--state', 'open', '--json', 'number,labels,milestone'],
    { cwd },
  );
  const issues = JSON.parse(out);
  const findings = [];
  for (const issue of issues) {
    if (!issue.labels || issue.labels.length === 0) {
      findings.push({ number: issue.number, reason: 'no-labels' });
    }
    if (!issue.milestone) {
      findings.push({ number: issue.number, reason: 'no-milestone' });
    }
  }
  return findings;
}

function checkMilestoneVersionSync(cwd, currentSprintVersion, { runner = run } = {}) {
  const out = runner(
    'gh',
    ['api', 'repos/{owner}/{repo}/milestones', '--jq', '.[].title'],
    { cwd },
  );
  const titles = out.split('\n').map((l) => l.trim()).filter(Boolean);
  // Real GitHub milestone titles are rarely bare "v0.12" strings — they're
  // usually something like "Sprint v0.12: <goal>". Extract the version-like
  // token (vX.Y) out of each title rather than comparing whole title strings,
  // otherwise a milestone that genuinely covers the current sprint version
  // would be reported as "out of sync" just because its title has extra text.
  const versionPattern = /v\d+\.\d+/g;
  const milestoneVersions = [];
  for (const title of titles) {
    const matches = title.match(versionPattern);
    if (matches) milestoneVersions.push(...matches);
  }
  return { inSync: milestoneVersions.includes(currentSprintVersion), milestoneVersions };
}

// runHygieneAudit aggregates four independent checks. Two (findStaleBranches,
// checkDefaultBranch) only need local git and will succeed in any real repo.
// The other two (findUntriagedIssues, checkMilestoneVersionSync) shell out to
// `gh` and depend on GitHub auth, network access, and a GitHub remote existing
// — any of which can be missing/broken independently of the git-only checks.
//
// This is a read-only *audit/report* tool, not a hard gate: its whole value is
// "tell the human as much as you can find out". Letting one gh-based check's
// failure (e.g. `gh` not authenticated) throw out of runHygieneAudit would
// crash the entire audit and hide the git-based findings that had *already*
// succeeded — e.g. "you have 3 stale branches" is still worth reporting even
// when the issue-triage check can't run. So each check is isolated: a failing
// check is represented as `{ error: <message> }` in its slot instead of
// aborting the whole aggregate, and every other (successful) check's real
// result is still returned. This isolation is applied uniformly to all four
// checks (not just the two gh-based ones) since even a "local-only" git check
// can fail for reasons unrelated to the others (missing git binary, corrupted
// .git, wrong cwd, etc.) and there is no reason a failure there should hide
// results from checks that did succeed.
function safeCheck(fn) {
  try {
    return fn();
  } catch (err) {
    return { error: err.message };
  }
}

function runHygieneAudit(cwd, { declaredTrunk, currentSprintVersion, runner = run } = {}) {
  return {
    staleBranches: safeCheck(() => findStaleBranches(cwd, { trunk: declaredTrunk, runner })),
    defaultBranch: safeCheck(() => checkDefaultBranch(cwd, declaredTrunk, { runner })),
    untriagedIssues: safeCheck(() => findUntriagedIssues(cwd, { runner })),
    milestoneSync: safeCheck(() => checkMilestoneVersionSync(cwd, currentSprintVersion, { runner })),
  };
}

// A check's slot in the report is a safeCheck() failure marker (as opposed to
// a genuine successful result) iff it is exactly `{ error: <string> }`.
// Genuine results are always either arrays or objects with their own
// (different) shape, so this can't collide with a real success value.
function isCheckError(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && 'error' in value && Object.keys(value).length === 1;
}

function formatCheck(value, formatOk) {
  return isCheckError(value) ? `could not check (${value.error})` : formatOk(value);
}

function main() {
  const [declaredTrunk, currentSprintVersion] = process.argv.slice(2);
  if (!declaredTrunk || !currentSprintVersion) {
    console.error('Usage: node gh-hygiene.js <declared-trunk> <current-sprint-version>');
    process.exit(1);
  }
  const report = runHygieneAudit(process.cwd(), { declaredTrunk, currentSprintVersion });

  console.log('=== ASDLC hygiene audit ===');
  console.log(`Stale merged branches: ${formatCheck(report.staleBranches, (v) => (v.length ? v.join(', ') : 'none'))}`);
  console.log(`Default branch: ${formatCheck(report.defaultBranch, (v) => (v.ok ? 'OK' : `MISMATCH (origin/HEAD -> ${v.actual}, expected ${declaredTrunk})`))}`);
  console.log(`Untriaged issues: ${formatCheck(report.untriagedIssues, (v) => (v.length ? v.map((i) => `#${i.number} (${i.reason})`).join(', ') : 'none'))}`);
  console.log(`Milestone/sprint version sync: ${formatCheck(report.milestoneSync, (v) => (v.inSync ? 'OK' : `OUT OF SYNC (milestones: ${v.milestoneVersions.join(', ')})`))}`);

  const anyCheckFailed = ['staleBranches', 'defaultBranch', 'untriagedIssues', 'milestoneSync']
    .some((key) => isCheckError(report[key]));
  if (anyCheckFailed) {
    process.exitCode = 1;
  }
}

module.exports = {
  findStaleBranches,
  checkDefaultBranch,
  findUntriagedIssues,
  checkMilestoneVersionSync,
  runHygieneAudit,
};

if (require.main === module) {
  main();
}
