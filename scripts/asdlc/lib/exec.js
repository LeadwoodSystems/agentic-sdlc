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

module.exports = { run };
