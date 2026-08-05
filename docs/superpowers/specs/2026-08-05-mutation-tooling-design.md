# Mutation tooling — design

**Date:** 2026-08-05
**Sprint:** v0.2-s3
**Source proposal:** `docs/2026-08-04-mutation-tooling-and-loop-efficiency.md` (Part 1)
**Status:** accepted

This spec records what `scripts/asdlc/mutate.js` is, and — more importantly — the four
decisions where it **departs from the source proposal**. The proposal remains the record of
*why the tool is needed*; this file is the record of *what was actually agreed to build*.

---

## What the tool is

A script that executes a **model-authored mutation manifest**: for each entry it applies a
literal find/replace to a source file, runs a named test, classifies the outcome, reverts,
and verifies the revert byte-for-byte.

It is deliberately **not** a mutation generator. Auto-generated mutants answer "is this line
covered?"; the question this practice asks is "does this test's assertion match the claim in
its docstring?", and only the author of the claim can pose it. The split follows the
governing line from `docs/superpowers/specs/2026-07-22-loop-hardening-design.md` — judgment
stays prose, bookkeeping becomes a script:

| Step | Nature | Owner |
|---|---|---|
| "What mutation would falsify this test's stated claim?" | Judgment | Model |
| Apply, run, capture, revert, verify the revert | Bookkeeping | **Script** |
| "Is this RED the *expected* RED? Is this GREEN because the mutation was inert?" | Judgment | Model — on evidence the script supplies |

The single most valuable thing the script adds is `expectRed`: a substring that must appear
in the failure output, which turns "it went red" into "it went red **for the reason
predicted**".

## Module boundaries

| Module | Contract | Nature |
|---|---|---|
| `lib/apply-mutation.js` | `(source, find, replace) → {verdict, result}` | pure, no I/O |
| `lib/manifest.js` | `parseManifest(json) → manifest` or throws | pure |
| `lib/report.js` | `renderText/renderJson/renderMarkdown(results)` | pure |
| `lib/exec.js` | **adds** `runCapture(cmd, args, opts) → {status, stdout, stderr}` | the seam |
| `mutate.js` | the loop, the guards, the CLI | orchestration |

Three of the five are pure functions over strings, which is what makes the encoding and
line-ending rules below testable without a repo.

`mutate.js` takes `{ runner = runCapture }` per the `#runner-injection` rule, so the
integration tests stub the test runner rather than shelling out to a real one.

`apply-mutation.js` imports `detectEol` from `lib/marker-block.js` instead of growing a
fourth copy of that function. That file's header warns against drive-by migrations of its
*consumers*; importing an already-exported helper is not one, and a fifth private
line-ending heuristic is precisely the drift the module was created to stop.

---

## Decision 1 — `run()` is untouched; `runCapture()` is new

`lib/exec.js`'s `run()` throws on a non-zero exit. For this tool a non-zero exit **is the
answer** — it is the RED the whole practice is looking for. Rather than teach `run()` an
option, `runCapture()` is added alongside it, returning `{status, stdout, stderr}` and never
throwing on a non-zero status.

**Why not extend `run()`:** 198 existing tests depend on its throw-on-non-zero contract, and
the v0.2-s2 handoff records what happens when that contract is weakened by accident — the
"absent trunk must throw" assertion in `gh-hygiene.test.js` was one option-flag away from
being silently downgraded to "reports a clean audit". Two functions with two honest
contracts beat one function with a mode.

## Decision 2 — `testCommand` is an argv array, not a string

The source proposal's example manifest gives a command string
(`"uv run pytest -q -n 2 --dist loadscope"`). This spec requires an array:

```json
"testCommand": ["uv", "run", "pytest", "-q", "-n", "2", "--dist", "loadscope"]
```

**Why:** a string requires `shell: true`, which means `cmd.exe` on Windows and `/bin/sh`
elsewhere — one manifest with two behaviours. This repo needed
`docs/2026-08-04-shell-strategy.md` to settle exactly that class of bug, and the failure mode
here is nasty: a mis-split command surfaces as a mysterious test failure that the verdict
vocabulary classifies as `RED-WRONG-REASON` — a *finding* — rather than as tooling failure.

Requirement 1.4.7 of the proposal ("the script never chooses the test command") is fully
satisfied by an array: the project's own parallelism and isolation flags are preserved
verbatim. What is lost is `&&` and pipes; the manifest's `cwd` covers the common case that
would have wanted them. `parseManifest` rejects a string `testCommand` with a message naming
the array form, so the older shape fails loudly rather than being coerced.

## Decision 3 — per-mutation `testArgs`, not `target` + `filter`

The proposal's manifest narrows a run with `target` (a file) and `filter` (a `-k` value).
`-k` is **pytest syntax**: that quietly makes the tool framework-specific, and this repo
could not dogfood it on its own `node:test` suite, which needs `--test-name-pattern`.

Instead each mutation carries a `testArgs` array, appended to `testCommand`:

```json
"testArgs": ["tests/test_case_emit.py", "-k", "full_sequence"]
```

The script concatenates and knows nothing about any test framework — which is what 1.4.7
actually implies. An optional `label` carries the display string for the reporter's
`MUT A [full_sequence]` line, the job `filter` was doing incidentally.

## Decision 4 — JS only; **`mutate.ps1` must not be written**

`gaw`'s `scripts/asdlc/*.ps1` are hand-ports of this repo's `*.js`, so the default assumption
would be that `mutate` gets ported too. It does not.

Node is already present wherever the plugin's scripts run, so `gaw` invokes
`node mutate.js` directly. One implementation means one set of encoding bugs to fix once —
and encoding bugs are not hypothetical here: the corruption that motivated this tool
(`Get-Content -Raw` / `Set-Content` destroying every em-dash in a source file) is a
PowerShell-specific hazard that a port would re-import wholesale, alongside the
"pure ASCII source file" constraint `checkpoint-hooks.ps1` already documents.

**This decision is the reason the file exists in this form.** A future maintainer finding
`mutate.js` without a `.ps1` sibling should read that as deliberate, not as an unfinished
port.

---

## Verdicts

| Verdict | Meaning | What the model does |
|---|---|---|
| `RED-AS-PREDICTED` | Test failed **and** output contains `expectRed` | Record it. Done. |
| `RED-WRONG-REASON` | Test failed, `expectRed` absent | **Discard.** Collateral damage, fixture collision, or the mutation is bigger than intended. |
| `GREEN` | Test passed | The test is HOLLOW **or** the mutation is INERT. The model must decide, and say which. |
| `ANCHOR-MISS` | `find` not present in the file | Never silent. Non-zero exit; the run is not evidence. |
| `AMBIGUOUS-ANCHOR` | `find` present **more than once** | As above. |
| `NO-OP` | `find` present but `replace` produced an identical file | As above — the mutation cannot change behaviour. |
| `DIRTY-REVERT` | Post-run file content ≠ pre-run content | **Hard failure**, abort the whole run. |

### `AMBIGUOUS-ANCHOR` is an addition to the proposal

The proposal is silent on a `find` string that occurs more than once, so the default
behaviour would be "mutate the first match". That is the same failure class as
`ANCHOR-MISS`: **the run reads clean while the evidence is wrong.** A silently-skipped
mutation is the exact failure the practice exists to prevent, reproduced one level up in the
tooling; a silently-misplaced one is worse, because it produces a verdict rather than a gap.

### Reading of 1.4.3 ("verify the anchor before running anything")

A bad anchor skips **that mutation's** test run; the loop continues to the remaining
mutations, and the **process** exits non-zero. The alternative reading — abort the entire run
on the first bad anchor — makes a twelve-mutation manifest cost twelve cycles to debug, and
the anchors were authored blind in one pass, so they tend to fail in batches.

## Per-mutation flow

```
read bytes (fs.readFileSync utf8) → keep `before`
  → applyMutation
      → anchor-miss / ambiguous / no-op? record, skip the run, continue to the next
  → write mutated
  → runCapture(testCommand ++ testArgs, {cwd, env}) → classify
finally:
  → write `before` back → re-read → byte-compare
      → mismatch ⇒ DIRTY-REVERT ⇒ abort the whole run
```

Classification: `status === 0` → `GREEN`; non-zero with `expectRed` in stdout+stderr →
`RED-AS-PREDICTED`; non-zero without it → `RED-WRONG-REASON`.

The revert is verified after **every** mutation, not once at the end: one un-reverted
mutation poisons every subsequent result, and a run that discovers this at the end has to
discard all of them.

## Encoding and line endings

1. **Read and write bytes, never through a shell's default codec** — `fs.readFileSync(p,
   'utf8')` / `writeFileSync`.
2. **Normalize the anchor, never the file.** Detect the file's dominant ending, convert
   `find`/`replace` **into** that ending, and match against the **original** source. A
   `find` authored with `\n` must match a CRLF file — the proposal records three of eight
   mutations silently lost to exactly this.

   The proposal phrases this as normalizing both sides to `\n` and re-emitting in the
   file's ending. That is subtly wrong for a **mixed-ending** file: round-tripping the
   whole source promotes every lone `\n` to `\r\n`, changing bytes far outside the
   mutation and guaranteeing a `DIRTY-REVERT` — or worse, a diff the author blames on
   themselves. Normalizing only the anchor leaves everything outside the matched span
   byte-identical by construction. Its failure mode is an anchor that spans a mixed
   region reporting `ANCHOR-MISS`: loud, and the safe direction.
3. Non-ASCII content must survive the round trip byte-for-byte.

## Guards

- **Dirty working tree** — `git status --porcelain` must be empty, or `--allow-dirty` is
  required. The refusal prints the status that caused it, so an interrupted run leaves the
  author able to tell their own edits from a stranded mutation.
- **Crash safety** — a module-level `inFlight = {path, before}` record, restored by
  handlers on `SIGINT`, `SIGTERM` and `uncaughtException`, plus a `try/finally` around each
  mutation. Exit non-zero after restoring.

## CLI

```
node scripts/asdlc/mutate.js <manifest.json> [--only <id>[,<id>…]] [--dry-run] [--json] [--allow-dirty]
```

`--dry-run` applies and verifies every anchor without running any test — cheap validation of
a freshly authored manifest, which matters because anchors are written blind.

Output is human-readable per mutation plus a paste-ready Markdown table for the handoff;
`--json` emits the same as structured data.

## Non-goals

No mutation generation. No parallelism across mutations — they edit the same working tree,
and serializing is the point. No opinion about which tests to mutate; that is the plan's job.
No coverage integration — different question, different tool.

## Cost, and the scoping rule that follows

Measured in `gaw` v0.13-s8: **8.6 min of ~29 min of test wall-clock — 30%**. The practice is
therefore scoped to tests cited as evidence for an acceptance criterion or guarding a named
regression. It is not applied to every test, and
`skills/agentic-sdlc/references/test-mutation-evidence.md` must say so where a reader will
see it before they start.
