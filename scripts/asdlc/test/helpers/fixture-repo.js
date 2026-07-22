const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { run } = require('../../lib/exec');

async function makeFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asdlc-fixture-'));
  run('git', ['init', '-b', 'main'], { cwd: dir });
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  run('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  run('git', ['add', 'README.md'], { cwd: dir });
  run('git', ['commit', '-m', 'initial commit'], { cwd: dir });
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

module.exports = { makeFixtureRepo };
