# Mutation verdict integrity: the baseline-absence gate

**Date:** 2026-08-05 · **Sprint:** v0.2-s5 · **Status:** accepted

## The defect

`classify()` (`scripts/asdlc/mutate.js:75-82`) decides `RED-AS-PREDICTED` versus
`RED-WRONG-REASON` by searching the concatenated `stdout + stderr` of the mutated run for
the manifest's `expectRed` string. That is the whole difference between "it went red" and
"it went red for the reason predicted" — the claim the tool exists to support.

The search has no way to know *why* the string is present. Under `node --test`, a test that
**passes** prints its own title (`✔ <title>`). So an `expectRed` that names a test is in the
output of every run, mutated or not, and the substring check collapses into "did the exit
code go non-zero" — which is the check it was written to replace. Any non-zero exit anywhere
in the file then reads as `RED-AS-PREDICTED`.

This is not a `node:test` quirk. Every reporter that echoes test names on success breaks it
identically. The pattern reached this repo from a pytest worked example in
`skills/agentic-sdlc/references/test-mutation-evidence.md`, where the anchor is a docstring
— printed only on failure — so it happens to hold there and degrades silently everywhere
else.

Both v0.2-s4 anchors were re-pointed by hand after the whole-branch review found this.
`docs/mutation-manifests/v0.2-s3.json` still carries three title-shaped anchors, so its
recorded verdicts rest on hand-reasoning about blast radius rather than on the tool.

## The mechanism

**An anchor that appears in a green run proves nothing.** Before trusting `expectRed`, run
the test command against the **unmutated** tree and require `expectRed` to be absent from
that output. If it is absent when the code is correct and present when the code is mutated,
the string discriminates — and only then does a match mean what the report says it means.

`classify()`'s body is unchanged. The fix is a precondition on its input, not a smarter
matcher. This is deliberate: the substring check is correct given a discriminating anchor,
and the failure was always that nothing established that premise.

Placed in `runOne`, cheapest-first so no test invocation hides behind a bad anchor:

1. read the file, `applyMutation` → `ANCHOR-MISS` / `AMBIGUOUS-ANCHOR` / `NO-OP` (unchanged)
2. `--dry-run` → `ANCHOR-OK`, still running no tests (unchanged — see below)
3. **baseline run**, memoized per `[...testCommand, ...testArgs]` + `env`
4. **`EXPECT-RED-INERT`** when the baseline output contains `expectRed`
5. write the mutation, run, `classify` (unchanged)

Steps 3 and 4 never write to the file, so `durationMs` stays 0 — the same convention the
unapplied verdicts already follow, and for the same reason: a timing borrowed from a test
run that did not measure a mutation makes a skipped mutation read as a real one.

## Two new verdicts

**`EXPECT-RED-INERT`** — the anchor is present in green output. Whatever the mutated run
does, the verdict it would produce carries no information.

**`BASELINE-RED`** — the test command already fails with nothing mutated. This verdict is
what makes the first one sound: against a failing baseline, `expectRed`'s presence or
absence is uninterpretable, so silently treating a red baseline as "absent, therefore
discriminating" would manufacture exactly the false confidence being removed.

Both join `NOT_EVIDENCE` in `lib/report.js`, so either one makes the whole run not-evidence
and exits non-zero. Neither is a *finding* about the code under test; both are findings
about the instrument, which is the existing meaning of that set.

`BASELINE-RED` is recorded per mutation and the loop continues, rather than throwing to
abort the run. Two reasons: `runMutations` already establishes that a bad anchor records its
verdict and continues (`mutate.js:163-169`), because anchors authored blind fail in batches
and one-per-cycle debugging is the cost shape this tool removes; and a red baseline belongs
to one `testArgs` set, so it says nothing about mutations that run a different one.

## Rejected alternatives

**Scan only the failure region.** Find the reporter's failure markers (`not ok`, `✖`,
`FAILED`, `--- FAIL:`) and match `expectRed` only inside failing sections. Sharper in
principle, and rejected because it hard-codes a format per framework. The tool's stated
invariant is that it "knows nothing about any test framework" — `testArgs` is appended
verbatim precisely so that `-k`, `--test-name-pattern` and `-run` are the caller's problem.
A reporter change would revert the check to today's behaviour without failing anything.

**Diff the baseline and mutated output, match only in the delta.** Strictly stronger than
absence-checking, at the same runtime cost. Rejected on noise: durations, ordering and
progress counters differ between two runs of the same green suite, so the delta needs
per-framework filtering to be usable — which reintroduces the coupling above. Absence is a
strict-enough subset with semantics that fit in one sentence.

**Documentation only** — state that `expectRed` must be an assertion message, never a test
title, and fix the manifests. Free, and rejected because it is the rule that already failed:
a manifest author cannot check it without running the suite, and running the suite is what
the gate does for them.

## `--dry-run` stays pure

`--dry-run`'s contract is "verify every anchor, run no tests", documented as costing about a
second and recommended before every real run. A baseline is inherently a test invocation, so
folding it into `--dry-run` would trade that property away. The gate therefore lives in the
real run only, and `ANCHOR-OK` continues to mean what it means.

## Cost

At most one extra test invocation per **distinct** `testArgs` set, not per mutation. The
memo key is what keeps this affordable: `test-mutation-evidence.md` records a DB-gated test
at 15-16s per invocation, and this repo has measured 16.7s for a mutation against real git
fixture repos versus 0.2s for a library one. A manifest whose mutations share an arg-set
pays the baseline once.

No opt-out flag. A flag that disables the gate is a flag that gets set in the one run whose
result someone wants to believe, and nothing here is expensive enough yet to justify it.

## Consequences for existing artifacts

`docs/mutation-manifests/v0.2-s3.json`'s three anchors are re-pointed at assertion failure
messages and the manifest is re-run. Its verdicts are re-recorded honestly: a verdict that no
longer holds is reported as a finding, not chased with a test rewrite inside this sprint.
Once the gate exists, a title-shaped anchor is proven inert by the tool rather than by grep,
which is the point.

`test-mutation-evidence.md`'s worked example currently sets `expectRed` to a restatement of
`why` — the shape that teaches the failing pattern. It gains the rule, the two verdicts, and
an example anchored on assertion text.

## What this does not fix

A string can be absent from the baseline and still appear in the mutated run for a reason
other than the predicted one — an unrelated failure whose message happens to contain it.
The gate removes the *systematic* false positive (an anchor that can never discriminate),
not the coincidental one. Judgment about blast radius remains with the reader, which is the
tool's stated division of labour.
