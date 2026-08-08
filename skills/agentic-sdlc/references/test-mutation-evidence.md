# Test mutation evidence

**A test that cannot fail is not evidence.** Reading its assertions will not tell you
whether it can — three consecutive sprints in one project shipped tests whose docstrings
named regressions their assertions could not detect, and every one of them was reviewed.
The only way to know is to break the thing the test claims to guard and watch it go red.

This reference carries the *method*. Accumulate your own worked examples in your project;
they are worth more than borrowed ones because they name your own near-misses.

> **This practice is expensive — scope it deliberately.** Measured on a real sprint it was
> **8.6 min of ~29 min of test wall-clock, 30%**. Apply it to tests cited as evidence for
> an acceptance criterion, or guarding a named regression. Do **not** apply it to every
> test. If you are mutating a test nobody will cite, you are paying the cost for nothing.

---

## The three failure shapes

**HOLLOW** — the assertion cannot observe the claim in its own docstring.
The sharpest real instance: a test asserting step *ordering* by inspecting a list the
callbacks appended to. The two steps whose order was actually in question appended
nothing, so reordering them produced an **identical list**. The test passed before and
after the mutation it was written to catch. Fixed by observing the effect through the
system under test rather than through the test's own bookkeeping — if your assertion reads
a structure the test itself maintains, suspect it.

**BLIND** — the test never reaches the code it names. A fixture short-circuits, a guard
clause returns early, a mock stands in for the very unit under test. It passes, it is
green in CI, and it has never executed the line it is named after.

**INERT MUTATION** — not a bad test at all: a bad *instrument*. The mutation looked like it
would break the behaviour and did not. One real case: capturing a value in a default
argument seemed certain to defeat a monkeypatch, but the default is evaluated when the
enclosing builder **runs** — already after the patch was applied. The result was GREEN and
the GREEN meant nothing. **Read naively, an inert mutation manufactures a false "this test
is weak" finding out of a broken instrument.** Every GREEN must be resolved explicitly as
HOLLOW or INERT before it is recorded.

## The verdicts

| Verdict | What it means | What you do |
|---|---|---|
| **HONEST** | The mutation made it red, for the predicted reason | Record it. The test is evidence. |
| **HOLLOW** | The mutation was real, the test stayed green | Fix the test — assert through the system, not around it. |
| **BLIND** | The test never reached the mutated code | Fix the test's wiring, then re-mutate. |

`GREEN` from the tool is *not* a verdict. It is the question "HOLLOW or INERT?" — and you
must answer it in writing.

## The five run rules

1. **Run the project's own test command, verbatim.** Its parallelism and isolation flags
   exist for a reason; a mutation harness that quietly serializes them is measuring a
   different system than the one you ship.
2. **A red must be red for the *predicted* reason.** Declare the expected failure text
   before the run and match against it. "It went red" and "it went red because the recap
   ran before the send was parked" are different claims, and only the second is evidence.
   A red for any other reason is collateral damage — discard it, do not bank it.
   **Anchor on text that appears only on failure.** An `expectRed` that shows up in a green
   run cannot tell red from green: `node --test` prints a passing test's *title*, so a
   title-shaped anchor is present in every run and the check silently becomes "did the exit
   code change". The anchor need not *be* a title to collide — being a **substring** of one
   is enough, which is how v0.3-s2's `no-execution-profile` went inert against a test titled
   `flags no-labels, no-milestone and no-execution-profile issues` in the same file.
   `mutate.js` now runs the command unmutated first and reports
   `EXPECT-RED-INERT` rather than letting that pass — but the fix is to anchor on an
   assertion message.
3. **Verify the revert after *every* mutation, not at the end.** One un-reverted mutation
   silently poisons every result after it, and a run that discovers this at the end has to
   throw all of them away.
4. **A skipped mutation is never a pass.** An anchor that did not match, or matched in
   several places, must fail loudly and make the whole run not-evidence. A silently
   skipped mutation reads exactly like a clean one — which is the failure this entire
   practice exists to prevent, reproduced one level up in your tooling.
5. **Decide every GREEN in writing.** See INERT above. An undecided GREEN in a handoff is
   an unfinished thought, not a finding.

## Annotating the test

When a test has been mutation-verified, say so where the next reader will see it — in the
test's own docstring or a comment directly above it:

```
# MUTATION-VERIFIED (2026-08-05): replacing `send(payload)` with `noop(payload)`
# fails this test with "expected 'hi ada'". Without that, the ordering claim below
# is unproven.
```

State the mutation, not just the fact of verification. A bare "mutation tested" tells the
next reader nothing they can re-check, and it rots silently when the code moves.

## Running it

`scripts/asdlc/mutate.js` executes a manifest **you** author — it is deliberately not a
mutation generator. Auto-generated mutants answer "is this line covered?"; the question
here is "does this test's assertion match the claim in its docstring?", which only the
author of the claim can pose.

```jsonc
{
  "testCommand": ["uv", "run", "pytest", "-q", "-n", "2"],  // argv, never a string
  "cwd": "backend",                                          // optional
  "env": { "DB_TESTS": "1" },                                // optional
  "mutations": [{
    "id": "A",
    "why": "recap must run after the send is parked",        // the CLAIM being falsified
    "file": "app/services/emit.py",
    "find": "    # 6. The customer-facing send.",            // literal; authored with \n
    "replace": "    result.recap = spec.recap()\n\n    # 6. The customer-facing send.",
    "testArgs": ["tests/test_emit.py", "-k", "full_sequence"],
    "expectRed": "AssertionError: recap ran before send was parked"  // failure text, never a test name
  }]
}
```

```bash
node scripts/asdlc/mutate.js manifest.json --dry-run   # verify every anchor, run no tests
node scripts/asdlc/mutate.js manifest.json             # the real run
node scripts/asdlc/mutate.js manifest.json --json      # same, structured
```

**Always `--dry-run` first.** Anchors are authored blind against files you are not looking
at, so they fail in batches; checking them all costs one second and saves a full cycle.
`--dry-run` writes nothing, runs no test and reverts nothing, so it is **exempt from the
clean-tree guard** — check a manifest's anchors while it is still an untracked file, which
is the moment you actually want to. The real run still refuses a dirty tree, because it
must be able to tell a stranded mutation from your own edits; pass `--allow-dirty` if you
mean it.

Verdicts: `RED-AS-PREDICTED` · `RED-WRONG-REASON` (discard) · `GREEN` (decide: HOLLOW or
INERT) · `ANCHOR-MISS` · `AMBIGUOUS-ANCHOR` · `NO-OP` · `EXPECT-RED-INERT` · `BASELINE-RED` ·
`DIRTY-REVERT`. The last six mean **the run is not evidence** and the process exits non-zero.
`EXPECT-RED-INERT` means your anchor appears in a green run; `BASELINE-RED` means the suite
was already failing, so nothing could have been measured against it.

`testArgs` is appended to `testCommand` verbatim, so the script knows nothing about any
test framework — `-k` for pytest, `--test-name-pattern` for `node:test`, `-run` for Go.

### Traps that cost real time

- **Line endings.** `find` is authored with `\n` and your files may be CRLF. `mutate.js`
  converts the anchor into the file's own ending, so this is handled — but a hand-rolled
  script will report `ANCHOR NOT FOUND` for anchors that are plainly there. That failure
  looks like a bad anchor and is actually a bad harness.
- **An environment that changes what an exit code means.** Found while building this tool:
  `node --test` sets `NODE_TEST_CONTEXT` in its children, and a nested `node --test`
  inherits it, reports over IPC, and **exits 0 with empty output**. Every mutation came
  back GREEN — "all these tests are hollow" — from an artifact of the harness. If a whole
  run goes uniformly GREEN, suspect the instrument before the tests.
- **The baseline is one extra run per distinct `testArgs` set**, not per mutation. Group
  mutations that share a test command in one manifest and the cost is a single extra run;
  give every mutation its own `testArgs` and you pay it every time. On the 15-16s DB-gated
  tier below, that is the difference between +16s and +3 minutes.

## Choosing which tests to mutate — the cost lever

Mutation cost is dominated by test *bootstrap*, not test body. Measured: a DB-gated test
cost ~15–16 s per invocation where the body ran in under a second — interpreter start,
plugin load, per-worker database create/migrate/seed. The mutation loop pays that on every
run, because changing source requires a fresh process.

So when a plan names tests that will need mutation evidence, note which tier each runs in.
The first test of a behaviour should exercise the real stack; the shape variants around it
usually need not. **A mutation against a no-DB test is roughly 10× cheaper, and the
mutation loop is where that multiplier lands.**
