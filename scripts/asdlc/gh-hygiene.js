const fs = require('node:fs');
const { run } = require('./lib/exec');
const { isBranchMerged } = require('./lib/branch-status');

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

  // The merged test used to be "`git log <trunk>..<branch>` is empty", which is
  // blind to the squash-merge this plugin itself promotes (finish-sprint.js:31-49):
  // the squashed commit on trunk is a different commit, so the branch's originals
  // are never "in" trunk and the audit reported zero stale branches forever.
  // Verified live 2026-08-04 — it printed `Stale merged branches: none` for a
  // branch squash-merged minutes earlier. lib/branch-status.js holds the working
  // strategies (and the reasons `git cherry` is not among them).
  return branches.filter((branch) => isBranchMerged(cwd, branch, { trunk, runner }));
}

// `git ls-remote --heads` emits one `<sha>\t<ref>` line per matching head.
// Split on the tab rather than on whitespace: a ref name cannot contain a tab,
// and splitting on spaces would be wrong the moment one appears in a ref.
function parseLsRemoteHeads(out) {
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [sha, ref] = l.split('\t');
      return { sha, branch: (ref || '').replace(/^refs\/heads\//, '') };
    })
    .filter((e) => e.branch.length > 0);
}

// Sprint branches that still exist ON THE REMOTE although their work is in trunk.
//
// WHY THIS EXISTS: findStaleBranches above scans refs/heads — LOCAL branches. So did
// new-sprint.js's gate. finish-sprint.js deletes the local branch first and could fail
// the remote delete silently (v0.2-s8 fixed that half), which left debris no check
// could see: sprint/v0.2-s7 sat on GitHub until a human noticed it.
//
// Asks the remote directly rather than reading refs/remotes/origin/sprint/*. Those
// remote-tracking refs are only as fresh as the last `fetch --prune`: they report
// branches already deleted on the remote and miss ones pushed from another clone. An
// audit that can be confidently wrong is worse than one that admits it cannot answer —
// and when the network is down, safeCheck renders this as `could not check (…)`, which
// is the honest report.
//
// "Stale" keeps findStaleBranches' meaning exactly (a merged PR, or work already in
// trunk), so a sprint still in flight is never reported. Per-branch failures are
// RETURNED rather than swallowed, the way checkMilestone reports per-issue failures in
// finish-sprint.js: one unresolvable ref must not blank the whole check, but it must
// not vanish either.
function findStaleRemoteBranches(cwd, { trunk = 'main', runner = run } = {}) {
  const listed = parseLsRemoteHeads(
    runner('git', ['ls-remote', '--heads', 'origin', 'refs/heads/sprint/*'], { cwd }),
  );

  const stale = [];
  const unknown = [];
  for (const { branch } of listed) {
    try {
      if (isBranchMerged(cwd, branch, { trunk, runner })) stale.push(branch);
    } catch (err) {
      unknown.push({ branch, error: err.message });
    }
  }
  return { stale, unknown };
}

// One record per worktree in `git worktree list --porcelain`, records separated
// by a blank line. Lines are `<key> <value>` (worktree, HEAD, branch) or a bare
// keyword with no value (detached, bare, locked, prunable). Parsed generically
// rather than by matching the three keys we care about, so an unknown keyword
// from a newer git can never desynchronise the record boundaries.
function parseWorktreeRecords(porcelain) {
  const records = [];
  let current = null;
  for (const rawLine of porcelain.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') {
      if (current) records.push(current);
      current = null;
      continue;
    }
    const sep = line.indexOf(' ');
    const key = sep === -1 ? line : line.slice(0, sep);
    const value = sep === -1 ? true : line.slice(sep + 1);
    // A `worktree` line always opens a record; everything else attaches to the
    // record already open.
    if (key === 'worktree') current = { worktree: value };
    else if (current) current[key] = value;
  }
  if (current) records.push(current);
  return records;
}

// Worktrees are the ASDLC's unit of concurrency (one sprint = one worktree =
// one session), and nothing audited them before: a 1.15 GB worktree was found
// in the GAW repo, last written 2026-07-28, holding a branch with 14
// uncommitted files — invisible to the branch check (the branch was checked
// out, so nothing about it looked stale), to the issue checks, and to `git
// status` in the main tree. Each of the three signals below is independently
// actionable, so a worktree carries a list of reasons rather than one verdict.
function findStaleWorktrees(cwd, { maxAgeDays = 14, trunk = 'main', runner = run } = {}) {
  const records = parseWorktreeRecords(
    runner('git', ['worktree', 'list', '--porcelain'], { cwd }),
  );
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const findings = [];

  // Skip record 0: git always emits the MAIN working tree first. Skipping by
  // index rather than by comparing paths against `cwd` matters because the
  // audit can legitimately be run from inside a linked worktree, where a path
  // comparison would exempt that worktree and flag the main tree instead.
  for (const record of records.slice(1)) {
    const worktreePath = record.worktree;
    const branch = typeof record.branch === 'string'
      ? record.branch.replace(/^refs\/heads\//, '')
      : null;
    const reasons = [];

    // A prunable worktree's directory is gone, so neither `git status` (which
    // would spawn in a nonexistent cwd) nor the mtime read can run. Report it
    // and move on instead of letting one dead record fail the whole check.
    if (!fs.existsSync(worktreePath)) {
      findings.push({ path: worktreePath, branch, reasons: ['missing-directory'] });
      continue;
    }

    if (branch && isBranchMerged(cwd, branch, { trunk, runner })) {
      reasons.push('branch-merged');
    }
    if (runner('git', ['status', '--porcelain'], { cwd: worktreePath }).length > 0) {
      reasons.push('uncommitted-changes');
    }
    if (now - fs.statSync(worktreePath).mtimeMs > maxAgeMs) {
      reasons.push(`older-than-${maxAgeDays}d`);
    }

    if (reasons.length > 0) findings.push({ path: worktreePath, branch, reasons });
  }
  return findings;
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

// An issue carries an Execution Profile once it has one label from each of the
// three routing axes. Deliberately checked by prefix rather than by exact value,
// so adding a new bucket (e.g. `complexity/trivial`) doesn't require touching
// this audit. The concrete model is NOT a label — it resolves from the class via
// .asdlc/policy/execution-classes.yaml, so it can be re-pointed in one place when
// the model lineup turns over.
const PROFILE_LABEL_PREFIXES = ['complexity/', 'risk/', 'execution/'];

function hasProfileLabels(labels) {
  const names = (labels || []).map((label) => label.name || '');
  return PROFILE_LABEL_PREFIXES.every(
    (prefix) => names.some((name) => name.startsWith(prefix)),
  );
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
    // Reported independently of 'no-labels' (rather than skipped as redundant
    // for a bare issue) so that filtering the audit by this one reason yields
    // the complete "needs /profile-issue" worklist.
    if (!hasProfileLabels(issue.labels)) {
      findings.push({ number: issue.number, reason: 'no-execution-profile' });
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

// A scheduled workflow fails silently by construction — nobody is waiting on its
// output — so it can stay broken for months, and the first symptom is an absent
// report everyone assumed was clean. The motivating case: a test red in a nightly
// tier for roughly twelve sprints in a project whose CLAUDE.md said to check it.
// Prose instructions to check a thing are what loop-hardening was written to replace.
// `conclusion !== 'success'` was too wide. `cancelled` means a human stopped the
// run and `skipped` means a path filter or an `if:` condition matched nothing —
// in neither case did the workflow fail. asdlc-hygiene.md tells the reader to
// treat a finding here as a real red, so the predicate has to name the
// conclusions that actually are one. `neutral` is excluded for the same reason:
// it is a deliberate "no verdict".
const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);

function findFailingScheduledWorkflows(cwd, { runner = run } = {}) {
  const out = runner(
    'gh',
    [
      'run', 'list',
      // Filtered server-side, not client-side over a mixed-event list: with
      // `--limit N` across all events a weekly workflow falls off the end on a
      // busy repo and reports as absent, which reads as clean.
      '--event', 'schedule',
      '--limit', '50',
      // `workflowName` is the workflow; `name` is the run's display title.
      '--json', 'workflowName,conclusion,status,createdAt',
    ],
    { cwd },
  );

  const latest = new Map();
  for (const entry of JSON.parse(out)) {
    // A run still in flight has no conclusion yet. The most recent *completed*
    // run is the one carrying a verdict; guessing from an in-flight run would
    // either invent a failure or mask one.
    if (entry.status !== 'completed') continue;
    const previous = latest.get(entry.workflowName);
    // createdAt is ISO-8601 UTC ("2026-08-05T02:00:00Z"), so lexicographic
    // comparison is chronological — no Date parsing needed.
    if (!previous || entry.createdAt > previous.createdAt) {
      latest.set(entry.workflowName, entry);
    }
  }

  const findings = [];
  for (const [workflow, entry] of latest) {
    if (FAILING_CONCLUSIONS.has(entry.conclusion)) {
      findings.push({ workflow, conclusion: entry.conclusion, createdAt: entry.createdAt });
    }
  }
  return findings;
}

// runHygieneAudit aggregates every independent check it runs. Three
// (findStaleBranches, findStaleWorktrees, checkDefaultBranch) only need local
// git and will succeed in any real repo. One (findStaleRemoteBranches) needs
// the network to reach the `origin` remote, but not the `gh` CLI itself.
// The other three (findUntriagedIssues, checkMilestoneVersionSync,
// findFailingScheduledWorkflows) shell out to `gh` and depend on GitHub auth,
// network access, and a GitHub remote existing — any of which can be
// missing/broken independently of the git-only checks.
//
// This is a read-only *audit/report* tool, not a hard gate: its whole value is
// "tell the human as much as you can find out". Letting one gh-based check's
// failure (e.g. `gh` not authenticated) throw out of runHygieneAudit would
// crash the entire audit and hide the git-based findings that had *already*
// succeeded — e.g. "you have 3 stale branches" is still worth reporting even
// when the issue-triage check can't run. So each check is isolated: a failing
// check is represented as `{ error: <message> }` in its slot instead of
// aborting the whole aggregate, and every other (successful) check's real
// result is still returned. This isolation is applied uniformly to every
// check (not just the three gh-based ones) since even a "local-only" git check
// can fail for reasons unrelated to the others (missing git binary, corrupted
// .git, wrong cwd, etc.) and there is no reason a failure there should hide
// results from checks that did succeed. The worktree check is the newest
// illustration: it reads the filesystem for every linked worktree, so a
// permission error or a network drive that has gone away must not take the
// branch and issue findings down with it.
function safeCheck(fn) {
  try {
    return fn();
  } catch (err) {
    return { error: err.message };
  }
}

// The one place the check set is written down. runHygieneAudit builds its result
// from it, main() renders from it, and command-prose.test.js reads its labels —
// so adding a check here is the whole of adding a check. Order is report order.
const HYGIENE_CHECKS = [
  {
    key: 'staleBranches',
    label: 'Stale merged branches',
    run: (cwd, c) => findStaleBranches(cwd, { trunk: c.declaredTrunk, runner: c.runner }),
    format: (v) => (v.length ? v.join(', ') : 'none'),
  },
  {
    key: 'staleRemoteBranches',
    label: 'Stale remote sprint branches',
    run: (cwd, c) => findStaleRemoteBranches(cwd, { trunk: c.declaredTrunk, runner: c.runner }),
    format: (v) => {
      const parts = [v.stale.length ? v.stale.map((b) => `${b} (git push origin --delete ${b})`).join(', ') : 'none judged stale'];
      // Report what could not be judged rather than counting it as clean — the
      // whole point of this check is that unseen debris is how it survives.
      if (v.unknown.length) parts.push(`unjudged: ${v.unknown.map((u) => `${u.branch} (${u.error})`).join(', ')}`);
      return parts.join(' · ');
    },
  },
  {
    key: 'staleWorktrees',
    label: 'Stale worktrees',
    run: (cwd, c) => findStaleWorktrees(cwd, { trunk: c.declaredTrunk, runner: c.runner }),
    format: (v) => (v.length ? v.map((w) => `${w.path} [${w.branch || 'detached'}] (${w.reasons.join(', ')})`).join('; ') : 'none'),
  },
  {
    key: 'defaultBranch',
    label: 'Default branch',
    run: (cwd, c) => checkDefaultBranch(cwd, c.declaredTrunk, { runner: c.runner }),
    format: (v, c) => (v.ok ? 'OK' : `MISMATCH (origin/HEAD -> ${v.actual}, expected ${c.declaredTrunk})`),
  },
  {
    key: 'untriagedIssues',
    label: 'Untriaged issues',
    run: (cwd, c) => findUntriagedIssues(cwd, { runner: c.runner }),
    format: (v) => (v.length ? v.map((i) => `#${i.number} (${i.reason})`).join(', ') : 'none'),
  },
  {
    key: 'milestoneSync',
    label: 'Milestone/sprint version sync',
    run: (cwd, c) => checkMilestoneVersionSync(cwd, c.currentSprintVersion, { runner: c.runner }),
    format: (v) => (v.inSync ? 'OK' : `OUT OF SYNC (milestones: ${v.milestoneVersions.join(', ')})`),
  },
  {
    key: 'failingScheduled',
    label: 'Failing scheduled workflows',
    run: (cwd, c) => findFailingScheduledWorkflows(cwd, { runner: c.runner }),
    format: (v) => (v.length ? v.map((w) => `${w.workflow} (${w.conclusion}, ${w.createdAt})`).join(', ') : 'none'),
  },
];

function runHygieneAudit(cwd, { declaredTrunk, currentSprintVersion, runner = run } = {}) {
  const ctx = { declaredTrunk, currentSprintVersion, runner };
  const report = {};
  for (const check of HYGIENE_CHECKS) {
    report[check.key] = safeCheck(() => check.run(cwd, ctx));
  }
  return report;
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

  const ctx = { declaredTrunk, currentSprintVersion };

  console.log('=== ASDLC hygiene audit ===');
  for (const check of HYGIENE_CHECKS) {
    console.log(`${check.label}: ${formatCheck(report[check.key], (v) => check.format(v, ctx))}`);
  }

  if (HYGIENE_CHECKS.some((check) => isCheckError(report[check.key]))) {
    process.exitCode = 1;
  }
}

module.exports = {
  PROFILE_LABEL_PREFIXES,
  findStaleBranches,
  parseLsRemoteHeads,
  findStaleRemoteBranches,
  findStaleWorktrees,
  checkDefaultBranch,
  findUntriagedIssues,
  checkMilestoneVersionSync,
  findFailingScheduledWorkflows,
  HYGIENE_CHECKS,
  runHygieneAudit,
};

if (require.main === module) {
  main();
}
