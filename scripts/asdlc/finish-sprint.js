const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./lib/exec');

/**
 * resolveSprintBranch(cwd, sprintId, { runner = run } = {})
 * -> { branch: string|null, reason?: 'not-found'|'ambiguous', candidates?: string[] }
 *
 * `sprint/${sprintId}` is an ASSUMPTION, not a guarantee. `new-sprint.js` creates
 * branches as `sprint/<sprintId>` and plan/handoff FILES as `<sprintId>-<slug>.md`, so
 * the two schemes differ by a slug — and a branch created by hand (or by an older
 * version) commonly carries the slug too.
 *
 * Observed live on 2026-08-05: `finish-sprint.js v0.2-s1 <sha>` looked for
 * `sprint/v0.2-s1` while the real branch was `sprint/v0.2-s1-execution-profiles`. It
 * had already rewritten STATUS.md by then, so it died with a raw stack trace leaving
 * the operation half-done — and non-idempotent, because the re-run fails in markMerged
 * with "no awaiting-merge entry found". Resolving the branch BEFORE any mutation is
 * what makes the failure recoverable.
 *
 * Matching is exact-first, then `sprint/<id>-*` with the hyphen REQUIRED — a bare
 * prefix test would match `sprint/v0.2-s10-x` when asked for `v0.2-s1`. Several
 * candidates is reported rather than guessed: deleting the wrong sprint branch is not
 * a recoverable mistake.
 */
function resolveSprintBranch(cwd, sprintId, { runner = run } = {}) {
  const branches = runner(
    'git',
    ['for-each-ref', 'refs/heads/sprint/*', '--format=%(refname:short)'],
    { cwd },
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const exact = `sprint/${sprintId}`;
  if (branches.includes(exact)) return { branch: exact };

  const candidates = branches.filter((b) => b.startsWith(`${exact}-`));
  if (candidates.length === 1) return { branch: candidates[0] };
  if (candidates.length > 1) return { branch: null, reason: 'ambiguous', candidates };
  return { branch: null, reason: 'not-found' };
}

/**
 * resolveRemoteSprintBranch(cwd, sprintId, { runner = run } = {})
 * -> { branch } | { branch: null, reason: 'not-found'|'ambiguous'|'unreachable', ... }
 *
 * The same exact-then-slug matching as resolveSprintBranch, asked of `origin`.
 *
 * WHY: after a partial finish the LOCAL branch is gone and the remote one is not,
 * so resolveSprintBranch reports `not-found` and main() refuses — which means a
 * re-run can never clean up the remote, and the operator's only recourse is the
 * `git push` that already failed. That is the hole that made v0.3-s3's partial
 * failure unrecoverable by re-running.
 *
 * `unreachable` is kept distinct from `not-found`: "origin says this branch does
 * not exist" and "I could not ask origin" are different answers, and collapsing
 * them is the same defect deleteBranch's origin/ls-remote split exists to avoid.
 */
function resolveRemoteSprintBranch(cwd, sprintId, { runner = run } = {}) {
  let listed;
  try {
    listed = runner('git', ['ls-remote', '--heads', 'origin', `refs/heads/sprint/${sprintId}`, `refs/heads/sprint/${sprintId}-*`], { cwd });
  } catch (err) {
    return { branch: null, reason: 'unreachable', error: err.message };
  }

  const names = listed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split('\t')[1])
    .filter(Boolean)
    .map((ref) => ref.replace(/^refs\/heads\//, ''));

  const exact = `sprint/${sprintId}`;
  if (names.includes(exact)) return { branch: exact };

  // The `-*` refspec above cannot distinguish `sprint/v0.2-s1-x` from
  // `sprint/v0.2-s10-x`, so the hyphen is re-checked here for the same reason
  // resolveSprintBranch requires it locally.
  const candidates = names.filter((n) => n.startsWith(`${exact}-`));
  if (candidates.length === 1) return { branch: candidates[0] };
  if (candidates.length > 1) return { branch: null, reason: 'ambiguous', candidates };
  return { branch: null, reason: 'not-found' };
}

/**
 * currentBranch(cwd, { runner = run } = {}) -> string|null
 * The checked-out branch name, `'HEAD'` on a detached HEAD (git's own answer),
 * or null when git returned nothing at all.
 *
 * The null case is "I do not know", not "no branch", and callers must treat it
 * as unknown rather than as a mismatch. Warning on an unknown branch would be
 * asserting something this function did not learn.
 */
function currentBranch(cwd, { runner = run } = {}) {
  const name = runner('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).trim();
  return name.length > 0 ? name : null;
}

/**
 * markMerged(cwd, sprintId, sha) -> 'flipped' | 'already-merged'
 * Finds the STATUS.md line containing `**${sprintId}**` and `status: awaiting-merge`,
 * and rewrites just that line's trailing status to `status: merged (${sha})`.
 * Throws if the sprint has no entry at all.
 *
 * IDEMPOTENCE: an entry already reading `status: merged` means an earlier run got
 * this far and something AFTER it failed — the remote delete, most often, because
 * it is the only step that touches the network. Re-running is then the operator's
 * only way to finish the job, so this must not throw on the second attempt.
 *
 * Observed 2026-08-08 finishing v0.3-s3: the run flipped STATUS.md, deleted the
 * local branch, then failed the remote delete and exited 1. Before this change a
 * re-run died here with "no awaiting-merge entry found" — refusing at the one step
 * that had already succeeded, rather than retrying the one that had not.
 *
 * A sprint with NO entry is still an error: that is a wrong sprint id, and
 * silently doing nothing about it is how a typo looks like success.
 */
function markMerged(cwd, sprintId, sha) {
  const statusPath = path.join(cwd, 'docs/STATUS.md');
  const lines = fs.readFileSync(statusPath, 'utf8').split('\n');

  const idx = lines.findIndex(
    (l) => l.includes(`**${sprintId}**`) && l.includes('status: awaiting-merge')
  );
  if (idx === -1) {
    if (lines.some((l) => l.includes(`**${sprintId}**`) && l.includes('status: merged'))) {
      return 'already-merged';
    }
    throw new Error(`No awaiting-merge entry found for ${sprintId} in docs/STATUS.md.`);
  }

  const sanitizedSha = sha.replace(/[\r\n]/g, ' ');
  lines[idx] = lines[idx].replace('status: awaiting-merge', `status: merged (${sanitizedSha})`);
  fs.writeFileSync(statusPath, lines.join('\n'));
  return 'flipped';
}

/**
 * originUrl(cwd, { runner = run } = {})
 * -> string|null — the configured `origin` URL, or null if there is no usable origin.
 *
 * A LOCAL config read, deliberately. It cannot reach the network, so no auth failure,
 * unreachable host, or Git-for-Windows MSYS crash can reach it either — which is what
 * makes it able to answer the one question `git ls-remote` cannot answer separately:
 * "is there an origin at all?" as opposed to "could I talk to it?".
 *
 * Exit 1 is `git config --get`'s way of reporting an ABSENT KEY, which is an answer.
 * Anything else (a corrupt config, a cwd that is not a git repository) is a broken
 * invocation and propagates. This is the same discrimination lib/branch-status.js:53-60
 * applies to `git diff --quiet`, and for the same reason: swallowing a broken invocation
 * as a legitimate negative answer is exactly the defect this function was added to remove.
 *
 * A configured-but-empty value counts as absent — `git config` will hold an empty string,
 * and an origin with no URL is not one that can be pushed to.
 */
function originUrl(cwd, { runner = run } = {}) {
  try {
    const url = runner('git', ['config', '--get', 'remote.origin.url'], { cwd });
    return url.length > 0 ? url : null;
  } catch (err) {
    if (err.status === 1) return null;
    throw err;
  }
}

/**
 * deleteBranch(cwd, branchName, { runner = run } = {})
 * Deletes the local branch, then reports what happened to the remote one:
 *   { remote: 'deleted' }            pushed a delete to origin
 *   { remote: 'absent' }             origin exists, the branch is not on it
 *   { remote: 'no-origin' }          no origin configured — nothing to delete
 *   { remote: 'failed', error }      origin exists and the delete could not be done
 *
 * The result describes the REMOTE outcome only. There is no `local` field: the local
 * delete either succeeded or threw, so a returning deleteBranch has always done it, and
 * a field that is always true is a field callers learn to skip reading.
 *
 * SQUASH-MERGE HANDLING:
 * This plugin promotes squash-merge PRs (one clean commit per sprint).
 * When a PR is squash-merged, GitHub creates a NEW commit on main with a different
 * SHA than any commit on the sprint branch. Therefore, `git branch -d` (which checks
 * ancestry) will fail — git doesn't recognize the branch as "merged" because the
 * commits have different SHAs.
 *
 * However, `finish-sprint.js` is only called AFTER human/agent confirms the sprint's
 * PR actually merged. This precondition means the branch's work is safely captured
 * elsewhere (in main, via the merged PR). Given that, a fallback to `git branch -D`
 * (force delete) is appropriate and safe: the only risk with force delete is losing
 * unmerged work, but we have the precondition that the work IS merged.
 *
 * Strategy: try `git branch -d` first (safe delete). If it fails specifically
 * because git reports the branch as "not fully merged" (the squash-merge case),
 * fall back to `git branch -D` (force delete). Any other failure (branch not
 * found, branch checked out elsewhere, etc.) is re-thrown as-is so the original
 * diagnostic message isn't discarded.
 */
function deleteBranch(cwd, branchName, { runner = run } = {}) {
  // Probed BEFORE the local delete: it is a pure local read, and a broken
  // invocation must throw while the repo is still untouched. Probing after
  // `git branch -d` would put the one throw this function can still produce
  // on the far side of an irreversible mutation — the half-applied finish
  // the note below exists to prevent.
  const origin = originUrl(cwd, { runner });

  // Try safe delete first
  try {
    runner('git', ['branch', '-d', branchName], { cwd });
  } catch (err) {
    // Only fall back to force delete for the known squash-merge case, where
    // git can't verify ancestry because the branch's commits were squashed
    // into a new commit on main. Any other failure reason should propagate.
    if (!/not fully merged/i.test(err.message)) {
      throw err;
    }
    runner('git', ['branch', '-D', branchName], { cwd });
  }

  // From here the function is about the REMOTE, and every outcome is returned
  // rather than thrown. By the time main() calls this, markMerged has already
  // rewritten STATUS.md and the local branch is gone — so a throw would produce
  // a raw stack trace on a half-applied finish. That is the failure mode the
  // resolveSprintBranch note above was written to stop recurring, and it is why
  // removeWorktreeForBranch reports rather than throws too. (The one throw this
  // function can still produce — a broken originUrl invocation — happens above,
  // before the local delete, precisely so it lands before any mutation.)
  if (origin === null) return { remote: 'no-origin' };

  // An origin IS configured, so from here a failure is a real failure. The
  // previous version caught this and returned, which made "I could not reach
  // origin" indistinguishable from "there is no origin" and let main() report
  // a remote delete that never happened. Observed live 2026-08-06:
  // sprint/v0.2-s7 survived on GitHub after a run that exited 0.
  return remoteDelete(cwd, branchName, { runner });
}

/**
 * remoteDelete(cwd, branchName, { runner = run } = {})
 * -> { remote: 'deleted' | 'absent' } | gh-fallback result
 *
 * The remote half of deleteBranch, factored out so the resume path in main() —
 * which has no local branch left to delete — runs the identical logic rather
 * than a second copy of it that could drift.
 *
 * Assumes the caller has already established that an origin exists.
 */
function remoteDelete(cwd, branchName, { runner = run } = {}) {
  try {
    const listed = runner('git', ['ls-remote', '--heads', 'origin', branchName], { cwd });
    if (listed.length === 0) return { remote: 'absent' };
    runner('git', ['push', 'origin', '--delete', branchName], { cwd });
    return { remote: 'deleted' };
  } catch (err) {
    return deleteRemoteViaGh(cwd, branchName, err, { runner });
  }
}

/**
 * deleteRemoteOnly(cwd, branchName, { runner = run } = {})
 * The resume path's entry point: no local branch to remove, so this is the
 * origin check plus the remote delete and nothing else.
 */
function deleteRemoteOnly(cwd, branchName, { runner = run } = {}) {
  if (originUrl(cwd, { runner }) === null) return { remote: 'no-origin' };
  return remoteDelete(cwd, branchName, { runner });
}

/**
 * deleteRemoteViaGh(cwd, branchName, gitError, { runner = run } = {})
 * -> { remote: 'deleted', via: 'gh' } | { remote: 'failed', error, fallbackError }
 *
 * WHY A FALLBACK EXISTS AT ALL: `git push` authenticates through git's
 * credential/askpass path. On a Git-for-Windows host that path spawns an MSYS
 * shell, which dies with `add_item ("\??\C:\Program Files\Git", "/", ...) failed,
 * errno 1` (see docs/2026-08-04-shell-strategy.md), and git then falls back to an
 * askpass helper that cannot prompt because run() attaches no stdin. The push
 * therefore cannot authenticate even though the operator IS authenticated to
 * GitHub — `gh auth token` works, and the same delete succeeds immediately
 * through an explicit token header.
 *
 * This is not transient and retrying does not help. Observed on every attempt
 * finishing v0.3-s3 on 2026-08-08; it is the only git operation in the whole
 * toolchain that writes to a remote, which is why it is the only place this bites.
 *
 * `gh` carries its own token and never touches git's credential path, so it
 * succeeds where the push cannot. It is already a hard dependency of
 * gh-hygiene.js and /profile-issue, so this adds no new tooling and does not
 * touch #zero-dependencies — that rule governs npm packages, not CLIs the plugin
 * already requires.
 *
 * `via` is set ONLY here. The git path's return shape is deliberately unchanged,
 * so a caller that compares against `{ remote: 'deleted' }` keeps working, while
 * one that wants to know the fallback fired can read it — and an operator seeing
 * it learns their git credential path is broken, which is worth knowing.
 */
function deleteRemoteViaGh(cwd, branchName, gitError, { runner = run } = {}) {
  try {
    // gh substitutes {owner}/{repo} from the repository in cwd. A branch name
    // containing slashes needs no encoding: it is a path segment of the ref.
    runner('gh', ['api', '-X', 'DELETE', `repos/{owner}/{repo}/git/refs/heads/${branchName}`], { cwd });
    return { remote: 'deleted', via: 'gh' };
  } catch (fallbackErr) {
    // Both errors are reported. The git one names what the operator tried to do;
    // the gh one is what they should read to find out why neither route works.
    return { remote: 'failed', error: gitError.message, fallbackError: fallbackErr.message };
  }
}

/**
 * parseWorktrees(porcelain)
 * Turns `git worktree list --porcelain` output into
 * [{ path, branch: string|null }, …], in git's own order — which matters,
 * because git always emits the MAIN worktree first and that is the only way
 * the porcelain format identifies it.
 *
 * Records are separated by blank lines and each begins with a `worktree <path>`
 * line; a `branch <ref>` line follows only when the worktree has one checked
 * out (a detached worktree emits `detached` instead). Parsed line-by-line
 * rather than by splitting on blank lines so that CRLF-terminated output and a
 * missing trailing blank line are both non-issues. Paths arrive with forward
 * slashes even on Windows, and are passed back to git verbatim.
 */
function parseWorktrees(porcelain) {
  const entries = [];
  for (const rawLine of porcelain.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('worktree ')) {
      entries.push({ path: line.slice('worktree '.length), branch: null });
    } else if (line.startsWith('branch ') && entries.length > 0) {
      entries[entries.length - 1].branch = line.slice('branch '.length);
    }
  }
  return entries;
}

/**
 * removeWorktreeForBranch(cwd, branchName, { force = false, runner = run } = {})
 * Removes the linked worktree that has `branchName` checked out, if there is one.
 *
 * WHY THIS EXISTS: before it, finish-sprint.js cleaned up the branch and left
 * the worktree behind forever. One such orphan survived a week at 1.15 GB,
 * holding 14 uncommitted files nobody could see.
 *
 * The precondition is deleteBranch's (see its SQUASH-MERGE HANDLING note): the
 * caller has already confirmed the sprint's PR merged, so the *committed* work
 * is safely in trunk. That is what makes discarding the worktree safe — but it
 * says nothing about work that was never committed, hence the dirty check.
 *
 * Returns a reportable result rather than throwing on the expected outcomes, so
 * main() can print a specific diagnostic instead of a stack trace:
 *   { removed: true,  forced, path }
 *   { removed: false, reason: 'no-worktree' }
 *   { removed: false, reason: 'main-worktree', path }
 *   { removed: false, reason: 'dirty', path, changes: [...] }
 * A failure of git itself still propagates.
 */
function removeWorktreeForBranch(cwd, branchName, { force = false, runner = run } = {}) {
  const entries = parseWorktrees(runner('git', ['worktree', 'list', '--porcelain'], { cwd }));
  const index = entries.findIndex((e) => e.branch === `refs/heads/${branchName}`);
  if (index === -1) return { removed: false, reason: 'no-worktree' };

  const target = entries[index];
  // The main worktree is git's first record. `git worktree remove` refuses it
  // outright, so this guard exists to turn an opaque git error into a named
  // result — and it holds under --force, where git's own refusal does not.
  if (index === 0) return { removed: false, reason: 'main-worktree', path: target.path };

  // Status is per-worktree, so it must be asked of the worktree's own directory,
  // not of `cwd`.
  const changes = runner('git', ['status', '--porcelain'], { cwd: target.path })
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);

  // Report the changes rather than just their count: an operator deciding
  // whether to pass --force is deciding what to destroy, and needs to see it.
  if (changes.length > 0 && !force) {
    return { removed: false, reason: 'dirty', path: target.path, changes };
  }

  const args = force ? ['worktree', 'remove', '--force', target.path] : ['worktree', 'remove', target.path];
  runner('git', args, { cwd });
  return { removed: true, forced: force, path: target.path };
}

/**
 * checkMilestone(cwd, issueNumbers, { runner = run } = {})
 * For each issue number, runs `gh issue view <n> --json milestone` and returns
 * an array of { issue, milestone: string|null, error?: string }.
 *
 * If any `gh` call fails for a particular issue, that issue's result includes
 * an `error` property with the failure reason. Other issues continue processing.
 * This allows the caller (main()) to report per-issue failures without crashing
 * the whole CLI, since by the time milestone check runs, the core work
 * (markMerged + deleteBranch) is already complete and successful.
 */
function checkMilestone(cwd, issueNumbers, { runner = run } = {}) {
  return issueNumbers.map((issue) => {
    try {
      const out = runner('gh', ['issue', 'view', String(issue), '--json', 'milestone'], { cwd });
      const parsed = JSON.parse(out);
      return { issue, milestone: parsed.milestone ? parsed.milestone.title : null };
    } catch (err) {
      return { issue, milestone: null, error: err.message };
    }
  });
}

/**
 * main(argv = process.argv.slice(2), { runner = run } = {})
 * CLI entry point: node finish-sprint.js [--force] <sprint-id> <sha> [issue-numbers...]
 *
 * Accepts its arguments explicitly (rather than reading process.argv directly)
 * and an injectable `runner`, so it can be invoked directly from tests against
 * a fixture repo with a stubbed runner.
 *
 * RESUME: if there is no local sprint branch but origin still has one, this is
 * the state a partial finish leaves behind — the local delete succeeded and the
 * remote delete did not. main() then finishes the remote side only, rather than
 * refusing. markMerged is idempotent for the same reason.
 *
 * Steps:
 * 1. Validate args (sprint-id, sha required; --trunk <name> defaults to main)
 * 2. Call removeWorktreeForBranch(cwd, `sprint/${sprintId}`) — retire the worktree
 * 3. Call markMerged(cwd, sprintId, sha) — update docs/STATUS.md
 * 4. Call deleteBranch(cwd, branchName) — delete the branch, and report the remote
 *    outcome. A remote branch left behind sets exitCode 1: it is debris that no gate
 *    caught before v0.2-s8, so a silent success is how it survives.
 * 5. If issue numbers provided, call checkMilestone and report missing milestones
 *
 * ORDER: the worktree must go before the branch — git refuses to delete a
 * branch that is checked out in another worktree, so the reverse order fails
 * outright. It also runs before markMerged, one step earlier than strictly
 * required, so that a refusal on a dirty worktree leaves the repo completely
 * untouched: had STATUS.md already been rewritten, the re-run after --force
 * would die in markMerged with "no awaiting-merge entry found".
 *
 * `--force` is accepted anywhere in argv and stripped before positional
 * parsing, so it can be typed in the natural leading position.
 *
 * The milestone check is advisory and wrapped in error handling so that
 * a failure to fetch milestone data (bad issue number, auth failure, network blip)
 * doesn't crash the process — the core work is already done at that point.
 * Any per-issue milestone-check errors are logged as warnings but don't exit
 * with non-zero status.
 */
function main(argv = process.argv.slice(2), { runner = run } = {}) {
  const usage = 'Usage: node finish-sprint.js [--force] [--trunk <name>] <sprint-id> <sha> [issue-numbers...]';
  const force = argv.includes('--force');

  // --trunk <name>: the branch docs/STATUS.md is expected to be edited on.
  // Parsed the same way as new-sprint.js:214-226, including the default, so the
  // two scripts do not disagree about what a trunk is.
  let trunk = 'main';
  const trunkIdx = argv.indexOf('--trunk');
  if (trunkIdx !== -1) {
    trunk = argv[trunkIdx + 1];
    if (!trunk) {
      console.error(usage);
      process.exit(1);
    }
  }
  const trunkValueIdx = trunkIdx === -1 ? -1 : trunkIdx + 1;

  const [sprintId, sha, ...issueArgs] = argv.filter(
    (a, i) => a !== '--force' && a !== '--trunk' && i !== trunkValueIdx,
  );
  if (!sprintId || !sha) {
    console.error(usage);
    process.exit(1);
  }
  const cwd = process.cwd();

  // Resolve the branch FIRST, before markMerged or any removal. An unresolvable
  // branch must leave the repo completely untouched, for the same reason the dirty
  // worktree check runs early: a half-applied finish is worse than a refused one,
  // because markMerged is not idempotent.
  const resolved = resolveSprintBranch(cwd, sprintId, { runner });
  if (!resolved.branch) {
    if (resolved.reason === 'ambiguous') {
      console.error(`Cannot finish ${sprintId}: several branches could be it —`);
      for (const candidate of resolved.candidates) console.error(`    ${candidate}`);
      console.error('Delete the ones that are not this sprint, or finish them first.');
      process.exitCode = 1;
      return;
    }

    // RESUME PATH. No local branch, but the remote one may still be there —
    // which is exactly the state a partial finish leaves behind, because the
    // local delete succeeds and the remote delete is the step that fails. Before
    // this, a re-run refused here and the operator's only recourse was the
    // `git push` that had already failed. See resolveRemoteSprintBranch.
    const remote = resolveRemoteSprintBranch(cwd, sprintId, { runner });
    if (remote.branch) {
      console.log(`Local branch for ${sprintId} is already gone; finishing the remote side only.`);
      finishStatus(cwd, sprintId, sha, trunk, { runner });
      reportRemoteDelete(deleteRemoteOnly(cwd, remote.branch, { runner }), remote.branch);
      reportMilestones(cwd, issueArgs, { runner });
      return;
    }

    console.error(`Cannot finish ${sprintId}: no branch named sprint/${sprintId} or sprint/${sprintId}-<slug>.`);
    if (remote.reason === 'unreachable') {
      console.error(`Could not check origin either: ${remote.error}`);
    } else if (remote.reason === 'ambiguous') {
      console.error('Several branches on origin could be it —');
      for (const candidate of remote.candidates) console.error(`    ${candidate}`);
    }
    console.error('Nothing was changed. Check the sprint id against `git branch --list "sprint/*"`.');
    process.exitCode = 1;
    return;
  }
  const branchName = resolved.branch;

  const worktree = removeWorktreeForBranch(cwd, branchName, { force, runner });
  if (worktree.removed) {
    console.log(`Removed worktree ${worktree.path}${worktree.forced ? ' (forced)' : ''}.`);
  } else if (worktree.reason === 'dirty') {
    console.error(`Refusing to remove the worktree for ${branchName} — it has uncommitted changes:`);
    console.error(`  ${worktree.path}`);
    for (const change of worktree.changes) console.error(`    ${change}`);
    console.error('Commit or discard them, or re-run with --force to destroy them.');
    // Stop here rather than continuing: the branch is checked out in that
    // worktree, so deleteBranch would fail anyway — and its git error would
    // bury the file list above, which is the part the operator needs.
    process.exitCode = 1;
    return;
  } else if (worktree.reason === 'main-worktree') {
    console.warn(`${branchName} is checked out in the main worktree (${worktree.path}) — switch away before deleting it.`);
  }

  finishStatus(cwd, sprintId, sha, trunk, { runner });

  // The local delete and the remote outcome are separately true, so they are
  // reported separately. The old single line — "(local + remote if present)" —
  // was unconditional, and was the sentence that reported a remote delete that
  // had been skipped.
  const deleted = deleteBranch(cwd, branchName, { runner });
  console.log(`Deleted local branch ${branchName}.`);
  reportRemoteDelete(deleted, branchName);

  reportMilestones(cwd, issueArgs, { runner });
}

/**
 * finishStatus(cwd, sprintId, sha, trunk, { runner = run } = {})
 * Flips the STATUS.md entry and says which branch received the edit when that
 * is not the trunk.
 *
 * WHY THE BRANCH WARNING: docs/STATUS.md is machine-owned, and the whole point
 * of the state model is that its history cannot drift. This script edits it in
 * the current working tree without ever having asserted which branch that tree
 * is on — and it deletes the one branch you might plausibly have been on, so
 * "obviously you are on the trunk" is not a safe assumption.
 *
 * Observed 2026-08-08: finishing v0.3-s3 while a follow-up branch was checked
 * out wrote the flip into that branch. It had to be committed there and carried
 * to the trunk through a second PR — which is precisely the drift STATUS.md
 * exists to prevent.
 *
 * A warning rather than a refusal: this script is advisory everywhere except
 * the dirty-worktree guard, and refusing would block finishing from a worktree,
 * which is a legitimate workflow. The operator is told exactly what happened
 * and where, which is what they need to put it right.
 */
function finishStatus(cwd, sprintId, sha, trunk, { runner = run } = {}) {
  const branch = currentBranch(cwd, { runner });
  // null is "I could not tell", not "wrong branch" — warning on it would assert
  // something never learned, and it would fire on every stubbed runner in the
  // suite, making the test output noisy for no signal.
  if (branch !== null && branch !== trunk) {
    const where = branch === 'HEAD' ? 'a detached HEAD' : branch;
    console.warn(`Warning: docs/STATUS.md is being edited on ${where}, not ${trunk}.`);
    console.warn('  STATUS.md is machine-owned and the edit must reach the trunk. Commit it where it');
    console.warn(`  landed and get it there, or re-run from ${trunk}. Pass --trunk <name> if this`);
    console.warn(`  repository's trunk is not "${trunk}".`);
  }

  if (markMerged(cwd, sprintId, sha) === 'already-merged') {
    console.log(`${sprintId} was already marked merged in docs/STATUS.md — left as it was.`);
  } else {
    console.log(`Marked ${sprintId} as merged (${sha}) in docs/STATUS.md.`);
  }
}

/**
 * reportRemoteDelete(result, branchName)
 * Prints the remote outcome and sets exitCode when a branch is left behind.
 * A remote branch left behind sets exitCode 1: it is debris that no gate caught
 * before v0.2-s8, so a silent success is how it survives.
 */
function reportRemoteDelete(result, branchName) {
  if (result.remote === 'deleted') {
    // Naming the fallback matters: it tells the operator their git credential
    // path is broken, which is a fact about their machine they will meet again.
    const via = result.via === 'gh' ? ' (via gh — git push could not authenticate)' : '';
    console.log(`Deleted ${branchName} on origin${via}.`);
  } else if (result.remote === 'no-origin') {
    console.log('No origin configured — nothing to delete on a remote.');
  } else if (result.remote === 'failed') {
    console.error(`Could not delete ${branchName} on origin: ${result.error}`);
    if (result.fallbackError) {
      console.error(`The gh fallback failed too: ${result.fallbackError}`);
    }
    console.error('The REMOTE branch still exists. Finish by hand:');
    console.error(`    git push origin --delete ${branchName}`);
    console.error('  …or, if git cannot authenticate on this host:');
    console.error(`    gh api -X DELETE repos/{owner}/{repo}/git/refs/heads/${branchName}`);
    console.error(`Re-running finish-sprint.js ${branchName.replace(/^sprint\//, '')} <sha> will also retry this step.`);
    // Set the code rather than returning: the milestone check is advisory and
    // still worth running, and process.exitCode survives to the end of main.
    process.exitCode = 1; // a branch left on the remote is not a successful finish
  }
}

/**
 * reportMilestones(cwd, issueArgs, { runner = run } = {})
 * Advisory: a failure to fetch milestone data never fails the run, because the
 * core work is already done by the time it runs.
 */
function reportMilestones(cwd, issueArgs, { runner = run } = {}) {
  const issueNumbers = issueArgs.map(Number).filter((n) => !Number.isNaN(n));
  if (issueNumbers.length === 0) return;

  for (const result of checkMilestone(cwd, issueNumbers, { runner })) {
    if (result.error) {
      console.warn(`Warning: Could not check milestone for issue #${result.issue}: ${result.error}`);
    } else if (!result.milestone) {
      console.warn(`Issue #${result.issue} has no milestone assigned — consider assigning one.`);
    }
  }
}

module.exports = {
  markMerged,
  deleteBranch,
  deleteRemoteOnly,
  resolveSprintBranch,
  resolveRemoteSprintBranch,
  currentBranch,
  parseWorktrees,
  removeWorktreeForBranch,
  checkMilestone,
  originUrl,
  main,
};

if (require.main === module) {
  main();
}
