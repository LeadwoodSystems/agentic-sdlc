# gh-hygiene issue-limit honesty — design

**Date:** 2026-08-07
**Sprint:** v0.3-s1 (`sprint/v0.3-s1`)
**Issue:** [#57](https://github.com/LeadwoodSystems/agentic-sdlc/issues/57)
**Status:** approved, not yet implemented

## The problem

`findUntriagedIssues` (`gh-hygiene.js:193-199`) shells out as:

```js
['issue', 'list', '--state', 'open', '--json', 'number,labels,milestone']
```

No `--limit`, so `gh` applies its default of **30**. Every open issue past the thirtieth is
invisible to the audit, and nothing in the output says so. Measured at `5b0009d`: 46 open
issues, 39 genuinely unprofiled, **30 reported**, nine silently omitted.

`/profile-issue` is documented as consuming exactly this list —
`references/execution-profiles.md` calls the `no-execution-profile` finding "the *needs
profiling* worklist" — so nine issues can never be picked up through the intended flow.

The defect survived because it was harmless: `CLAUDE.md` records that this repo has no open
issues, so the check had never run against a real backlog until the Capability Layer backlog
was created.

**The same lesson is already written down twelve lines below.**
`findFailingScheduledWorkflows` (`:252-266`) passes an explicit bound and carries this
comment at `:257-259`:

> Filtered server-side, not client-side over a mixed-event list: with `--limit N` across all
> events a weekly workflow falls off the end on a busy repo and reports as absent, **which
> reads as clean**.

The issue-list call has the identical defect and never received the fix. A finding that reads
as clean while being wrong is the exact failure class this script exists to catch.

## What we found while designing

Three things surfaced that changed the shape from what the issue anticipated.

**The issue's proposed regression test is inert.** #57's Test Coverage section asks for "46
stubbed open issues, 39 unprofiled → all 39 reported (the regression test; fails on today's
code)". It does **not** fail on today's code. The stubbed runner ignores the arguments it is
handed and returns all 46 regardless, so it never reproduces `gh`'s server-side cap — the
thing being fixed is the *absent argument*, and a stub that does not read arguments cannot
observe it. A test that cannot fail is not evidence
(`references/test-mutation-evidence.md`). The regression test therefore asserts on the
**arguments the runner receives**, not on the parsed output. **Test Coverage** bullet 1 on
the issue should be corrected to match.

**Truncation cannot be reported without changing the return shape.** `findUntriagedIssues`
returns a bare array. `isCheckError` (`:391-394`) treats a genuine result as "an array, or an
object with its own shape", reserving exactly `{ error: string }` for a `safeCheck` failure.
An object with two keys cannot collide with that, so `{ findings, truncated }` is safe — but
it does modify seven existing assertions, which contradicts the issue's **Test Coverage**
bullet 4, "existing `no-labels` / `no-milestone` / `no-execution-profile` cases still pass
unmodified".
That bullet is superseded; the behaviour those cases assert is preserved exactly, only their
shape changes.

**The problem is already solved once in this file.** `findStaleRemoteBranches` returns
`{ stale, unknown }` and its `format` (`:338-344`) carries the comment "report what could not
be judged rather than counting it as clean — the whole point of this check is that unseen
debris is how it survives." That is this problem, in this file, with the answer already
chosen. The new shape and its rendering follow it deliberately rather than inventing a
second convention.

## Design

### 1. One constant, two uses

```js
const ISSUE_LIST_LIMIT = 1000;
```

Feeds both the `--limit` flag and the cap comparison, so the bound and its detector cannot
drift apart — the single-source principle `HYGIENE_CHECKS` established in v0.2-s9.

**Deliberately not configurable.** No option, no env var, no CLI flag. The issue's governing
sentence is "no configuration should be able to make the audit under-report in silence", and
a tunable limit is precisely that configuration.

### 2. `findUntriagedIssues` returns `{ findings, truncated }`

`findings` is the existing array, unchanged in content and order.
`truncated` is `issues.length >= ISSUE_LIST_LIMIT`.

`>=` rather than `===` is deliberate: with exactly 1000 open issues the audit reports
possible truncation when the list may in fact be complete. False alarms are the safe
direction here; silence is not.

### 3. The comment carries the justification

Written in the register of `:257-259`, recording why a raised bound rather than
`gh api --paginate`:

- `gh issue list --limit N` paginates internally up to `N` and returns **issues only**.
- The REST `/issues` endpoint `--paginate` would reach returns **pull requests too**, so the
  fix would have to discriminate on the `pull_request` key or report every open PR as
  untriaged. That is new logic and new bug surface inside a straight bug fix.
- So the bound stays, and the cap check is what makes the bound honest.

### 4. `format` appends, never replaces

```text
Untriaged issues: #3 (no-labels), #7 (no-milestone) · TRUNCATED: hit the 1000-issue limit, list may be incomplete
```

Same shape as `staleRemoteBranches`' ` · unjudged: …`. The findings you did collect are
still reported — this file's stated philosophy at `:300-304` is "tell the human as much as
you can find out", so a possible 1001st issue must not blank out the 1000 real ones.

### 5. Exit code unchanged

Truncation does **not** set `process.exitCode = 1`. In this script findings never fail the
audit; only a broken check does (`:415-417`). Truncation is a degraded result, not a failed
check, so it follows the existing rule rather than carving an exception into it.

## Scope

**In:** `findUntriagedIssues`, the new constant, the `untriagedIssues` entry in
`HYGIENE_CHECKS`, and the affected tests in `scripts/asdlc/test/gh-hygiene.test.js`.

**Out:**

- Every other hygiene check. None is re-bounded, including the milestone and
  scheduled-workflow calls.
- What counts as untriaged. `PROFILE_LABEL_PREFIXES` (`:184-191`) is correct and untouched.
- #37's non-executable-issue-kind exemption. It lands in this same function next; this
  sprint deliberately goes first so #37 reasons about a known-complete input set.
- `checkMilestoneVersionSync` reporting OUT OF SYNC against the new milestone. Pre-existing,
  unrelated, recorded in the roadmap as an open question.

## Test plan

TDD, red first. `scripts/asdlc/test/gh-hygiene.test.js`, existing stubbed `runner` seam.

| # | Test | Red on today's code because |
|---|---|---|
| a | the runner is invoked with `--limit` and `String(ISSUE_LIST_LIMIT)` | no `--limit` is passed at all |
| b | count `== ISSUE_LIST_LIMIT` → `truncated: true`, and the notice reaches rendered output | the shape does not exist |
| c | count `< ISSUE_LIST_LIMIT` → `truncated: false`, no notice | the shape does not exist |
| d | `runHygieneAudit` does not mistake `{findings, truncated}` for a `safeCheck` error | the shape does not exist |
| e | the three existing behaviour cases, ported to the new shape | regression guard |

Test (b) generates its 1000 stub issues in a loop rather than adding a test-only `limit`
injection point, keeping the production knob count at zero per §1.

`ISSUE_LIST_LIMIT` is exported so test (a) asserts against the constant rather than a
hard-coded `'1000'` that would have to be edited in two places.

## Verification

- Full suite green: `node --test "scripts/asdlc/test/**/*.test.js"`.
- `node scripts/asdlc/facts.js` — the test count moves and the facts span must be
  re-measured, not hand-edited.
- `node scripts/asdlc/asdlc-lint.js`.
- Live `node scripts/asdlc/gh-hygiene.js main v0.3` against this repo's real 47-issue
  backlog, captured as handoff evidence: the untriaged count must rise from 30 to the true
  figure. This is the only end-to-end proof, since the repo has no CI.
- Mutation evidence is **offered, not required** (`CLAUDE.md#review`). Candidate manifest
  `docs/mutation-manifests/v0.3-s1.json`: `LIMITDROP` (remove the `--limit` argument),
  `CAPBLIND` (hard-code `truncated: false`), `FORMATDROP` (drop the TRUNCATED suffix from
  `format`). Each should go RED in exactly one named test.

## Prose gate

The v0.2-s9 two-tier gate (`test/command-prose.test.js`) passes unmodified: the label
`Untriaged issues` is unchanged and `HYGIENE_CHECKS.length` stays at 7, so neither the
findings list nor the numeral in `commands/asdlc-hygiene.md` drifts. No command file needs
editing this sprint.

## Rejected alternatives

**`gh api --paginate` over REST `/issues`.** Truly unbounded, no cliff to detect. Rejected:
the endpoint returns pull requests alongside issues, so it needs `pull_request`-key
discrimination that today's code does not have, plus field remapping to preserve the
`labels`/`milestone` shapes `gh issue list --json` produces. New bug surface inside a bug
fix, to remove a cliff that cap detection already makes non-silent.

**An escalating limit loop** — fetch at `N`, re-fetch higher whenever the count comes back
equal to `N`. Removes the cliff entirely while keeping issue-only semantics. Rejected as
disproportionate: a retry loop and its termination condition to design, test and mutate, for
a backlog of 47.

**Throw on cap, letting `safeCheck` render `could not check (…)`.** Zero shape change, all
existing tests unmodified, and arguably the purest reading of the `facts.js` `**UNMEASURED**`
convention the issue cites. Rejected because it discards the findings already collected,
turning a near-miss into a total blackout, against `:300-304`.

**A synthetic `{reason: 'result-truncated'}` entry in the findings array.** Preserves the
return type and every existing assertion. Rejected: `format` would have to special-case an
entry with no `number`, and the array would mix facts about issues with facts about the
audit itself — the list whose single-purpose filterability `:208-213` exists to protect.

## Follow-ups to record at handoff

1. **Correct #57's Test Coverage section** — bullet 1 (the inert regression test) and
   bullet 4 ("existing cases pass unmodified") are both superseded by this design. Note it is
   the **Test Coverage** list, not Acceptance Criteria; all six acceptance criteria hold as
   written.
2. **Note the shape change for #37**, which modifies this same function and its tests next.
