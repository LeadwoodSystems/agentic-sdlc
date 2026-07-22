# Loop Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mechanical/checkable parts of the agentic-sdlc state model (STATUS.md bookkeeping, CLAUDE.md's current-state pointer, sprint-start gating, branch/milestone hygiene, doc archival) with deterministic Node scripts, per `docs/superpowers/specs/2026-07-22-loop-hardening-design.md`.

**Architecture:** Five standalone Node scripts under `scripts/asdlc/`, each a thin CLI wrapper around pure, independently-testable functions. All shelling out to `git`/`gh` goes through one injectable `run()` helper (`scripts/asdlc/lib/exec.js`) so tests can stub it — no mocking library needed. Commands (`/bootstrap-asdlc`, `/sprint`, `/checkpoint`, new `/asdlc-hygiene`) invoke these scripts instead of instructing hand-edits.

**Tech Stack:** Plain Node.js (CommonJS, `require`), no external dependencies. Tests use the built-in `node:test` + `node:assert/strict` runner (`node --test`), invoked against throwaway git fixture repos created in the OS temp dir — never against a real project.

## Global Constraints

- No external npm dependencies anywhere in `scripts/asdlc/` (per the design's "no external deps" constraint — keeps the bar at "Node on PATH," no `npm install` step).
- Every script must be runnable standalone via `node scripts/asdlc/<name>.js` from the repo root.
- All git/gh calls go through the shared `run()` helper so they're stubbable in tests.
- Tests never touch `C:\Users\User\Documents\gaw` or any real project — only fixture repos created under the OS temp dir and cleaned up after each test.
- File naming scheme for plans/handoffs: `vMAJOR.MINOR-sN-<slug>.md` (e.g. `v0.13-s1-my-feature.md`).
- STATUS.md entry format (one line, always appended at the end):
  `- YYYY-MM-DD **vX.Y-sN** — <summary> — [handoff](docs/handoffs/vX.Y-sN-<slug>.md) — status: awaiting-merge`
  and after `finish-sprint.js`: `... — status: merged (<sha>)`.
- CLAUDE.md's auto-owned pointer lives between two HTML comment markers:
  `<!-- asdlc:current-state:auto -->` ... `<!-- /asdlc:current-state:auto -->` — scripts only ever touch text strictly between these two lines.

---

### Task 1: Test fixture helper + first script (`lib/exec.js`)

**Files:**
- Create: `scripts/asdlc/lib/exec.js`
- Create: `scripts/asdlc/test/helpers/fixture-repo.js`
- Test: `scripts/asdlc/test/lib/exec.test.js`

**Interfaces:**
- Produces: `run(cmd, args, opts = {})` → returns trimmed stdout `string`; throws `Error` with message `` `${cmd} ${args.join(' ')} failed: ${stderr.trim()}` `` on non-zero exit. `opts` may include `cwd`.
- Produces: `makeFixtureRepo()` → async function returning `{ dir, cleanup }` where `dir` is a path to a freshly-initialized git repo (git init, one initial commit on `main`, user.name/user.email configured locally) under the OS temp dir; `cleanup()` removes it (`fs.rmSync(dir, { recursive: true, force: true })`).

- [ ] **Step 1: Write the failing test for `run()`**

```js
// scripts/asdlc/test/lib/exec.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../../lib/exec');

test('run() returns trimmed stdout on success', () => {
  const out = run('node', ['-e', 'console.log("  hello  ")']);
  assert.equal(out, 'hello');
});

test('run() throws with stderr message on non-zero exit', () => {
  assert.throws(
    () => run('node', ['-e', 'console.error("boom"); process.exit(1)']),
    /failed: boom/
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/asdlc/test/lib/exec.test.js`
Expected: FAIL — `Cannot find module '../../lib/exec'`

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/asdlc/lib/exec.js
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
    throw new Error(`${cmd} ${args.join(' ')} failed: ${stderr}`);
  }
  return (result.stdout || '').trim();
}

module.exports = { run };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/asdlc/test/lib/exec.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the fixture-repo helper (no test file of its own — exercised by consumers in later tasks)**

```js
// scripts/asdlc/test/helpers/fixture-repo.js
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
```

- [ ] **Step 6: Commit**

```bash
git add scripts/asdlc/lib/exec.js scripts/asdlc/test/lib/exec.test.js scripts/asdlc/test/helpers/fixture-repo.js
git commit -m "Add shared exec helper and git fixture-repo test helper"
```

---

### Task 2: `new-sprint.js` — gate logic

**Files:**
- Create: `scripts/asdlc/new-sprint.js`
- Test: `scripts/asdlc/test/new-sprint.test.js`

**Interfaces:**
- Consumes: `run(cmd, args, opts)` from `scripts/asdlc/lib/exec.js`; `makeFixtureRepo()` from `scripts/asdlc/test/helpers/fixture-repo.js`.
- Produces: `checkGate(cwd, { runner = run } = {})` → `{ blocked: boolean, reason: string|null }`. Blocked reasons: `'unmatched-plan'` (newest file in `docs/superpowers/plans/` has no same-slug counterpart in `docs/handoffs/`) or `'unmerged-branch'` (a local branch matching `sprint/*` exists with commits not on `main`).

- [ ] **Step 1: Write the failing tests**

```js
// scripts/asdlc/test/new-sprint.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { checkGate } = require('../new-sprint');

test('checkGate passes on a clean repo with no plans/handoffs', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const result = checkGate(dir);
    assert.deepEqual(result, { blocked: false, reason: null });
  } finally {
    cleanup();
  }
});

test('checkGate blocks when the newest plan has no matching handoff', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(dir, 'docs/superpowers/plans'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/superpowers/plans/v0.1-s1-foo.md'), '# plan\n');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'add plan'], { cwd: dir });

    const result = checkGate(dir);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'unmatched-plan');
  } finally {
    cleanup();
  }
});

test('checkGate blocks when an unmerged sprint branch exists', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    run('git', ['checkout', '-b', 'sprint/v0.1-s1'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'work.txt'), 'wip\n');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'wip'], { cwd: dir });
    run('git', ['checkout', 'main'], { cwd: dir });

    const result = checkGate(dir);
    assert.equal(result.blocked, true);
    assert.equal(result.reason, 'unmerged-branch');
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/asdlc/test/new-sprint.test.js`
Expected: FAIL — `Cannot find module '../new-sprint'`

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/asdlc/new-sprint.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/asdlc/test/new-sprint.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/asdlc/new-sprint.js scripts/asdlc/test/new-sprint.test.js
git commit -m "Add new-sprint.js gate logic (unmatched-plan / unmerged-branch checks)"
```

---

### Task 3: `new-sprint.js` — sprint creation + CLI + `--force`

**Files:**
- Modify: `scripts/asdlc/new-sprint.js`
- Modify: `scripts/asdlc/test/new-sprint.test.js`

**Interfaces:**
- Consumes: `checkGate(cwd, opts)` from Task 2.
- Produces: `createSprint(cwd, sprintId, slug, { runner = run } = {})` → `{ branch: string, planPath: string }`. Creates `sprint/<sprintId>` branch and writes `docs/superpowers/plans/<sprintId>-<slug>.md` seeded from `docs/superpowers/plans/_TEMPLATE.md` if present, else a minimal fallback with the sprint id/name filled in. Produces CLI behavior: `node scripts/asdlc/new-sprint.js <sprint-id> <slug> [--force]` — prints the gate reason and exits with code 1 if blocked and `--force` absent; otherwise calls `createSprint` and prints the created branch + plan path.

- [ ] **Step 1: Write the failing tests**

```js
// append to scripts/asdlc/test/new-sprint.test.js
const { checkGate, createSprint } = require('../new-sprint');

test('createSprint creates a branch and seeds a plan file', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const { branch, planPath } = createSprint(dir, 'v0.1-s1', 'my-feature');
    assert.equal(branch, 'sprint/v0.1-s1');
    assert.ok(fs.existsSync(path.join(dir, planPath)));

    const current = run('git', ['branch', '--show-current'], { cwd: dir });
    assert.equal(current, 'sprint/v0.1-s1');

    const content = fs.readFileSync(path.join(dir, planPath), 'utf8');
    assert.match(content, /v0\.1-s1/);
  } finally {
    cleanup();
  }
});

test('createSprint seeds from _TEMPLATE.md when present', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(dir, 'docs/superpowers/plans'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'docs/superpowers/plans/_TEMPLATE.md'),
      '# <Sprint id> — <Name> · Plan\n\n## Context (why)\n<fill in>\n'
    );
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'add template'], { cwd: dir });

    const { planPath } = createSprint(dir, 'v0.1-s1', 'my-feature');
    const content = fs.readFileSync(path.join(dir, planPath), 'utf8');
    assert.match(content, /v0\.1-s1 — my-feature/);
    assert.doesNotMatch(content, /<Sprint id>/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/asdlc/test/new-sprint.test.js`
Expected: FAIL — `createSprint is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// append to scripts/asdlc/new-sprint.js, before module.exports
function createSprint(cwd, sprintId, slug, { runner = run } = {}) {
  runner('git', ['checkout', '-b', `sprint/${sprintId}`], { cwd });

  const plansDir = path.join(cwd, 'docs/superpowers/plans');
  fs.mkdirSync(plansDir, { recursive: true });

  const templatePath = path.join(plansDir, '_TEMPLATE.md');
  const relPlanPath = path.join('docs/superpowers/plans', `${sprintId}-${slug}.md`);
  const absPlanPath = path.join(cwd, relPlanPath);

  let content;
  if (fs.existsSync(templatePath)) {
    content = fs.readFileSync(templatePath, 'utf8')
      .replace(/<Sprint id> — <Name>/g, `${sprintId} — ${slug}`);
  } else {
    content = `# ${sprintId} — ${slug} · Plan\n\n## Context (why)\n<fill in>\n`;
  }
  fs.writeFileSync(absPlanPath, content);

  return { branch: `sprint/${sprintId}`, planPath: relPlanPath };
}

function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const positional = args.filter((a) => a !== '--force');
  const [sprintId, slug] = positional;

  if (!sprintId || !slug) {
    console.error('Usage: node new-sprint.js <sprint-id> <slug> [--force]');
    process.exit(1);
  }

  const cwd = process.cwd();
  const gate = checkGate(cwd);
  if (gate.blocked && !force) {
    console.error(`Blocked: ${gate.reason}. Resolve it, or re-run with --force to override.`);
    process.exit(1);
  }
  if (gate.blocked && force) {
    console.warn(`WARNING: overriding gate (${gate.reason}) via --force.`);
  }

  const { branch, planPath } = createSprint(cwd, sprintId, slug);
  console.log(`Created branch ${branch} and plan ${planPath}`);
}

module.exports = { checkGate, createSprint };

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/asdlc/test/new-sprint.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/asdlc/new-sprint.js scripts/asdlc/test/new-sprint.test.js
git commit -m "Add new-sprint.js sprint creation, CLI, and --force override"
```

---

### Task 4: `checkpoint-hooks.js` — STATUS.md append

**Files:**
- Create: `scripts/asdlc/checkpoint-hooks.js`
- Test: `scripts/asdlc/test/checkpoint-hooks.test.js`

**Interfaces:**
- Produces: `appendStatusEntry(cwd, { sprintId, date, summary, handoffRelPath })` → void. Creates `docs/STATUS.md` with a one-line header if it doesn't exist, then appends exactly one line: `` `- ${date} **${sprintId}** — ${summary} — [handoff](${handoffRelPath}) — status: awaiting-merge` ``. Never rewrites existing lines.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/asdlc/test/checkpoint-hooks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { appendStatusEntry } = require('../checkpoint-hooks');

test('appendStatusEntry creates STATUS.md and appends one line', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1',
      date: '2026-07-22',
      summary: 'Add widget support',
      handoffRelPath: 'docs/handoffs/v0.1-s1-widgets.md',
    });
    const content = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8');
    assert.match(
      content,
      /- 2026-07-22 \*\*v0\.1-s1\*\* — Add widget support — \[handoff\]\(docs\/handoffs\/v0\.1-s1-widgets\.md\) — status: awaiting-merge/
    );
  } finally {
    cleanup();
  }
});

test('appendStatusEntry only appends, never rewrites prior lines', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1', date: '2026-07-22', summary: 'First',
      handoffRelPath: 'docs/handoffs/v0.1-s1-a.md',
    });
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s2', date: '2026-07-23', summary: 'Second',
      handoffRelPath: 'docs/handoffs/v0.1-s2-b.md',
    });
    const lines = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8')
      .split('\n').filter((l) => l.startsWith('- '));
    assert.equal(lines.length, 2);
    assert.match(lines[0], /v0\.1-s1/);
    assert.match(lines[1], /v0\.1-s2/);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/asdlc/test/checkpoint-hooks.test.js`
Expected: FAIL — `Cannot find module '../checkpoint-hooks'`

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/asdlc/checkpoint-hooks.js
const fs = require('node:fs');
const path = require('node:path');

const STATUS_HEADER = [
  '# STATUS',
  '',
  'Append-only running history, oldest to newest. Never hand-edit — corrections',
  'happen by re-running `scripts/asdlc/checkpoint-hooks.js` / `finish-sprint.js`,',
  'not by typing into this file.',
  '',
  '',
].join('\n');

function appendStatusEntry(cwd, { sprintId, date, summary, handoffRelPath }) {
  const statusPath = path.join(cwd, 'docs/STATUS.md');
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });

  if (!fs.existsSync(statusPath)) {
    fs.writeFileSync(statusPath, STATUS_HEADER);
  }

  const line = `- ${date} **${sprintId}** — ${summary} — [handoff](${handoffRelPath}) — status: awaiting-merge\n`;
  fs.appendFileSync(statusPath, line);
}

module.exports = { appendStatusEntry };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/asdlc/test/checkpoint-hooks.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/asdlc/checkpoint-hooks.js scripts/asdlc/test/checkpoint-hooks.test.js
git commit -m "Add checkpoint-hooks.js STATUS.md append-only entry writer"
```

---

### Task 5: `checkpoint-hooks.js` — CLAUDE.md pointer rewrite + CLI

**Files:**
- Modify: `scripts/asdlc/checkpoint-hooks.js`
- Modify: `scripts/asdlc/test/checkpoint-hooks.test.js`

**Interfaces:**
- Produces: `updateClaudeMdPointer(cwd, summaryLine)` → void. Replaces only the text strictly between `<!-- asdlc:current-state:auto -->` and `<!-- /asdlc:current-state:auto -->` markers in `CLAUDE.md` with `` `**Current state:** ${summaryLine}` ``, leaving the rest of the file byte-for-byte unchanged. Throws if the markers aren't found (so a missing/edited-away marker fails loudly instead of silently no-op'ing).
- Produces CLI: `node scripts/asdlc/checkpoint-hooks.js <sprint-id> <date> <handoff-rel-path> <summary...>` — calls both `appendStatusEntry` and `updateClaudeMdPointer` (skips the pointer step with a warning, not a crash, if `CLAUDE.md` doesn't exist yet).

- [ ] **Step 1: Write the failing tests**

```js
// append to scripts/asdlc/test/checkpoint-hooks.test.js
const { appendStatusEntry, updateClaudeMdPointer } = require('../checkpoint-hooks');

test('updateClaudeMdPointer rewrites only the marked span', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const claudeMd = [
      '# Project',
      '',
      '## Where the build is',
      '<!-- asdlc:current-state:auto -->',
      '**Current state:** old stale line.',
      '<!-- /asdlc:current-state:auto -->',
      '',
      'To resume, read the latest handoff.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), claudeMd);

    updateClaudeMdPointer(dir, 'v0.1-s1 shipped widgets — see docs/handoffs/v0.1-s1-widgets.md');

    const result = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(result, /\*\*Current state:\*\* v0\.1-s1 shipped widgets/);
    assert.doesNotMatch(result, /old stale line/);
    assert.match(result, /To resume, read the latest handoff\./);
  } finally {
    cleanup();
  }
});

test('updateClaudeMdPointer throws if markers are missing', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Project\nno markers here\n');
    assert.throws(() => updateClaudeMdPointer(dir, 'anything'), /marker/i);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/asdlc/test/checkpoint-hooks.test.js`
Expected: FAIL — `updateClaudeMdPointer is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// append to scripts/asdlc/checkpoint-hooks.js, before module.exports
const START_MARKER = '<!-- asdlc:current-state:auto -->';
const END_MARKER = '<!-- /asdlc:current-state:auto -->';

function updateClaudeMdPointer(cwd, summaryLine) {
  const claudeMdPath = path.join(cwd, 'CLAUDE.md');
  const content = fs.readFileSync(claudeMdPath, 'utf8');

  const startIdx = content.indexOf(START_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `CLAUDE.md is missing the asdlc:current-state:auto marker pair — cannot safely update the pointer.`
    );
  }

  const before = content.slice(0, startIdx + START_MARKER.length);
  const after = content.slice(endIdx);
  const rewritten = `${before}\n**Current state:** ${summaryLine}\n${after}`;

  fs.writeFileSync(claudeMdPath, rewritten);
}

function main() {
  const [sprintId, date, handoffRelPath, ...summaryParts] = process.argv.slice(2);
  if (!sprintId || !date || !handoffRelPath || summaryParts.length === 0) {
    console.error('Usage: node checkpoint-hooks.js <sprint-id> <date> <handoff-rel-path> <summary...>');
    process.exit(1);
  }
  const summary = summaryParts.join(' ');
  const cwd = process.cwd();

  appendStatusEntry(cwd, { sprintId, date, summary, handoffRelPath });
  console.log(`Appended STATUS.md entry for ${sprintId}.`);

  try {
    updateClaudeMdPointer(cwd, `${summary} — see [handoff](${handoffRelPath})`);
    console.log('Updated CLAUDE.md current-state pointer.');
  } catch (err) {
    console.warn(`Skipped CLAUDE.md pointer update: ${err.message}`);
  }
}

module.exports = { appendStatusEntry, updateClaudeMdPointer };

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/asdlc/test/checkpoint-hooks.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/asdlc/checkpoint-hooks.js scripts/asdlc/test/checkpoint-hooks.test.js
git commit -m "Add checkpoint-hooks.js CLAUDE.md pointer rewrite and CLI"
```

---

### Task 6: `finish-sprint.js` — status flip + branch deletion

**Files:**
- Create: `scripts/asdlc/finish-sprint.js`
- Test: `scripts/asdlc/test/finish-sprint.test.js`

**Interfaces:**
- Consumes: `run(cmd, args, opts)` from `scripts/asdlc/lib/exec.js`.
- Produces: `markMerged(cwd, sprintId, sha)` → void. Finds the `docs/STATUS.md` line containing `**${sprintId}**` and `status: awaiting-merge`, rewrites just that line's trailing status to `` `status: merged (${sha})` ``, leaving every other line untouched. Throws if no matching line is found.
- Produces: `deleteBranch(cwd, branchName, { runner = run } = {})` → void. Runs `git branch -d <branchName>`; if a remote branch of the same name exists (checked via `git ls-remote --heads origin <branchName>`), also runs `git push origin --delete <branchName>`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/asdlc/test/finish-sprint.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { markMerged, deleteBranch } = require('../finish-sprint');

test('markMerged flips only the matching line', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const statusPath = path.join(dir, 'docs/STATUS.md');
    fs.mkdirSync(path.dirname(statusPath), { recursive: true });
    fs.writeFileSync(statusPath, [
      '- 2026-07-20 **v0.1-s1** — First — [handoff](docs/handoffs/v0.1-s1-a.md) — status: awaiting-merge',
      '- 2026-07-21 **v0.1-s2** — Second — [handoff](docs/handoffs/v0.1-s2-b.md) — status: awaiting-merge',
      '',
    ].join('\n'));

    markMerged(dir, 'v0.1-s2', 'abc1234');

    const lines = fs.readFileSync(statusPath, 'utf8').split('\n').filter(Boolean);
    assert.match(lines[0], /v0\.1-s1.*status: awaiting-merge/);
    assert.match(lines[1], /v0\.1-s2.*status: merged \(abc1234\)/);
  } finally {
    cleanup();
  }
});

test('markMerged throws when no matching awaiting-merge line exists', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs/STATUS.md'), '- nothing here\n');
    assert.throws(() => markMerged(dir, 'v0.1-s1', 'sha'), /no awaiting-merge entry/i);
  } finally {
    cleanup();
  }
});

test('deleteBranch deletes a local-only branch', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    run('git', ['branch', 'sprint/v0.1-s1'], { cwd: dir });
    deleteBranch(dir, 'sprint/v0.1-s1');
    const branches = run('git', ['branch', '--list', 'sprint/*'], { cwd: dir });
    assert.equal(branches, '');
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/asdlc/test/finish-sprint.test.js`
Expected: FAIL — `Cannot find module '../finish-sprint'`

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/asdlc/finish-sprint.js
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./lib/exec');

function markMerged(cwd, sprintId, sha) {
  const statusPath = path.join(cwd, 'docs/STATUS.md');
  const lines = fs.readFileSync(statusPath, 'utf8').split('\n');

  const idx = lines.findIndex(
    (l) => l.includes(`**${sprintId}**`) && l.includes('status: awaiting-merge')
  );
  if (idx === -1) {
    throw new Error(`No awaiting-merge entry found for ${sprintId} in docs/STATUS.md.`);
  }

  lines[idx] = lines[idx].replace('status: awaiting-merge', `status: merged (${sha})`);
  fs.writeFileSync(statusPath, lines.join('\n'));
}

function deleteBranch(cwd, branchName, { runner = run } = {}) {
  runner('git', ['branch', '-d', branchName], { cwd });
  const remote = runner('git', ['ls-remote', '--heads', 'origin', branchName], { cwd });
  if (remote.length > 0) {
    runner('git', ['push', 'origin', '--delete', branchName], { cwd });
  }
}

module.exports = { markMerged, deleteBranch };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/asdlc/test/finish-sprint.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/asdlc/finish-sprint.js scripts/asdlc/test/finish-sprint.test.js
git commit -m "Add finish-sprint.js status-flip and branch-delete logic"
```

---

### Task 7: `finish-sprint.js` — milestone check (stubbed `gh`) + CLI

**Files:**
- Modify: `scripts/asdlc/finish-sprint.js`
- Modify: `scripts/asdlc/test/finish-sprint.test.js`

**Interfaces:**
- Produces: `checkMilestone(cwd, issueNumbers, { runner = run } = {})` → `Array<{ issue: number, milestone: string|null }>`. For each issue number, runs `gh issue view <n> --json milestone` and parses the JSON `milestone.title` (or `null` if absent).
- Produces CLI: `node scripts/asdlc/finish-sprint.js <sprint-id> <sha> [issue-numbers...]` — calls `markMerged`, `deleteBranch` (branch name derived as `sprint/<sprint-id>`), then `checkMilestone` for any issue numbers passed, printing a warning line per issue with no milestone.

- [ ] **Step 1: Write the failing test**

```js
// append to scripts/asdlc/test/finish-sprint.test.js
const { checkMilestone } = require('../finish-sprint');

test('checkMilestone reports missing milestones via a stubbed gh', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const calls = [];
    const stubRunner = (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      const issueArg = args[args.indexOf('view') + 1];
      if (issueArg === '42') return JSON.stringify({ milestone: { title: 'v0.9' } });
      return JSON.stringify({ milestone: null });
    };

    const result = checkMilestone(dir, [42, 43], { runner: stubRunner });
    assert.deepEqual(result, [
      { issue: 42, milestone: 'v0.9' },
      { issue: 43, milestone: null },
    ]);
    assert.ok(calls.some((c) => c.includes('gh issue view 42')));
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/asdlc/test/finish-sprint.test.js`
Expected: FAIL — `checkMilestone is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// append to scripts/asdlc/finish-sprint.js, before module.exports
function checkMilestone(cwd, issueNumbers, { runner = run } = {}) {
  return issueNumbers.map((issue) => {
    const out = runner('gh', ['issue', 'view', String(issue), '--json', 'milestone'], { cwd });
    const parsed = JSON.parse(out);
    return { issue, milestone: parsed.milestone ? parsed.milestone.title : null };
  });
}

function main() {
  const [sprintId, sha, ...issueArgs] = process.argv.slice(2);
  if (!sprintId || !sha) {
    console.error('Usage: node finish-sprint.js <sprint-id> <sha> [issue-numbers...]');
    process.exit(1);
  }
  const cwd = process.cwd();

  markMerged(cwd, sprintId, sha);
  console.log(`Marked ${sprintId} as merged (${sha}) in docs/STATUS.md.`);

  deleteBranch(cwd, `sprint/${sprintId}`);
  console.log(`Deleted branch sprint/${sprintId} (local + remote if present).`);

  const issueNumbers = issueArgs.map(Number).filter((n) => !Number.isNaN(n));
  if (issueNumbers.length > 0) {
    const results = checkMilestone(cwd, issueNumbers);
    for (const { issue, milestone } of results) {
      if (!milestone) {
        console.warn(`Issue #${issue} has no milestone assigned — consider assigning one.`);
      }
    }
  }
}

module.exports = { markMerged, deleteBranch, checkMilestone };

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/asdlc/test/finish-sprint.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/asdlc/finish-sprint.js scripts/asdlc/test/finish-sprint.test.js
git commit -m "Add finish-sprint.js milestone check and CLI"
```

---

### Task 8: `gh-hygiene.js` — branch and default-branch checks

**Files:**
- Create: `scripts/asdlc/gh-hygiene.js`
- Test: `scripts/asdlc/test/gh-hygiene.test.js`

**Interfaces:**
- Produces: `findStaleBranches(cwd, { runner = run } = {})` → `string[]` of local branch names matching `sprint/*` whose commits are all already on `main` (i.e. `git log main..<branch>` is empty) — these are merged-but-undeleted.
- Produces: `checkDefaultBranch(cwd, declaredTrunk, { runner = run } = {})` → `{ ok: boolean, actual: string }`. Reads `origin/HEAD` via `git symbolic-ref refs/remotes/origin/HEAD` (stripping the `refs/remotes/origin/` prefix) and compares to `declaredTrunk`.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/asdlc/test/gh-hygiene.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../lib/exec');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { findStaleBranches, checkDefaultBranch } = require('../gh-hygiene');

test('findStaleBranches finds merged sprint branches', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    run('git', ['branch', 'sprint/v0.1-s1'], { cwd: dir }); // merged: no new commits
    run('git', ['checkout', '-b', 'sprint/v0.1-s2'], { cwd: dir });
    require('node:fs').writeFileSync(require('node:path').join(dir, 'x.txt'), 'x');
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'wip'], { cwd: dir }); // not merged
    run('git', ['checkout', 'main'], { cwd: dir });

    const stale = findStaleBranches(dir);
    assert.deepEqual(stale, ['sprint/v0.1-s1']);
  } finally {
    cleanup();
  }
});

test('checkDefaultBranch compares origin/HEAD to the declared trunk (stubbed)', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = () => 'refs/remotes/origin/build/v0.1';
    const result = checkDefaultBranch(dir, 'main', { runner: stubRunner });
    assert.deepEqual(result, { ok: false, actual: 'build/v0.1' });
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/asdlc/test/gh-hygiene.test.js`
Expected: FAIL — `Cannot find module '../gh-hygiene'`

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/asdlc/gh-hygiene.js
const { run } = require('./lib/exec');

function findStaleBranches(cwd, { runner = run } = {}) {
  const branches = runner('git', ['branch', '--list', 'sprint/*'], { cwd })
    .split('\n')
    .map((l) => l.replace(/^\*?\s*/, '').trim())
    .filter(Boolean);

  return branches.filter((branch) => {
    const unmerged = runner('git', ['log', `main..${branch}`, '--oneline'], { cwd });
    return unmerged.length === 0;
  });
}

function checkDefaultBranch(cwd, declaredTrunk, { runner = run } = {}) {
  const ref = runner('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd });
  const actual = ref.replace('refs/remotes/origin/', '');
  return { ok: actual === declaredTrunk, actual };
}

module.exports = { findStaleBranches, checkDefaultBranch };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/asdlc/test/gh-hygiene.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/asdlc/gh-hygiene.js scripts/asdlc/test/gh-hygiene.test.js
git commit -m "Add gh-hygiene.js stale-branch and default-branch checks"
```

---

### Task 9: `gh-hygiene.js` — issue/milestone checks + aggregation + CLI

**Files:**
- Modify: `scripts/asdlc/gh-hygiene.js`
- Modify: `scripts/asdlc/test/gh-hygiene.test.js`
- Create: `commands/asdlc-hygiene.md`

**Interfaces:**
- Produces: `findUntriagedIssues(cwd, { runner = run } = {})` → `Array<{ number: number, reason: string }>`. Runs `gh issue list --state open --json number,labels,milestone` and flags any issue with an empty `labels` array or a `null` milestone (reason `'no-labels'` or `'no-milestone'`; an issue can appear twice, once per reason).
- Produces: `checkMilestoneVersionSync(cwd, currentSprintVersion, { runner = run } = {})` → `{ inSync: boolean, milestoneVersions: string[] }`. Runs `gh api repos/{owner}/{repo}/milestones --jq '.[].title'` (via `gh api`), extracts version-like tokens (`vX.Y`) from milestone titles, and reports whether `currentSprintVersion` (e.g. `'v0.12'`) is present among them.
- Produces: `runHygieneAudit(cwd, { declaredTrunk, currentSprintVersion, runner = run } = {})` → aggregate report object `{ staleBranches, defaultBranch, untriagedIssues, milestoneSync }` calling all four functions above.

- [ ] **Step 1: Write the failing tests**

```js
// append to scripts/asdlc/test/gh-hygiene.test.js
const { findUntriagedIssues, checkMilestoneVersionSync, runHygieneAudit } = require('../gh-hygiene');

test('findUntriagedIssues flags no-labels and no-milestone issues', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = () => JSON.stringify([
      { number: 1, labels: [], milestone: { title: 'v0.9' } },
      { number: 2, labels: [{ name: 'bug' }], milestone: null },
      { number: 3, labels: [{ name: 'bug' }], milestone: { title: 'v0.9' } },
    ]);
    const result = findUntriagedIssues(dir, { runner: stubRunner });
    assert.deepEqual(result, [
      { number: 1, reason: 'no-labels' },
      { number: 2, reason: 'no-milestone' },
    ]);
  } finally {
    cleanup();
  }
});

test('checkMilestoneVersionSync detects a version scheme mismatch', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = () => 'v0.1\nv0.2\nv1.0\n';
    const result = checkMilestoneVersionSync(dir, 'v0.12', { runner: stubRunner });
    assert.equal(result.inSync, false);
    assert.deepEqual(result.milestoneVersions, ['v0.1', 'v0.2', 'v1.0']);
  } finally {
    cleanup();
  }
});

test('runHygieneAudit aggregates all four checks', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const stubRunner = (cmd, args) => {
      const joined = args.join(' ');
      if (joined.includes('symbolic-ref')) return 'refs/remotes/origin/main';
      if (joined.includes('issue list')) return '[]';
      if (joined.includes('milestones')) return 'v0.12\n';
      if (joined.includes('branch --list')) return '';
      return '';
    };
    const report = runHygieneAudit(dir, {
      declaredTrunk: 'main',
      currentSprintVersion: 'v0.12',
      runner: stubRunner,
    });
    assert.deepEqual(report.staleBranches, []);
    assert.deepEqual(report.defaultBranch, { ok: true, actual: 'main' });
    assert.deepEqual(report.untriagedIssues, []);
    assert.equal(report.milestoneSync.inSync, true);
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/asdlc/test/gh-hygiene.test.js`
Expected: FAIL — `findUntriagedIssues is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// append to scripts/asdlc/gh-hygiene.js, before module.exports
function findUntriagedIssues(cwd, { runner = run } = {}) {
  const out = runner('gh', ['issue', 'list', '--state', 'open', '--json', 'number,labels,milestone'], { cwd });
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
  const out = runner('gh', ['api', 'repos/{owner}/{repo}/milestones', '--jq', '.[].title'], { cwd });
  const milestoneVersions = out.split('\n').map((l) => l.trim()).filter(Boolean);
  return { inSync: milestoneVersions.includes(currentSprintVersion), milestoneVersions };
}

function runHygieneAudit(cwd, { declaredTrunk, currentSprintVersion, runner = run } = {}) {
  return {
    staleBranches: findStaleBranches(cwd, { runner }),
    defaultBranch: checkDefaultBranch(cwd, declaredTrunk, { runner }),
    untriagedIssues: findUntriagedIssues(cwd, { runner }),
    milestoneSync: checkMilestoneVersionSync(cwd, currentSprintVersion, { runner }),
  };
}

function main() {
  const [declaredTrunk, currentSprintVersion] = process.argv.slice(2);
  if (!declaredTrunk || !currentSprintVersion) {
    console.error('Usage: node gh-hygiene.js <declared-trunk> <current-sprint-version>');
    process.exit(1);
  }
  const report = runHygieneAudit(process.cwd(), { declaredTrunk, currentSprintVersion });

  console.log('=== ASDLC hygiene audit ===');
  console.log(`Stale merged branches: ${report.staleBranches.length ? report.staleBranches.join(', ') : 'none'}`);
  console.log(`Default branch: ${report.defaultBranch.ok ? 'OK' : `MISMATCH (origin/HEAD -> ${report.defaultBranch.actual}, expected ${declaredTrunk})`}`);
  console.log(`Untriaged issues: ${report.untriagedIssues.length ? report.untriagedIssues.map((i) => `#${i.number} (${i.reason})`).join(', ') : 'none'}`);
  console.log(`Milestone/sprint version sync: ${report.milestoneSync.inSync ? 'OK' : `OUT OF SYNC (milestones: ${report.milestoneSync.milestoneVersions.join(', ')})`}`);
}

module.exports = { findStaleBranches, checkDefaultBranch, findUntriagedIssues, checkMilestoneVersionSync, runHygieneAudit };

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/asdlc/test/gh-hygiene.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Create the `/asdlc-hygiene` command**

```markdown
---
description: Run the ASDLC hygiene audit (stale branches, default-branch drift, untriaged issues, milestone/sprint version sync)
argument-hint: [declared-trunk] [current-sprint-version]
---

Run the read-only ASDLC hygiene audit and report findings. This command never
auto-fixes anything — fixes (which branch to delete, which milestone to assign)
are judgment calls for the human/agent to make after seeing the report.

Arguments: **$ARGUMENTS** — `<declared-trunk> <current-sprint-version>` (e.g. `main v0.12`).
If omitted, infer the declared trunk from `CLAUDE.md`'s branch-discipline line and the
current sprint version from the newest file in `docs/superpowers/plans/`.

Run:
```bash
node scripts/asdlc/gh-hygiene.js <declared-trunk> <current-sprint-version>
```

Present the four findings (stale branches, default-branch mismatch, untriaged issues,
milestone/version sync) as a short report. For any finding, suggest — but do not run
without confirmation — the fix: `git push origin --delete <branch>` for stale branches,
`gh api repos/{owner}/{repo} -X PATCH -f default_branch=<trunk>` for a default-branch
mismatch, `gh issue edit <n> --add-label <label>` / `--milestone <name>` for untriaged
issues.
```

- [ ] **Step 6: Commit**

```bash
git add scripts/asdlc/gh-hygiene.js scripts/asdlc/test/gh-hygiene.test.js commands/asdlc-hygiene.md
git commit -m "Add gh-hygiene.js issue/milestone checks, CLI, and /asdlc-hygiene command"
```

---

### Task 10: `archive-sprint-docs.js`

**Files:**
- Create: `scripts/asdlc/archive-sprint-docs.js`
- Test: `scripts/asdlc/test/archive-sprint-docs.test.js`

**Interfaces:**
- Produces: `archiveMilestone(cwd, milestoneVersion)` → `{ moved: string[] }`. Scans `docs/handoffs/` and `docs/superpowers/plans/` for files whose name starts with `${milestoneVersion}-` (e.g. `v0.9-`), moves each into `docs/handoffs/archive/${milestoneVersion}/` or `docs/superpowers/plans/archive/${milestoneVersion}/` respectively (creating the archive dir if needed), and returns the list of relative paths moved. Files in other milestones are left untouched.

- [ ] **Step 1: Write the failing test**

```js
// scripts/asdlc/test/archive-sprint-docs.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { archiveMilestone } = require('../archive-sprint-docs');

test('archiveMilestone moves only the targeted milestone files', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const handoffsDir = path.join(dir, 'docs/handoffs');
    const plansDir = path.join(dir, 'docs/superpowers/plans');
    fs.mkdirSync(handoffsDir, { recursive: true });
    fs.mkdirSync(plansDir, { recursive: true });
    fs.writeFileSync(path.join(handoffsDir, 'v0.9-s1-a.md'), 'a');
    fs.writeFileSync(path.join(handoffsDir, 'v0.10-s1-b.md'), 'b');
    fs.writeFileSync(path.join(plansDir, 'v0.9-s1-a.md'), 'a');

    const { moved } = archiveMilestone(dir, 'v0.9');

    assert.equal(moved.length, 2);
    assert.ok(fs.existsSync(path.join(handoffsDir, 'archive/v0.9/v0.9-s1-a.md')));
    assert.ok(fs.existsSync(path.join(plansDir, 'archive/v0.9/v0.9-s1-a.md')));
    assert.ok(!fs.existsSync(path.join(handoffsDir, 'v0.9-s1-a.md')));
    assert.ok(fs.existsSync(path.join(handoffsDir, 'v0.10-s1-b.md'))); // untouched
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/asdlc/test/archive-sprint-docs.test.js`
Expected: FAIL — `Cannot find module '../archive-sprint-docs'`

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/asdlc/archive-sprint-docs.js
const fs = require('node:fs');
const path = require('node:path');

function archiveOneDir(dir, milestoneVersion) {
  if (!fs.existsSync(dir)) return [];
  const archiveDir = path.join(dir, 'archive', milestoneVersion);
  const moved = [];

  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(`${milestoneVersion}-`));

  if (files.length > 0) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  for (const entry of files) {
    const from = path.join(dir, entry.name);
    const to = path.join(archiveDir, entry.name);
    fs.renameSync(from, to);
    moved.push(to);
  }
  return moved;
}

function archiveMilestone(cwd, milestoneVersion) {
  const handoffsMoved = archiveOneDir(path.join(cwd, 'docs/handoffs'), milestoneVersion);
  const plansMoved = archiveOneDir(path.join(cwd, 'docs/superpowers/plans'), milestoneVersion);
  return { moved: [...handoffsMoved, ...plansMoved] };
}

function main() {
  const [milestoneVersion] = process.argv.slice(2);
  if (!milestoneVersion) {
    console.error('Usage: node archive-sprint-docs.js <milestone-version>');
    process.exit(1);
  }
  const { moved } = archiveMilestone(process.cwd(), milestoneVersion);
  console.log(`Archived ${moved.length} file(s) under milestone ${milestoneVersion}.`);
  moved.forEach((p) => console.log(`  ${p}`));
}

module.exports = { archiveMilestone };

if (require.main === module) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/asdlc/test/archive-sprint-docs.test.js`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add scripts/asdlc/archive-sprint-docs.js scripts/asdlc/test/archive-sprint-docs.test.js
git commit -m "Add archive-sprint-docs.js milestone-scoped archival"
```

---

### Task 11: End-to-end dry run test (`bootstrap` seed → `new-sprint` → `checkpoint-hooks`)

**Files:**
- Test: `scripts/asdlc/test/end-to-end.test.js`

**Interfaces:**
- Consumes: `checkGate`/`createSprint` (Tasks 2-3), `appendStatusEntry`/`updateClaudeMdPointer` (Tasks 4-5), `makeFixtureRepo` (Task 1). No new production code — this task only adds a test that chains the existing functions to prove the whole loop works together.

- [ ] **Step 1: Write the end-to-end test**

```js
// scripts/asdlc/test/end-to-end.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixtureRepo } = require('./helpers/fixture-repo');
const { checkGate, createSprint } = require('../new-sprint');
const { appendStatusEntry, updateClaudeMdPointer } = require('../checkpoint-hooks');
const { run } = require('../lib/exec');

test('end-to-end: bootstrap seed -> new-sprint -> checkpoint-hooks', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // Simulate what /bootstrap-asdlc scaffolds: CLAUDE.md with the marker pair.
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
      '# Project',
      '',
      '## Where the build is',
      '<!-- asdlc:current-state:auto -->',
      '**Current state:** not started.',
      '<!-- /asdlc:current-state:auto -->',
      '',
    ].join('\n'));

    // /sprint: gate check passes on a fresh repo, then creates the sprint.
    const gate = checkGate(dir);
    assert.equal(gate.blocked, false);
    const { branch, planPath } = createSprint(dir, 'v0.1-s1', 'widgets');
    assert.equal(branch, 'sprint/v0.1-s1');
    assert.ok(fs.existsSync(path.join(dir, planPath)));

    // Simulate /handoff writing a handoff file.
    const handoffRelPath = 'docs/handoffs/v0.1-s1-widgets.md';
    fs.mkdirSync(path.join(dir, 'docs/handoffs'), { recursive: true });
    fs.writeFileSync(path.join(dir, handoffRelPath), '# v0.1-s1 — widgets · Handoff\n');

    // /checkpoint: append STATUS + update CLAUDE.md pointer.
    appendStatusEntry(dir, {
      sprintId: 'v0.1-s1', date: '2026-07-22', summary: 'Add widgets',
      handoffRelPath,
    });
    updateClaudeMdPointer(dir, `Add widgets — see [handoff](${handoffRelPath})`);

    const status = fs.readFileSync(path.join(dir, 'docs/STATUS.md'), 'utf8');
    assert.match(status, /v0\.1-s1.*status: awaiting-merge/);

    const claudeMd = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(claudeMd, /Add widgets/);
    assert.doesNotMatch(claudeMd, /not started/);

    // Commit the plan+handoff on the still-checked-out sprint branch (simulating
    // /checkpoint's staged commit) WITHOUT merging to main yet. A second /sprint
    // attempt right now must be gated — this is the exact "new sprint over an
    // uncommitted/unmerged prior one" failure mode the design set out to hard-block.
    run('git', ['add', '.'], { cwd: dir });
    run('git', ['commit', '-m', 'v0.1-s1: add widgets'], { cwd: dir });

    const gate2 = checkGate(dir);
    assert.equal(gate2.blocked, true); // sprint/v0.1-s1 has commits not yet merged into main
    assert.equal(gate2.reason, 'unmerged-branch');
  } finally {
    cleanup();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/asdlc/test/end-to-end.test.js`
Expected: This should actually PASS immediately since all consumed functions already exist from prior tasks — run it to confirm the chain behaves as expected (this is the one test in the plan that isn't red-then-green, since it composes already-implemented units; if it fails, it indicates an integration bug in an earlier task, not a missing implementation).

- [ ] **Step 3: If it fails, fix the integration bug in the relevant earlier module (do not add new production files for this task)**

- [ ] **Step 4: Run full test suite to confirm no regressions**

Run: `node --test scripts/asdlc/test/`
Expected: PASS (all tests across all files, ~22 tests total)

- [ ] **Step 5: Commit**

```bash
git add scripts/asdlc/test/end-to-end.test.js
git commit -m "Add end-to-end dry-run test chaining new-sprint and checkpoint-hooks"
```

---

### Task 12: Update `commands/bootstrap-asdlc.md`

**Files:**
- Modify: `commands/bootstrap-asdlc.md`

- [ ] **Step 1: Add a scaffolding step for the scripts, and update the CLAUDE.md skeleton step to mention the marker**

Replace the numbered scaffold list (currently steps 1-6) by inserting a new step 6 (renumbering the old step 6 to 7) and updating step 1's wording:

```markdown
1. **`CLAUDE.md`** — from `references/claude-md-skeleton.md`. Fill in stack, run/verify,
   and branch discipline from what you can detect in the repo; keep it under ~200 lines,
   durable content only. The "Where the build is" line sits between
   `<!-- asdlc:current-state:auto -->` markers — `scripts/asdlc/checkpoint-hooks.js` owns
   that span from here on; never hand-edit between the markers. If a bloated `CLAUDE.md`
   already exists, offer to split its running narrative into `docs/STATUS.md` (see the
   state model) rather than editing in place.
2. **`docs/STATUS.md`** — a header explaining it's append-only and machine-generated only
   (never hand-edited — corrections happen by re-running `checkpoint-hooks.js`/
   `finish-sprint.js`). (Reference: `references/state-model.md`.)
3. **`docs/handoffs/_TEMPLATE.md`** — from `references/handoff-template.md`.
4. **`docs/superpowers/plans/`** — create the dir (with a `.gitkeep` if empty) and drop a
   copy of `references/plan-template.md` alongside as `_TEMPLATE.md`.
5. **`.gitignore`** — ensure test/coverage artifacts are ignored if the stack warrants it.
6. **`scripts/asdlc/*.js`** — copy the plugin's hygiene/bookkeeping scripts
   (`new-sprint.js`, `checkpoint-hooks.js`, `finish-sprint.js`, `gh-hygiene.js`,
   `archive-sprint-docs.js`, and `lib/exec.js`) into the repo (skip any that already
   exist). These require only Node on PATH — no `npm install` step.
7. Optionally, **`.claude/rules/`** — suggest path-scoped rule files for any procedural
   recipes (adding a command/connector/migration) that only matter when editing certain
   paths, so they don't sit in `CLAUDE.md` all session.
```

- [ ] **Step 2: Update the closing line to mention the new commands**

```markdown
Finish by explaining the loop to the user (`/sprint` → build → `/handoff` → `/checkpoint`
→ approve → `/clear`, with `/asdlc-hygiene` available any time for a hygiene audit) and
confirm nothing was overwritten.
```

- [ ] **Step 3: Commit**

```bash
git add commands/bootstrap-asdlc.md
git commit -m "Update /bootstrap-asdlc to scaffold scripts/asdlc/*.js"
```

---

### Task 13: Update `commands/sprint.md`

**Files:**
- Modify: `commands/sprint.md`

- [ ] **Step 1: Replace step 1's "Load context" framing to run the gate first, and step 3's plan-writing to use new-sprint.js**

```markdown
Do this:
1. **Run the sprint gate** — `node scripts/asdlc/new-sprint.js <sprint-id> <slug>`. If it
   refuses (unmatched-plan or unmerged-branch), surface the exact reason to the user and
   **stop** — do not proceed to brainstorming until it's resolved, unless the user
   explicitly asks to override with `--force` (and understands why the gate exists).
2. **Load context** — read `CLAUDE.md` and the **latest** `docs/handoffs/` file to
   understand current state and the suggested next steps. Do NOT read all of history.
3. **Brainstorm the scope** with the user. REQUIRED SUB-SKILL: superpowers:brainstorming.
4. **Fill in the plan** at the path `new-sprint.js` created (seeded from
   `references/plan-template.md`). REQUIRED SUB-SKILL: superpowers:writing-plans.
5. **Confirm the plan** with the user before touching code. Then build test-first
   (REQUIRED SUB-SKILL: superpowers:test-driven-development).
```

- [ ] **Step 2: Commit**

```bash
git add commands/sprint.md
git commit -m "Update /sprint to run new-sprint.js gate before scaffolding a plan"
```

---

### Task 14: Update `commands/checkpoint.md`

**Files:**
- Modify: `commands/checkpoint.md`

- [ ] **Step 1: Replace steps 3-4 (STATUS/CLAUDE.md hand-edit instructions) with the script invocation**

```markdown
3. **Update STATUS + CLAUDE.md pointer** — run:
   ```bash
   node scripts/asdlc/checkpoint-hooks.js <sprint-id> <date> <handoff-rel-path> <one-line summary>
   ```
   This appends the STATUS.md entry and rewrites only the marked pointer span in
   `CLAUDE.md`. Report what it printed; if it warns that the marker pair is missing,
   say so and offer to add the markers (see `references/claude-md-skeleton.md`) rather
   than hand-editing the file.
```

- [ ] **Step 2: Renumber the remaining "Stage" step to 4 and update the closing checklist line**

```markdown
4. **Stage** — show `git status`; stage the sprint's changes (`git add`) on the working
   branch. Do **not** commit or push automatically — present the proposed commit and
   **STOP for the user's approval** (respect the project's git rules).

End with a short checklist: ✅/❌ tests · handoff · STATUS+pointer script ran · staged.
Then remind: on approval, commit, then run
`node scripts/asdlc/finish-sprint.js <sprint-id> <sha> [issue-numbers...]` once the PR
merges, then `/clear` before the next sprint.
```

- [ ] **Step 3: Commit**

```bash
git add commands/checkpoint.md
git commit -m "Update /checkpoint to run checkpoint-hooks.js instead of hand-edit instructions"
```

---

### Task 15: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add `/verify-issue` and `/asdlc-hygiene` to the command table**

```markdown
## Commands

| Command | What it does |
|---|---|
| `/bootstrap-asdlc` | Scaffold this workflow into a new (or existing) repo |
| `/verify-issue [id]` | Adversarially check a tracked issue against the codebase before it becomes a plan |
| `/sprint [name]` | Start a sprint — runs the sprint gate, scaffolds its plan, kicks off brainstorm → plan |
| `/checkpoint` | Non-blocking gate: tests + handoff-exists + STATUS/CLAUDE.md pointer script, then stage |
| `/handoff` | Generate an evidence-bearing handoff from the template |
| `/asdlc-hygiene [trunk] [version]` | On-demand audit: stale branches, default-branch drift, untriaged issues, milestone/version sync |
```

- [ ] **Step 2: Update the "State model" section's STATUS.md row and add a naming/archival note**

```markdown
## State model — one source of truth

| Tier | Lives in | Holds |
|---|---|---|
| Durable | `CLAUDE.md` | architecture, rules, gotchas — read every session, in full |
| History | `docs/STATUS.md` | append-only, **machine-generated only** (never hand-edited) |
| Current state | latest `docs/handoffs/*.md` | status, evidence, follow-ups — read at session start |

Exactly one source of truth for "where things are": the newest handoff. Don't hand-sync
the same status into `CLAUDE.md`, memory, and a handoff — that drifts.

Plans and handoffs share one naming scheme: `vMAJOR.MINOR-sN-<slug>.md`. When a milestone
closes, run `node scripts/asdlc/archive-sprint-docs.js <milestone>` to move its files into
`archive/<milestone>/` so the live directories stay small.
```

- [ ] **Step 3: Update the "Common mistakes" section to reflect what's now structurally prevented**

```markdown
## Common mistakes

- Hand-editing `docs/STATUS.md` or CLAUDE.md's current-state line → let
  `scripts/asdlc/checkpoint-hooks.js` own both; hand-edits are exactly what caused drift
  in real usage.
- Skipping the handoff "to save time" → the next session can't resume; this is the one
  step never to cut.
- Pushing straight to `main`, or bundling many sprints into one PR.
- Letting merged sprint branches pile up, or milestones drift from the sprint version
  scheme → run `/asdlc-hygiene` periodically to catch both.
- Hard-blocking hooks for routine actions → prefer non-blocking helper commands; the
  one exception is `new-sprint.js`'s gate, which *does* hard-block starting a new sprint
  on top of an uncommitted one — that specific failure mode was observed in practice and
  is deliberately not advisory.
```

- [ ] **Step 4: Update the "Layout" section**

```markdown
## Layout

```
.claude-plugin/
  plugin.json          plugin manifest
  marketplace.json      local marketplace manifest (self-hosting single plugin)
commands/
  bootstrap-asdlc.md    /bootstrap-asdlc
  sprint.md              /sprint
  checkpoint.md          /checkpoint
  handoff.md             /handoff
  verify-issue.md        /verify-issue
  asdlc-hygiene.md       /asdlc-hygiene
scripts/asdlc/
  lib/exec.js            shared git/gh exec helper
  new-sprint.js           sprint-start gate + branch/plan scaffolding
  checkpoint-hooks.js     STATUS.md append + CLAUDE.md pointer rewrite
  finish-sprint.js        post-merge status flip, branch cleanup, milestone check
  gh-hygiene.js           read-only hygiene audit
  archive-sprint-docs.js  milestone-scoped archival
skills/agentic-sdlc/
  SKILL.md               the skill Claude Code loads
  references/            state model + plan/handoff/CLAUDE.md templates
```
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Update README for scripts/asdlc, /asdlc-hygiene, /verify-issue, and revised common mistakes"
```

---

### Task 16: Update `skills/agentic-sdlc/SKILL.md`

**Files:**
- Modify: `skills/agentic-sdlc/SKILL.md`

- [ ] **Step 1: Update the loop's step 5-6 wording and the Commands list**

```markdown
5. **Handoff** → an evidence-bearing `docs/handoffs/<sprint>.md` so a fresh session resumes exactly here (`/handoff`).
6. **Checkpoint** (`/checkpoint`) → run targeted tests (changed files + dependents, capped at ~3 min — not the full suite), confirm the handoff exists, run `scripts/asdlc/checkpoint-hooks.js` to append `docs/STATUS.md` and update `CLAUDE.md`'s pointer, stage the commit. Then **STOP for approval** and **`/clear`** before the next sprint. After the PR merges, run `scripts/asdlc/finish-sprint.js` to flip the STATUS entry to merged and clean up the branch.

## Commands
- `/bootstrap-asdlc` — scaffold this workflow (including `scripts/asdlc/`) into a new repo.
- `/verify-issue [id]` — adversarially check a tracked issue against the current
  codebase before it becomes a plan (research → draft → independent fact-check →
  correct → push with the tracker's own sequencing conventions). See
  `references/issue-verification-methodology.md`.
- `/sprint [name]` — start a sprint: run the `new-sprint.js` gate, scaffold its plan, kick off brainstorm→plan.
- `/checkpoint` — non-blocking gate: targeted tests (<=3min) + handoff-exists + STATUS/pointer script, then stage.
- `/handoff` — generate the handoff doc from the template.
- `/asdlc-hygiene [trunk] [version]` — on-demand read-only audit: stale branches, default-branch drift, untriaged issues, milestone/version sync.
```

- [ ] **Step 2: Update the State model section**

```markdown
## State model (single source of truth)
- `CLAUDE.md` — durable rules + architecture only (<200 lines). Its "current state"
  line lives between `<!-- asdlc:current-state:auto -->` markers, owned by
  `scripts/asdlc/checkpoint-hooks.js` — never hand-edit that span.
- `docs/STATUS.md` — append-only running history, machine-generated only (never
  hand-edited); newest at the bottom.
- `docs/handoffs/<sprint>.md` — **the** current-state source; read the latest to resume.
- Naming for both plans and handoffs: `vMAJOR.MINOR-sN-<slug>.md`. When a milestone
  closes, run `scripts/asdlc/archive-sprint-docs.js <milestone>` to keep the live
  directories from growing unbounded.
- Per-project specifics (stack, gotchas, domain recipes) → `CLAUDE.md` + path-scoped
  `.claude/rules/*.md` (loads only when touching matching files).
```

- [ ] **Step 3: Update Common mistakes**

```markdown
## Common mistakes
- Hand-editing `CLAUDE.md`'s current-state pointer or `docs/STATUS.md` → let
  `checkpoint-hooks.js`/`finish-sprint.js` own both; this is the exact drift observed
  in real multi-hundred-sprint usage.
- Tracking state in multiple hand-synced files → drift. The latest handoff is authoritative.
- Skipping the handoff "to save time" → the next session can't resume; this is the one step never to cut.
- Letting milestones drift from the sprint version scheme, or branches pile up unmerged
  → run `/asdlc-hygiene` periodically.
- Hard-blocking hooks for routine actions → prefer non-blocking helper commands and keep the human-approval checkpoints; they are a feature, not friction. The `new-sprint.js` gate is the deliberate exception — it hard-blocks starting a new sprint over an uncommitted one, because that specific failure mode was observed eroding under momentum in practice.
```

- [ ] **Step 4: Commit**

```bash
git add skills/agentic-sdlc/SKILL.md
git commit -m "Update SKILL.md for scripted state bookkeeping and /asdlc-hygiene"
```

---

### Task 17: Update `skills/agentic-sdlc/references/state-model.md`

**Files:**
- Modify: `skills/agentic-sdlc/references/state-model.md`

- [ ] **Step 1: Update the three-tiers table's History row and add a naming/archival section**

```markdown
| **History** | `docs/STATUS.md` | on demand (linked, not auto-loaded) | append-only running log, oldest→newest, **machine-generated only** | live "current state", hand-typed narrative |
```

Add a new section after "The 'would removing this cause a mistake?' test":

```markdown
## STATUS.md is machine-generated, never hand-edited
`docs/STATUS.md` is written only by `scripts/asdlc/checkpoint-hooks.js` (append) and
`scripts/asdlc/finish-sprint.js` (flip awaiting-merge → merged). If an entry is wrong,
fix it by re-running the script that owns it, not by typing into the file — hand-editing
is exactly how this file grew into an unmaintainable, out-of-order wall of narrative in
real usage. Each entry is one line: date, sprint id, one-line summary, a link to the
handoff, and a status field.

## Naming and archival
Plans and handoffs share one canonical scheme: `vMAJOR.MINOR-sN-<slug>.md`. `new-sprint.js`
enforces this at creation time. When a milestone closes, run
`scripts/asdlc/archive-sprint-docs.js <milestone>` to move that milestone's files into
`docs/handoffs/archive/<milestone>/` and `docs/superpowers/plans/archive/<milestone>/` —
the live directories should only ever hold the current milestone's worth of files.

## Milestones track the sprint version scheme
If sprints are versioned `vX.Y-sN`, a milestone named `vX.Y` should exist for the
duration of that version's sprints. `scripts/asdlc/gh-hygiene.js` flags drift between
the two schemes — run it periodically, not just at bootstrap.
```

- [ ] **Step 2: Commit**

```bash
git add skills/agentic-sdlc/references/state-model.md
git commit -m "Update state-model.md for machine-generated STATUS.md and naming/archival rules"
```

---

### Task 18: Update `skills/agentic-sdlc/references/claude-md-skeleton.md`

**Files:**
- Modify: `skills/agentic-sdlc/references/claude-md-skeleton.md`

- [ ] **Step 1: Wrap the current-state line in the marker pair**

```markdown
## Where the build is
<!-- asdlc:current-state:auto -->
**Current state:** <one line>.
<!-- /asdlc:current-state:auto -->

To resume, read the **latest** `docs/handoffs/` file (single source of truth). Full
running history: `docs/STATUS.md`. Branch discipline: <…>.

> The text between the markers above is owned by `scripts/asdlc/checkpoint-hooks.js` —
> it is rewritten on every `/checkpoint`. Never hand-edit between the markers; if they're
> missing (e.g. an older `CLAUDE.md`), add them back rather than letting the script warn
> and skip.
```

- [ ] **Step 2: Commit**

```bash
git add skills/agentic-sdlc/references/claude-md-skeleton.md
git commit -m "Mark CLAUDE.md's current-state line as script-owned via HTML comment markers"
```

---

### Task 19: Update `plan-template.md` and `handoff-template.md` naming section

**Files:**
- Modify: `skills/agentic-sdlc/references/plan-template.md`
- Modify: `skills/agentic-sdlc/references/handoff-template.md`

- [ ] **Step 1: Add a naming-scheme line to the top of `plan-template.md`**

```markdown
# <Sprint id> — <Name> · Plan

**Date:** YYYY-MM-DD  ·  **Branch:** `<branch>`

> File name: `docs/superpowers/plans/vMAJOR.MINOR-sN-<slug>.md` — this is the one
> canonical scheme; `scripts/asdlc/new-sprint.js` creates files this way automatically.
```

- [ ] **Step 2: Add the matching line to the top of `handoff-template.md`**

```markdown
# <Sprint id> — <Name> · Handoff

**Date:** YYYY-MM-DD
**Branch / commit:** `<branch>` @ `<sha>`
**Status:** <complete / partial>

> File name: `docs/handoffs/vMAJOR.MINOR-sN-<slug>.md` — matching the plan's slug lets
> `scripts/asdlc/new-sprint.js`'s gate detect a plan/handoff pair automatically.
```

- [ ] **Step 3: Commit**

```bash
git add skills/agentic-sdlc/references/plan-template.md skills/agentic-sdlc/references/handoff-template.md
git commit -m "Document the canonical vMAJOR.MINOR-sN-<slug>.md naming scheme in templates"
```

---

### Task 20: Full-suite verification and plan close-out

**Files:** none (verification only)

- [ ] **Step 1: Run the complete test suite**

Run: `node --test scripts/asdlc/test/`
Expected: PASS — all tests across `exec.test.js`, `new-sprint.test.js`, `checkpoint-hooks.test.js`, `finish-sprint.test.js`, `gh-hygiene.test.js`, `archive-sprint-docs.test.js`, `end-to-end.test.js` (~22 tests, 0 failures).

- [ ] **Step 2: Cross-check internal consistency**

Grep for `/verify-issue` and `/asdlc-hygiene` across `README.md`, `skills/agentic-sdlc/SKILL.md`, and `commands/` to confirm both appear everywhere they should (closing the exact "plugin's own internal drift" gap identified in the design).

```bash
grep -rn "verify-issue\|asdlc-hygiene" README.md skills/agentic-sdlc/SKILL.md commands/
```

Expected: both strings appear in README.md's command table, SKILL.md's Commands section, and `commands/verify-issue.md` / `commands/asdlc-hygiene.md` exist.

- [ ] **Step 3: Write the handoff for this sprint**

Use `/handoff` (or `skills/agentic-sdlc/references/handoff-template.md` directly) to
write `docs/handoffs/loop-hardening.md` documenting: what shipped (5 scripts + test
suite + 8 doc updates), the test count/evidence from Step 1, key decisions (explicit
`<sprint-id>` arg instead of auto-inference; HTML-comment markers for the CLAUDE.md
pointer), and deferred work (the gaw retrofit, tracked separately per the design's
"Future work" section).

- [ ] **Step 4: Final commit**

```bash
git add docs/handoffs/loop-hardening.md
git commit -m "Add handoff for loop-hardening sprint"
```
