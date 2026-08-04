# Mutation tooling + loop-efficiency findings — ASDLC update

**Date:** 2026-08-04
**Source:** post-sprint analysis of `gaw` **v0.13-s8** (L4 "one emit path", issue #175, commit `e968569`)
**Status:** proposal — nothing implemented in this repo yet
**Author's note:** every number below is measured from that sprint's actual tool output, not estimated,
unless explicitly marked as an estimate.

---

## TL;DR

1. **The plugin mandates nothing about mutation testing, but the practice it lacks is the one that
   found the sprint's real defects.** `gaw` grew a 234-line rule (`.claude/rules/tests-must-be-able-to-fail.md`)
   after three consecutive sprints shipped tests whose docstrings named regressions their assertions
   could not detect. That rule exists in **`gaw` only** — nothing in `skills/agentic-sdlc/` mentions it.
2. **The rule ships no tooling.** So each sprint hand-rolls a throwaway mutation script. In v0.13-s8
   that was **4 scripts, 184 lines, 3 distinct bug classes**, one of which silently corrupted a source
   file and another of which silently skipped 3 of 8 mutations.
3. **Proposal:** promote the rule into the plugin as a reference, and add `scripts/asdlc/mutate.js` to
   make executing it cheap and correct. Spec in Part 1.
4. **Five further findings** (Part 2), ranked, with now/later calls.

---

# Part 1 — `scripts/asdlc/mutate.js` (spec + plan)

## 1.1 Why a script, and why only this much of it

The loop-hardening design (`docs/superpowers/specs/2026-07-22-loop-hardening-design.md`) states the
governing principle:

> *Judgment-heavy steps (plan, build, verify, adversarial review) stay prose — scripts only take over
> bookkeeping and gating.*

Mutation testing splits cleanly along that line:

| Step | Nature | Owner |
|---|---|---|
| "What mutation would falsify this test's stated claim?" | Judgment | **Model** (prose) |
| Apply the edit, run the target test, capture the failure, revert, verify the revert | Bookkeeping | **Script** |
| "Is this RED the *expected* RED? Is this GREEN because the mutation was inert?" | Judgment | **Model**, but the script must give it the evidence |

So `mutate.js` is deliberately **not** a mutation *generator* (no Stryker/mutmut-style automatic
operator application). Auto-generated mutants answer "is this line covered?"; the ASDLC question is
"does this test's assertion match the claim in its docstring?" — which only the author of the claim
can pose. The script executes a **model-authored manifest** and reports faithfully.

## 1.2 The evidence this is needed

From v0.13-s8, all measured:

| Symptom | Detail | Cost |
|---|---|---|
| Hand-rolled every time | 4 throwaway scripts written mid-sprint: 42 + 74 + 48 + 20 = **184 lines** | ~15 min of authoring |
| **Encoding corruption** | `Get-Content -Raw` / `Set-Content` round-trip: PowerShell 5.1 reads a BOM-less UTF-8 file as ANSI, so revert wrote back mojibake. **Every em-dash in `case_engine/emit.py` was destroyed.** File had to be rewritten from scratch. | ~3 min + ~6k tokens |
| **Silent anchor miss** | Multi-line anchors joined with `\n` against **CRLF** source files → `ANCHOR NOT FOUND` for 3 of 8 mutations. Two of those three later proved to be genuine REDs. | 1 extra script + 1 extra run cycle |
| Non-ASCII in the script itself | Em-dash in a PS 5.1 string literal → parser error before anything ran | 1 wasted call |
| **Inert mutation reported as evidence** | A default-argument capture *looked* like it would defeat `monkeypatch.setattr`, but the default is evaluated when the enclosing builder **runs** — already after the patch. GREEN, and the GREEN meant nothing. | 1 extra script + a corrected docstring |

The third and fifth rows are the serious ones. **A silently-skipped mutation reports nothing and reads
as a clean run** — which is the exact failure class the rule exists to prevent, reproduced one level up
in the tooling. And an inert mutation, read naively, manufactures a "this test is weak" finding out of
a broken instrument (`gaw`'s rule file, rule 4, says this explicitly).

## 1.3 Interface

```
node scripts/asdlc/mutate.js <manifest.json> [--only <id>[,<id>…]] [--dry-run] [--json]
```

### Manifest

```jsonc
{
  "testCommand": "uv run pytest -q -n 2 --dist loadscope",   // project's own runner
  "cwd": "backend",                                          // optional, relative to repo root
  "env": { "GAW_DB_TESTS": "1" },                            // optional
  "mutations": [
    {
      "id": "A",
      "why": "recap must run after the send is parked",       // the CLAIM being falsified
      "file": "app/services/case_engine/emit.py",
      "find": "    # 6. The customer-facing send.",           // literal, not regex
      "replace": "    if spec.recap is not None:\n        result.recap = spec.recap(result.external_ref)\n\n    # 6. The customer-facing send.",
      "target": "tests/test_case_emit.py",
      "filter": "full_sequence",                              // -k
      "expectRed": "the recap must run after the send is parked"
    }
  ]
}
```

`find`/`replace` are **literal strings, newline-normalized** (see 1.4). `expectRed` is a substring that
must appear in the failure output — this is what turns "it went red" into "it went red **for the reason
predicted**", which is rule 2 of the practice and the single most valuable thing the script adds.

### Per-mutation outcome vocabulary

| Verdict | Meaning | What the model does |
|---|---|---|
| `RED-AS-PREDICTED` | Test failed **and** output contains `expectRed` | Record it. Done. |
| `RED-WRONG-REASON` | Test failed, `expectRed` absent | **Discard.** Something else broke — collateral damage, fixture collision, or the mutation is bigger than intended. |
| `GREEN` | Test passed | Either the test is HOLLOW **or** the mutation is inert. The model must decide, and say which. |
| `ANCHOR-MISS` | `find` not present in the file | **Never silent.** Non-zero exit; the run is not evidence. |
| `NO-OP` | `find` present but `replace` produced an identical file | Same as above — the mutation cannot change behaviour. |
| `DIRTY-REVERT` | Post-run file content ≠ pre-run content | **Hard failure**, abort the whole run. |

### Output

Human-readable per mutation, plus a **paste-ready Markdown table** for the handoff:

```
MUT A [full_sequence] RED-AS-PREDICTED (14.7s)
      the recap must run after the send is parked
MUT B [skips_absent_parts] RED-AS-PREDICTED (16.7s)
      AttributeError: 'NoneType' object has no attribute 'stage'
MUT I [module_level_monkeypatch] GREEN (40.2s)
      !! no failure — the test is HOLLOW or the mutation is INERT. Decide and record which.

7 mutations: 6 RED-AS-PREDICTED, 1 GREEN, 0 anchor-miss.  Reverts verified clean.
```

`--json` emits the same as structured data for CI or a `/checkpoint` gate.

## 1.4 Correctness requirements (each one is a bug this sprint actually hit)

1. **Read and write bytes, never through a shell's default codec.** Node: `fs.readFileSync(p, 'utf8')` /
   `writeFileSync`. The PowerShell port **must** use `[System.IO.File]::ReadAllText/WriteAllText`, never
   `Get-Content -Raw` / `Set-Content`.
2. **Normalize line endings for matching only.** Detect the file's dominant ending, normalize both file
   and `find`/`replace` to `\n` for the match, then **re-emit in the file's original ending**. A
   `find` authored with `\n` must match a CRLF file.
3. **Verify the anchor before running anything.** Missing anchor ⇒ `ANCHOR-MISS`, non-zero exit.
   Never proceed and never report a passing result for a mutation that was not applied.
4. **Verify the revert byte-for-byte after every mutation**, not just at the end. One un-reverted
   mutation poisons every subsequent result (`gaw` rule 3).
5. **Restore on any exit path** — including SIGINT and an exception in the test runner. A `try/finally`
   around each mutation, plus a process-level handler.
6. **Refuse to run on a dirty working tree** unless `--allow-dirty`. If the run is interrupted, the
   author must be able to distinguish their own edits from a stranded mutation. Print the `git status`
   that caused the refusal.
7. **The script never chooses the test command.** It runs what the manifest says, verbatim, so the
   project's own parallelism/isolation flags (`-n 2 --dist loadscope`, here) are preserved. `gaw`'s
   rule 1 forbids serial mutation runs for a real reason — the script must not quietly override it.

## 1.5 Non-goals

- **No mutation generation.** See 1.1.
- **No parallelism across mutations.** They edit the same working tree; serializing is the whole point.
- **No opinion about which tests to mutate.** That's the plan's job.
- **No coverage integration.** Different question, different tool.

## 1.6 Implementation plan

House style: dependency-free Node, `node:test` unit tests, `makeFixtureRepo` helper
(`scripts/asdlc/test/helpers/fixture-repo.js`).

| Task | Deliverable | Test |
|---|---|---|
| 1 | `lib/apply-mutation.js` — pure: `(source, find, replace) → {result, verdict}` with line-ending normalization | Unit: CRLF file + LF anchor matches; anchor-miss; no-op; round-trip preserves original endings **and** non-ASCII |
| 2 | `lib/manifest.js` — parse + validate; reject a mutation missing `expectRed` | Unit: each required field; helpful error text |
| 3 | `mutate.js` — the loop: dirty-tree guard → per-mutation apply/run/classify/revert/verify | Integration against `fixture-repo` with a trivial failing/passing test |
| 4 | Reporter — text + `--json` + the Markdown table | Unit: snapshot each verdict's rendering |
| 5 | Crash safety — `finally` + `process.on('SIGINT')`; revert-verify failure aborts | Integration: kill mid-run, assert the tree is clean |
| 6 | `commands/checkpoint.md` — add "if the sprint added tests, run the manifest and paste the table into the handoff" | — |
| 7 | `skills/agentic-sdlc/references/` — new `test-mutation-evidence.md` (see 2.1) | — |

**Ordering note:** Task 1 is where every one of this sprint's bugs lived. Write it first and test it
against a fixture that contains **both CRLF and a non-ASCII character** — that single fixture would
have caught two of the three bug classes.

## 1.7 The PowerShell port question

`gaw`'s `scripts/asdlc/*.ps1` are hand-ports of this repo's `*.js` — `checkpoint-hooks.ps1` says so in
its own header. Two things follow:

- **`mutate.js` is canonical; `mutate.ps1` is a port.** Write the JS first.
- **The port carries extra hazards the JS does not.** `checkpoint-hooks.ps1` already documents one:
  *"this file is deliberately pure ASCII. Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI, so any
  literal non-ASCII (e.g. an em dash) corrupts parsing."* That exact hazard bit this sprint's throwaway
  script. The port must inherit that comment, plus requirement 1.4.1.

If `gaw` has Node available (it does — the plugin scripts run there), **consider skipping the port
entirely** and invoking `mutate.js` directly. One implementation, one set of encoding bugs to fix once.
Worth a decision rather than a default.

---

# Part 2 — Further findings

Ranked by payoff. Each carries the evidence, the measured cost, and a now/later call.

## 2.1 The mutation rule isn't in the plugin at all — **do now**

`gaw/.claude/rules/tests-must-be-able-to-fail.md` is **234 lines / 12.9 KB**, written after three
consecutive sprints shipped tests that could not fail. Nothing in `skills/agentic-sdlc/` mentions
mutation, hollow tests, or the annotation convention.

In v0.13-s8 that rule (auto-injected by a `gaw`-local hook on test edits) directly produced:

- **2 hollow tests found and fixed.** One asserted step ordering through a list the callbacks appended
  to — but the two steps whose order was in question appended nothing, so the mutation the docstring
  named produced an *identical list*. Fixed by observing the effect through the system under test
  instead of the test's own bookkeeping.
- **1 inert mutation caught**, preventing a false "this test is weak" finding and narrowing a design
  constraint from "must be call-time lookup" to the weaker, actually-measured "must not resolve at
  import time".

Reading the assertions would have caught none of these. **Recommendation:** add
`skills/agentic-sdlc/references/test-mutation-evidence.md` — a condensed version (the three failure
shapes, the three verdicts HONEST/HOLLOW/BLIND, the five run rules, the docstring annotation
convention) — and reference it from `/checkpoint`. Keep `gaw`'s worked examples in `gaw`; the plugin
version should carry the *method*, and say that projects should accumulate their own citations.

> **Caveat worth stating in the reference:** this practice is expensive. In v0.13-s8 it was **8.6 min
> of the sprint's ~29 min of test wall-clock — 30%**. It should be scoped to tests cited as evidence
> for an acceptance criterion or guarding a named regression, not applied to every test.

## 2.2 Test-invocation bootstrap dominates the mutation loop — **do now (as guidance), later (as tooling)**

Measured: a single-test DB-gated run costs **~15–16 s** where the test body runs in under a second.
That's interpreter start + plugin load + per-xdist-worker database create/migrate/seed. Across ~30
invocations in the sprint that is **≈7.5 min — 26% of all test wall-clock spent on bootstrap**, and the
mutation loop pays it 18 times because changing source requires a fresh process.

**7 of the sprint's 8 new tests were DB-gated**, so each mutation cost 35–40 s instead of the ~3 s a
no-DB test would. At least two of them (payload-shape and idempotency-key-derivation assertions) test
*shape*, not persistence, and could have run against a fake session.

This is a trade, not a free win — DB-gated is genuinely stronger, because it proves the intent reaches
the real spine. **The guidance to add to `plan-template.md`:**

> When a plan names tests that will need mutation evidence, note which tier each will run in. The first
> test of a behaviour should exercise the real stack; the shape variants around it usually need not.
> A mutation against a no-DB test is roughly 10× cheaper, and the mutation loop is where that
> multiplier lands.

*Later, optionally:* a `--reuse-db` / warm-fixture mode is the structural fix, but it is project-specific
and belongs in the project, not the plugin.

## 2.3 `size-sprint` has no term for the mutation tax — **do later**

`gaw`'s `size-sprint.ps1` (116 lines; no `.js` equivalent exists in this repo yet) estimates from
subsystems and file counts. v0.13-s8: 6 tasks, 9 files — but **15 new tests → 18 mutation runs ≈ 10.5
min** of gate time the estimator has no term for.

A plan with 15 new tests has a materially different cost profile from one with 3. **Cheap addition:**
count the plan's stated test names and surface them as a separate line in the estimate. This also
nudges plan authors to *name* their tests, which is independently good.

Note this repo has no `size-sprint.js` at all — `gaw` built it locally (v0.12-s12). That's the same
pattern the loop-hardening design already flagged: *"real usage re-invented the automation the concept
should have shipped."* Worth deciding whether to pull it upstream.

## 2.4 A sequencing rule the loop doesn't state — **do now, one line**

Measured waste: **4 min 30 s** on a cross-module regression sweep that returned 37 identical
`AttributeError`s, all predicted — a symbol had been renamed in task 3 and the consuming module's
update was task 4's job. Zero information for 4.5 minutes, plus ~2k tokens of failure output.

Entirely the operator's error, not the process's. But the process can cheaply prevent it. **Add to
`plan-template.md` or `/checkpoint`:**

> Don't run a cross-module regression sweep until every module in the diff is internally consistent.
> Mid-refactor, run only the tests for the modules you have finished.

## 2.5 The tiering trade-off has no owner — **do later, but decide**

`gaw` runs four tiers (fast / smoke / deep / slow). This sprint's full local run surfaced a test that
had been **red in the nightly `slow` tier for roughly twelve sprints** (`test_worker_eval_api` asserts
`200` against an endpoint that has returned `202` since v0.12-s4). Filed as `gaw`#218.

Two general lessons for the plugin's state model:

1. **Moving a test off the gating path converts it from a gate into something a human must look at.**
   `gaw`'s CLAUDE.md does say "check the latest nightly `slow` run too" — and it wasn't happening. Prose
   instructions to check a thing are exactly what loop-hardening was written to replace.
2. **A red non-gating tier should file an issue automatically**, the way `gaw`'s `ci.yml` already does
   for a red `deep` on `main` (`ci-red-main`). That asymmetry is the whole bug: the tier nobody watches
   is the tier with no alarm.

**Recommendation:** add to `gh-hygiene.js` — report any workflow whose most recent scheduled run is
failing. Cheap, and it closes a class of rot that the current audit (stale branches, unlabelled issues,
milestone drift) doesn't cover.

## 2.6 Context cost of the verification log — **do later**

`gaw/docs/v0.13-build-sequence.md` § Verification log stores each entry as a **single Markdown table
cell of 800+ words**. Reading ~50 lines of that file to find an unrelated table cost an estimated ~9k
tokens. The content is valuable — it is exactly the "an execution profile is evidence, not verdict"
record the methodology depends on — but the storage shape forces all-or-nothing reads.

**Recommendation:** `issue-verification-methodology.md` should say that a verification log entry lives
in its **own file** (`docs/verification/<issue>-<date>.md`) with a one-line index row. Same evidence,
addressable. This mirrors the plugin's own "reference, never mirror" rule for STATUS.md, applied to a
file that predates it.

---

# What was working and should not change

Recorded because a findings list reads as an indictment otherwise. From v0.13-s8:

- **`/verify-issue` paid for itself completely.** The plan's line references were accurate throughout;
  zero stale-coordinate surprises. The sequence file's own log says that is *not* the norm when the
  pass is skipped.
- **Settling design decisions with the human before the sprint** (two, both recorded in the plan with
  their rejected alternatives) meant zero blocking questions mid-execution.
- **Writing behaviour-preservation tests against the pre-refactor code and observing them green first**
  made the refactor provably behaviour-preserving rather than argued to be. Worth promoting into
  `plan-template.md` as the standard shape for a refactor sprint.
- **The tiered local gate (`fast` + `smoke`, ~60 s) is right.** The expensive tiers found one issue,
  and it was pre-existing and unrelated.

---

# Suggested order of work

| # | Item | Section | Size |
|---|---|---|---|
| 1 | `test-mutation-evidence.md` reference + `/checkpoint` hook | 2.1 | S |
| 2 | `scripts/asdlc/mutate.js` (tasks 1–5) | Part 1 | M |
| 3 | Reporter + manifest docs; wire into `/checkpoint` | Part 1 §1.6 t.4/6 | S |
| 4 | `plan-template.md`: test-tier note + refactor-sprint shape + regression-sweep sequencing | 2.2, 2.4 | S |
| 5 | `gh-hygiene.js`: report failing scheduled workflows | 2.5 | S |
| 6 | Decide: port `mutate` to PowerShell, or have `gaw` call the JS | §1.7 | — |
| 7 | Verification-log storage shape | 2.6 | S |
| 8 | Pull `size-sprint` upstream + add the mutation term | 2.3 | M |

Items 1 and 2 are the ones with recurring cost. The rest are cheap and can ride along.
