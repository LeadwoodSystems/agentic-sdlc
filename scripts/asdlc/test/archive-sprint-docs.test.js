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
    // Assert that returned paths are relative to cwd, not absolute
    assert.ok(moved.includes(path.join('docs', 'handoffs', 'archive', 'v0.9', 'v0.9-s1-a.md')));
    assert.ok(moved.includes(path.join('docs', 'superpowers', 'plans', 'archive', 'v0.9', 'v0.9-s1-a.md')));
    // Assert no paths are absolute (would start with temp dir or drive letter on Windows)
    moved.forEach((p) => {
      assert.ok(!path.isAbsolute(p), `Path should be relative, not absolute: ${p}`);
    });
    assert.ok(fs.existsSync(path.join(handoffsDir, 'archive/v0.9/v0.9-s1-a.md')));
    assert.ok(fs.existsSync(path.join(plansDir, 'archive/v0.9/v0.9-s1-a.md')));
    assert.ok(!fs.existsSync(path.join(handoffsDir, 'v0.9-s1-a.md')));
    assert.ok(fs.existsSync(path.join(handoffsDir, 'v0.10-s1-b.md'))); // untouched
  } finally {
    cleanup();
  }
});

test('archiveMilestone rejects malicious milestoneVersion with path traversal', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const handoffsDir = path.join(dir, 'docs/handoffs');
    fs.mkdirSync(handoffsDir, { recursive: true });
    fs.writeFileSync(path.join(handoffsDir, 'evil-../../../../tmp.md'), 'content');

    // Attempt to archive with a malicious milestoneVersion
    assert.throws(
      () => archiveMilestone(dir, '../../../../tmp/evil'),
      /Invalid milestoneVersion/,
    );

    // Verify no files were moved or created outside the docs dir
    assert.ok(fs.existsSync(path.join(handoffsDir, 'evil-../../../../tmp.md')));
    assert.ok(!fs.existsSync(path.join(handoffsDir, 'archive')));
  } finally {
    cleanup();
  }
});

test('archiveMilestone rejects milestoneVersion with .. substring', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const handoffsDir = path.join(dir, 'docs/handoffs');
    fs.mkdirSync(handoffsDir, { recursive: true });

    assert.throws(
      () => archiveMilestone(dir, 'v0.9..escape'),
      /Invalid milestoneVersion/,
    );

    assert.ok(!fs.existsSync(path.join(handoffsDir, 'archive')));
  } finally {
    cleanup();
  }
});

test('archiveMilestone rejects milestoneVersion with invalid characters', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const handoffsDir = path.join(dir, 'docs/handoffs');
    fs.mkdirSync(handoffsDir, { recursive: true });

    assert.throws(
      () => archiveMilestone(dir, 'v0.9/invalid'),
      /Invalid milestoneVersion/,
    );

    assert.throws(
      () => archiveMilestone(dir, 'v0.9 space'),
      /Invalid milestoneVersion/,
    );

    assert.ok(!fs.existsSync(path.join(handoffsDir, 'archive')));
  } finally {
    cleanup();
  }
});

test('archiveMilestone handles missing handoffs/plans directories gracefully', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    // Don't create the directories at all
    const { moved } = archiveMilestone(dir, 'v0.9');

    assert.equal(moved.length, 0);
  } finally {
    cleanup();
  }
});

test('archiveMilestone handles empty directories gracefully', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const handoffsDir = path.join(dir, 'docs/handoffs');
    const plansDir = path.join(dir, 'docs/superpowers/plans');
    fs.mkdirSync(handoffsDir, { recursive: true });
    fs.mkdirSync(plansDir, { recursive: true });

    const { moved } = archiveMilestone(dir, 'v0.9');

    assert.equal(moved.length, 0);
  } finally {
    cleanup();
  }
});

test('archiveMilestone handles mixed milestone files correctly', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const handoffsDir = path.join(dir, 'docs/handoffs');
    fs.mkdirSync(handoffsDir, { recursive: true });
    fs.writeFileSync(path.join(handoffsDir, 'v0.8-file.md'), 'content');
    fs.writeFileSync(path.join(handoffsDir, 'v0.9-file1.md'), 'content1');
    fs.writeFileSync(path.join(handoffsDir, 'v0.9-file2.md'), 'content2');
    fs.writeFileSync(path.join(handoffsDir, 'v0.10-file.md'), 'content3');
    fs.writeFileSync(path.join(handoffsDir, 'nomilestone.md'), 'content4');

    const { moved } = archiveMilestone(dir, 'v0.9');

    assert.equal(moved.length, 2);
    // Assert that returned paths are relative to cwd
    assert.ok(moved.includes(path.join('docs', 'handoffs', 'archive', 'v0.9', 'v0.9-file1.md')));
    assert.ok(moved.includes(path.join('docs', 'handoffs', 'archive', 'v0.9', 'v0.9-file2.md')));
    // Assert no paths are absolute
    moved.forEach((p) => {
      assert.ok(!path.isAbsolute(p), `Path should be relative, not absolute: ${p}`);
    });
    assert.ok(fs.existsSync(path.join(handoffsDir, 'archive/v0.9/v0.9-file1.md')));
    assert.ok(fs.existsSync(path.join(handoffsDir, 'archive/v0.9/v0.9-file2.md')));
    assert.ok(!fs.existsSync(path.join(handoffsDir, 'v0.9-file1.md')));
    assert.ok(!fs.existsSync(path.join(handoffsDir, 'v0.9-file2.md')));
    assert.ok(fs.existsSync(path.join(handoffsDir, 'v0.8-file.md'))); // untouched
    assert.ok(fs.existsSync(path.join(handoffsDir, 'v0.10-file.md'))); // untouched
    assert.ok(fs.existsSync(path.join(handoffsDir, 'nomilestone.md'))); // untouched
  } finally {
    cleanup();
  }
});

test('archiveMilestone accepts valid alphanumeric milestoneVersions', async () => {
  const { dir, cleanup } = await makeFixtureRepo();
  try {
    const handoffsDir = path.join(dir, 'docs/handoffs');
    fs.mkdirSync(handoffsDir, { recursive: true });
    fs.writeFileSync(path.join(handoffsDir, 'v1.2.3-file.md'), 'content');

    const { moved } = archiveMilestone(dir, 'v1.2.3');

    assert.equal(moved.length, 1);
    // Assert that returned path is relative to cwd
    assert.ok(moved.includes(path.join('docs', 'handoffs', 'archive', 'v1.2.3', 'v1.2.3-file.md')));
    // Assert no paths are absolute
    moved.forEach((p) => {
      assert.ok(!path.isAbsolute(p), `Path should be relative, not absolute: ${p}`);
    });
    assert.ok(fs.existsSync(path.join(handoffsDir, 'archive/v1.2.3/v1.2.3-file.md')));
  } finally {
    cleanup();
  }
});
