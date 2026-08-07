const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// scripts/asdlc/test -> scripts/asdlc -> scripts -> repo root
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const COMMANDS_DIR = path.join(REPO_ROOT, 'commands');

// Requires the .js suffix, so bootstrap-asdlc.md's bare
// `${CLAUDE_PLUGIN_ROOT}/scripts/asdlc/` directory reference is correctly not a match.
const SCRIPT_PATH = /scripts\/asdlc\/[A-Za-z0-9_./-]*\.js/g;

function commandFiles() {
  return fs.readdirSync(COMMANDS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => path.join(COMMANDS_DIR, name));
}

test('every scripts/asdlc path named in command prose exists on disk', () => {
  const missing = [];
  let found = 0;
  for (const file of commandFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const named of text.match(SCRIPT_PATH) || []) {
      found += 1;
      if (!fs.existsSync(path.join(REPO_ROOT, named))) {
        missing.push(`${path.basename(file)} -> ${named}`);
      }
    }
  }
  // Without this, a broken regex makes the gate pass by finding nothing at all -
  // an inert gate that reports success is worse than no gate.
  assert.ok(found > 0, 'command prose gate matched no script paths at all; the pattern is broken');
  assert.deepEqual(missing, [], `command prose names scripts that do not exist: ${missing.join('; ')}`);
});
