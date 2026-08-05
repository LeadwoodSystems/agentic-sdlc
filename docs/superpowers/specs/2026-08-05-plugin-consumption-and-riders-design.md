# Plugin consumption + hygiene riders — design

**Date:** 2026-08-05
**Sprint:** v0.2-s4
**Source proposal:** `docs/2026-08-04-mutation-tooling-and-loop-efficiency.md` (Part 2, riders 2.2 / 2.4 / 2.5)
**Status:** accepted

The v0.2-s3 handoff scoped this sprint as three cheap riders and one loose end — *"tell `gaw`
to invoke `node mutate.js`, the decision lives only in a spec `gaw` never reads."* Chasing
that loose end found a different defect underneath it, and this spec records both: the
consumption bug (§1), and the three riders as agreed (§2–§3).

---

## 1 — Bootstrap enumerates, and the enumeration went stale

### The finding

`gaw` has no `mutate.js`. The handoff read that as a communication gap — the no-`.ps1`-port
decision was recorded in a spec `gaw` doesn't read, so `gaw` would hand-port by reflex. That
diagnosis was wrong, and it pointed at a fix that would not have worked.

The plugin's distribution model is **copy-into-repo**. `commands/bootstrap-asdlc.md` step 6
names the scripts a consuming repo receives, and the consumer then owns those files. This is
why `CLAUDE_PLUGIN_ROOT` appears nowhere in this repo, and why every command says `node
scripts/asdlc/…`: those paths are repo-relative *by design*, correct in both the plugin and
the consumer.

Step 6 named eleven files. Fifteen non-test `.js` files exist. The four missing ones —
`mutate.js`, `lib/apply-mutation.js`, `lib/manifest.js`, `lib/report.js` — are exactly what
v0.2-s3 shipped. **The sprint that built the tool never updated the manifest that hands it to
consumers.** No amount of telling `gaw` about the port decision would have delivered a file
that bootstrap does not copy.

### The decision: delete the list rather than correct it

Step 6 stops enumerating and states a rule instead: copy **every** `.js` under
`scripts/asdlc/`, including `lib/`, excluding `test/`.

The rejected alternative was to fix the list and add a two-way test (every file on disk is
named; every name exists on disk). It works, but it keeps two sources of truth in sync by
gate — and this repo already has a rule against exactly that shape. `#ports-are-prose` says a
*number* typed into prose belongs in a measured manifest instead. A *list* of files typed
into prose is the same smell with the same failure mode, and the failure has now happened
once. A derivation cannot go stale.

A machine-readable `.asdlc/bootstrap-files.json` was also rejected: it buys the ability to
exclude a file deliberately, and no such file exists or is foreseen. Adding config to support
a case that has never arisen is the thing YAGNI names.

### The test

`scripts/asdlc/test/bootstrap-manifest.test.js` extracts step 6's block — from the numbered
line naming `scripts/asdlc/` to the next numbered step — and asserts two claims:

1. the block carries a copy-everything directive;
2. the block names no individual `.js` file.

Both are mutable: re-adding a filename fails (2), deleting the directive fails (1).

Two traps the implementation has to clear, or the test passes vacuously:

- **Extract the block; don't scan the document.** Steps 7 and 8 legitimately name `facts.js`
  and `asdlc-lint.js`, so a document-wide scan is a test that can never pass.
- **A filename needs a stem.** The new step 6 text itself contains the string `.js` ("copy
  every `.js` file"). The assertion is about *named files* — match a stem followed by the
  extension, so `mutate.js` fails the test and a bare `.js` does not.

**What this test does not claim.** It asserts the *instruction* is complete, not that any
consumer received any file. Verifying delivery means running bootstrap against a real repo,
which is a `gaw`-side sprint. The distinction matters: this test going green is not evidence
that `gaw` has `mutate.js`.

### Consequence for `gaw`

`gaw` re-bootstraps and receives `mutate.js` through the ordinary path. No cross-repo edit
belongs in this sprint — `gaw` is a separate repo under its own branch discipline, and
`#git` (one sprint = one branch = one worktree) does not stretch across two.

The no-port decision still needs stating where `gaw` reads it. That is now a one-line note in
a `gaw` sprint, not a delivery mechanism.

---

## 2 — `gh-hygiene.js` gains a sixth check (rider 2.5)

### Why it belongs in the script

`commands/asdlc-hygiene.md` already tells the agent to check scheduled workflows — by hand,
with a raw `gh run list` and prose describing how to read it. That is precisely the shape
loop-hardening was written to remove: *"prose instructions to check a thing"* are what a
gate replaces. The rider's own evidence is a test red in a nightly tier for ~12 sprints, in a
project whose `CLAUDE.md` said to check that tier.

### Contract

```
findFailingScheduledWorkflows(cwd, { runner = run }) → [{ workflow, conclusion, createdAt }]
```

Runs `gh run list --event schedule --limit 50 --json workflowName,conclusion,status,createdAt`,
groups by `workflowName`, takes the most recent run per workflow whose `status` is
`completed`, and reports those whose `conclusion` is not `success`.

Three decisions inside that:

- **Filter by event server-side**, not client-side over a mixed list. The command's current
  prose uses `--limit 40` across all events; on a busy repo a weekly workflow falls off the
  end and reports as absent — which reads as clean. That is the same silent-skip failure
  class `mutate.js` was built to refuse.
- **Skip in-progress runs** rather than guessing. A run with `status !== 'completed'` has no
  conclusion yet; the most recent *completed* run is the one with a verdict.
- **`workflowName`, not `name`.** `name` is the run's display title. Field names verified
  against the installed `gh`.

### Wiring

A sixth `safeCheck` slot, `failingScheduled`, following the pattern `findStaleWorktrees`
established in v0.2-s2: one line in `runHygieneAudit`, one `console.log` in `main()`, one key
added to the `anyCheckFailed` list. `gh-hygiene.test.js` gains a sixth-slot isolation case —
this check shells out to `gh`, so an unauthenticated `gh` must degrade this slot alone and
leave the git-based findings reported.

`commands/asdlc-hygiene.md` then loses its manual `gh run list` block; "five findings"
becomes six, and the frontmatter description gains the check.

**Not dogfoodable here.** This repo has no workflows, so a live run prints `none`. That is a
true result, not evidence the logic works — the stubbed-runner tests carry the verdict logic,
and the handoff must say so rather than presenting a clean run as a pass.

---

## 3 — `plan-template.md` gains two lines (riders 2.2, 2.4)

Both are prose, both land in `skills/agentic-sdlc/references/plan-template.md`.

**Test plan section — the tier note (2.2).** When a plan names tests that will need mutation
evidence, note which tier each runs in. The first test of a behaviour should exercise the
real stack; the shape variants around it usually need not.

The substance of this guidance already shipped in
`references/test-mutation-evidence.md` ("Choosing which tests to mutate — the cost lever"),
so 2.2 is not writing guidance — it is putting the hook where a *plan author* reads, and
pointing at the reference. Cite **this repo's own measurement** rather than `gaw`'s: the
v0.2-s3 dogfood run cost 0.2s per library mutation and 16.7s for the one targeting
`mutate.test.js`, which builds real git fixture repos — ~80×. A first-party number is
re-checkable by the person reading it.

**Tasks section — the sequencing rule (2.4).** Don't run a cross-module regression sweep
until every module in the diff is internally consistent; mid-refactor, run only the tests for
the modules you have finished. Measured waste behind it: 4m30s returning 37 predicted
`AttributeError`s after a rename in task 3 whose consumer update was task 4's job.

**Neither gets a test.** `asdlc-lint.js` lints `CLAUDE.md`, not references; adding a lint
rule to guard two sentences costs more than the sentences protect. Their evidence is that the
template reads correctly.

---

## Scope boundary

**Out, and where each picks up:**

- **Installing this plugin** — `.claude-plugin/plugin.json` and `marketplace.json` already
  exist, so it is a `/plugin marketplace add` + `/plugin install` the user runs
  interactively. No code change, no sprint. Worth doing; it gives a consumer the commands
  and skills, but *not* the scripts — those still arrive by bootstrap.
- **Editing `gaw`** — its own sprint. See §1.
- **`${CLAUDE_PLUGIN_ROOT}` paths** — rejected outright, not deferred. Wrong model for this
  plugin: consumers own the scripts.
- **Riders 2.3** (`size-sprint` upstream + mutation term) and **2.6** (verification-log
  storage shape) — unchanged from the proposal, still unscheduled.
- Carried gaps from v0.2-s3: missing `plans/_TEMPLATE.md`; `commands/sprint.md`'s wrong plan
  naming scheme; legacy `2026-07-22-loop-hardening.md` reporting `unmatched-plan`; the `.ps1`
  port backlog.

## Evidence to capture

- Full suite green, before and after (`270` at entry).
- `node scripts/asdlc/facts.js --check` and `node scripts/asdlc/asdlc-lint.js` exit 0.
- A mutation manifest covering the two new tests — `--dry-run` first, then the real run,
  table pasted into the handoff, every `GREEN` resolved in writing as HOLLOW or INERT.
- A live `node scripts/asdlc/gh-hygiene.js main v0.2`, with the sixth line shown **and** the
  caveat from §2 stated: `none` here is the absence of workflows, not a passing check.
