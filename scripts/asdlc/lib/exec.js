const { spawnSync } = require('node:child_process');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const err = new Error(`${cmd} ${args.join(' ')} failed: ${stderr}`);
    // Attach the child's exit code and stderr to the Error. Purely additive —
    // the message is unchanged, so every existing caller and test behaves
    // identically. Callers that need it can now tell *why* a command failed.
    //
    // This exists because some git commands signal a RESULT through the exit
    // code rather than through stdout: `git diff --quiet` exits 1 to mean
    // "the trees differ", which is an answer, not an error. Without `status`
    // a caller catching the throw cannot distinguish that from exit 128
    // ("bad ref", "not a git repository"), and would have to treat a broken
    // invocation as a legitimate negative answer.
    err.status = result.status;
    err.stderr = stderr;
    throw err;
  }
  return (result.stdout || '').trim();
}

// run()'s opposite number, for commands whose FAILURE is the result being
// measured. `mutate.js` runs a project's own test command expecting it to go
// red; with run() every such expected failure would arrive as a throw, and the
// interesting information — the output containing the predicted reason — would
// have to be dug back out of an Error message.
//
// Deliberately a second function rather than an option on run(). run()'s
// throw-on-non-zero contract is depended on across this package, and the
// v0.2-s2 handoff records the near-miss: gh-hygiene's "absent trunk must throw"
// assertion was one flag away from being silently downgraded to "reports a
// clean audit". Two functions with two honest contracts beat one with a mode.
//
// What it does NOT swallow: a process that could not be spawned at all (a
// missing binary, a bad cwd) still throws. That is tooling failure, not
// evidence, and reporting it as a red test would manufacture a finding out of
// a broken instrument.
//
// stdout/stderr are returned UNTRIMMED, unlike run(). The caller substring-
// matches the predicted failure text against them, and trimming is the kind of
// quiet tidy-up that would turn a correct RED into a wrong-reason one.
function runCapture(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  return {
    // null when the child was killed by a signal rather than exiting; callers
    // treat anything that is not 0 as a failure, which is the right reading.
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

module.exports = { run, runCapture };
