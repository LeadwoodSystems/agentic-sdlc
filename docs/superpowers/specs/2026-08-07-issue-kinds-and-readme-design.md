# Non-executable issue kinds, and the README information architecture — design

**Date:** 2026-08-07
**Sprint:** v0.3-s2 (`sprint/v0.3-s2`)
**Issues:** [#37](https://github.com/LeadwoodSystems/agentic-sdlc/issues/37) (epic half only),
[#17](https://github.com/LeadwoodSystems/agentic-sdlc/issues/17)
**Status:** approved, not yet implemented

Two unrelated surfaces in one sprint, at the user's direction. They share no code and no
file. Part 1 is code plus tests; Part 2 is documentation only. They are planned, built and
evidenced separately, and the handoff reports them as two independent verification blocks —
a single mixed evidence section would make it impossible to tell which half moved a result.

---

# Part 1 — #37: non-executable issue kinds

## The problem

`findUntriagedIssues` (`gh-hygiene.js:207-235`) flags every open issue lacking one label from
each of `complexity/`, `risk/`, `execution/` as `no-execution-profile` — documented in
`references/execution-profiles.md` as *the* "needs `/profile-issue`" worklist.

That is correct for implementation issues. It is wrong for **epics**: #11–#16 are trackers,
decomposed into sub-issues and never executed directly. No execution class can be assigned to
"Public repository positioning and onboarding" as a whole, so all six sit on the worklist
permanently. Measured at `d1854f0`: 39 `no-execution-profile` findings, of which **6 are
epics** — 15% of the worklist is noise that can never be cleared.

#37 also covers **decision tickets** (#33's output is an ADR, not code). That half is
explicitly *blocked by #33*, which is still open. Only the epic half lands here; the
mechanism is designed so the other half needs no code change.

## What we found while designing

Three things surfaced from the live tracker that change the shape #37 anticipated.

**GitHub's native Issue Types are unavailable.** `gh issue list --json` exposes an
`issueType` field, which would be the purpose-built mechanism for exactly this distinction.
It returns `null` for all 46 open issues — this repo has never configured Issue Types, and
doing so is org-level tracker configuration, not a change to this script. Ruled out, and
recorded here so the next person does not rediscover the field and assume it was overlooked.

**An `epic` label already exists** on #11–#16. #37 asks for a prefix-checked exemption
"consistent with `PROFILE_LABEL_PREFIXES`", which `epic` is not — it is an exact value, and
every future kind would need a code edit. The label is migrated rather than reused.

**The replacement completeness check is free.** #37 asks whether an exempted epic should
carry a *different* completeness signal — "it must have sub-issues" — and treats that as
possibly too expensive to be worth it. It is not: `gh issue list --json` also exposes
`parent`, populated on every one of #17–#56. So the full parent→child map falls out of the
**same single call** `findUntriagedIssues` already makes. No second request, no new
truncation surface, no new failure mode.

**A correction to #37's premise.** Its Scope section warns that "an exemption that lets a
whole class of issue escape all hygiene checks is a worse outcome than the dilution it
fixes." An exempted epic does not escape all checks — `no-labels` and `no-milestone`
(`:217-222`) still apply, and a `kind/epic` label satisfies neither by accident. Only
`no-execution-profile` is skipped. The concern is directionally right and the replacement
check is worth having on its own merits, but the stated stakes are higher than the code
supports. To be corrected on the tracker at handoff.

## Design

### 1. `NON_EXECUTABLE_KIND_PREFIX`

```js
const NON_EXECUTABLE_KIND_PREFIX = 'kind/';
```

An issue carrying any label starting `kind/` is not executed directly, so
`no-execution-profile` does not apply to it. Prefix-matched for the same reason
`PROFILE_LABEL_PREFIXES` is (`:178-184`): adding `kind/decision` when #33 unblocks the other
half of this issue is a tracker action, not a code change.

Singular constant, not a set of permitted values. Enumerating the legal kinds here would
recreate the exact-value coupling the prefix exists to avoid, and the audit has no reason to
care *which* non-executable kind an issue is — only that it is one.

### 2. Epics carry a different completeness check

Exemption is not a free pass. An issue labelled `kind/epic` is instead checked for having at
least one open sub-issue, reported as:

```js
{ number, reason: 'epic-without-open-sub-issues' }
```

Derived by collecting `parent.number` across the issues already fetched, then testing each
`kind/epic` issue's own number for membership. `--json` gains `parent`; nothing else about
the call changes.

**The reason is named `epic-without-open-sub-issues`, not `epic-without-sub-issues`.** The
call is `--state open`, so the parent set can only prove an epic has *open* children. An
epic whose children have all been closed will be flagged, and the name says exactly why —
it does not claim the epic has no children, only that none are open. That is also a useful
signal in its own right: an epic with no open work left should be closed. This follows the
`facts.js` `**UNMEASURED**` convention and the `staleRemoteBranches` `unjudged:` precedent —
a check states what it measured, never what it would like to have measured.

Only `kind/epic` gets this check. Other kinds are exempt from `no-execution-profile` with no
replacement, because no other kind exists yet and inventing a completeness rule for a
hypothetical one is the label taxonomy #37's Non-Goals forbid.

### 3. The tracker migration is part of the sprint

Six `gh issue edit` calls swapping `epic` for `kind/epic` on #11–#16. Without them the code
change is inert against the real backlog, and the live audit — the only end-to-end evidence
this repo has, since it has no CI — would show no movement.

The `epic` **label definition** is left in place, unused. Deleting a label is an
irreversible tracker mutation that buys nothing this sprint; it is recorded as a follow-up.

### 4. What does not change

`HYGIENE_CHECKS` gains no entry — this is a new *reason* inside `untriagedIssues`, not a new
check. `HYGIENE_CHECKS.length` stays 7 and every label is untouched, so the v0.2-s9 two-tier
prose gate passes without editing the numeral or the findings list. The `format` function is
untouched: a new reason renders through the existing `#N (reason)` path.

`commands/asdlc-hygiene.md` still needs a prose edit — its fix-suggestion paragraph
(`:55-57`) tells the reader to run `/profile-issue` for any `no-execution-profile` finding,
and now has a second reason and an exemption to explain. That paragraph is outside the gated
findings sentence, so the edit is free-form.

## Scope

**In:** `NON_EXECUTABLE_KIND_PREFIX`, the `parent` field, the sub-issue derivation and the
`epic-without-open-sub-issues` reason in `findUntriagedIssues`; its tests; the
`asdlc-hygiene.md` prose; the six-issue tracker relabel.

**Out:**

- **Decision tickets.** Blocked by #33. The prefix already accommodates them.
- **`PROFILE_LABEL_PREFIXES` semantics** for ordinary implementation issues — unchanged, and
  #37's Non-Goals forbid weakening them.
- **Deleting the `epic` label definition.** Follow-up.
- **`isCheckError`'s key-arity typing** (`:416-419`), carried as a known gap from v0.3-s1 and
  suggested there as natural to bundle here. Declined: the return shape is unchanged this
  sprint, so nothing new pushes on that predicate, and hardening it is a separate concern
  from what #37 asks for.
- **`checkMilestoneVersionSync` reporting OUT OF SYNC.** Pre-existing, still undecided.

## Test plan

TDD, red first. `scripts/asdlc/test/gh-hygiene.test.js`, existing stubbed `runner` seam.

| # | Test | Red on today's code because |
|---|---|---|
| a | implementation issue with no profile labels → `no-execution-profile` | regression guard — must stay green throughout |
| b | issue labelled `kind/epic`, with an open child → no `no-execution-profile` finding | the exemption does not exist |
| c | issue labelled `kind/epic`, no open child → `epic-without-open-sub-issues` | the check does not exist |
| d | issue labelled `kind/anything-else`, no children → exempt, and **no** epic check | the prefix does not exist |
| e | the runner is invoked with `parent` among the `--json` fields | `parent` is not requested |
| f | an epic still reports `no-milestone` when it has none | pins that the exemption is scoped to one reason |

Test (f) is what makes the correction in *What we found* checkable rather than asserted.

Tests (b)–(d) stub the runner directly; none needs a fixture repo, so none pays
`makeFixtureRepo`'s ~80× bootstrap. That is deliberate — v0.3-s1 left three fixture-repo
tests that never touch the filesystem, and this sprint does not add a fourth.

## Verification

- Full suite green: `node --test "scripts/asdlc/test/**/*.test.js"`.
- `node scripts/asdlc/facts.js` — the test count moves; re-measure, never hand-edit.
- `node scripts/asdlc/asdlc-lint.js`.
- **Live `node scripts/asdlc/gh-hygiene.js main v0.3`, before and after the relabel.**
  Expect `no-execution-profile` findings to drop from 39 to 33, with #11–#16 absent and no
  `epic-without-open-sub-issues` finding (every epic currently has open children). Captured
  in the handoff as the load-bearing evidence.
- Mutation evidence **offered, not required** (`CLAUDE.md#review`). Candidate manifest
  `docs/mutation-manifests/v0.3-s2.json`: `KINDBLIND` (make the prefix test always false),
  `CHILDBLIND` (hard-code the epic check to pass), `PARENTDROP` (remove `parent` from the
  `--json` field list). Predict `expectRed` against `node:assert/strict`'s
  `${actual} !== ${expected}` message order — v0.3-s1 shipped that prediction backwards.

## Rejected alternatives

**Keep the existing `epic` label, exact-matched.** No tracker churn. Rejected: contradicts
#37's third acceptance criterion, and every future kind becomes a code edit.

**Recognise both `epic` and `kind/epic`.** No relabelling, criterion satisfied. Rejected:
two labels meaning one thing drift apart silently, and nothing would ever remove the
duplication.

**GitHub native Issue Types.** The purpose-built mechanism. Rejected as unavailable — see
*What we found*; it would be a tracker-configuration project, not this sprint.

**Exempt with no replacement check.** Permitted by #37's fourth acceptance criterion if
justified. Rejected because the replacement turned out to be free, which removes the only
argument for skipping it.

**Second `--state all` call so closed children count.** Semantically the check #37 literally
names. Rejected: a second network call and a second truncation surface, in a function that
spent all of v0.3-s1 being made honest about a single call's limits — and the naming in §2
makes the single call's answer accurate rather than approximate.

---

# Part 2 — #17: README information architecture

## The problem

`README.md` (173 lines at `d1854f0`) opens with a definition and reaches mechanism
immediately. "Checkpoint-gated", "handoff" and "spec-driven" all appear in the first four
lines, before the reader has been told what goes wrong without them. The material is good;
the ordering asks the reader to hold undefined terms.

Epic #11 already fixed the target ordering, so nothing about the skeleton is open. The work
is mapping existing prose onto it.

## Design

### 1. The ordering, and the sections #17 deliberately leaves out

Epic #11's 15-section order, with what supplies each section:

| # | Section | Source |
|---|---|---|
| 1 | Hero / one-sentence definition | rewritten from current `:1-11` |
| 2 | The problem | current `## The problem` |
| 3 | Before ASDLC / With ASDLC | **left out — #18** |
| 4 | The core mental model | current `## The two rules` |
| 5 | The sprint lifecycle | current `## The loop, per sprint` |
| 6 | Deterministic vs agentic responsibilities | **left out — arrives with #19** |
| 7 | 60-second quick start | **left out — #21**; `## Installing` moves here |
| 8 | Commands | current `## Commands` |
| 9 | State model | current `## State model` |
| 10 | Concurrency model | current worktree paragraphs, promoted out of §9 |
| 11 | Architecture / repository layout | current `## Layout` |
| 12 | Common failure modes | current `## Common mistakes` |
| 13 | Philosophy / design decisions | current `## Works for solo devs…` + pointer for #20 |
| 14 | Credits and influences | current `superpowers` orchestration paragraph |
| 15 | License | current `## License` |

**Three sections are deliberately absent, not stubbed.** #18, #19 and #21 own their content,
and #17's Non-Goals forbid writing it here. An empty heading is worse than no heading: it
reads as a documentation bug to every reader who arrives before those issues land. The
acceptance criterion is that the README *follows* the ordering — the sections that exist
appear in the epic's relative order, and each absent one has a named owner. Recorded as a
decision because a reviewer counting headings will find 12, not 15.

### 2. Content preservation is the whole risk

This is a reorder. Content loss is the regression, and a whole-file reorder produces a diff
no reviewer can read. So the claim inventory is built **first**, from the pre-change file:
every distinct technical assertion, as a checklist — roughly forty, including the facts-span
mechanic (`:66-73`), stable rule slugs (`:75-77`), the worktree concurrency rule
(`:79-83`), the naming scheme and archival command (`:85-88`), and every row of the commands
and state-model tables.

The inventory is written into the handoff and each line ticked against the rewritten file.
It is the evidence for acceptance criterion 2, and it is built before the edit specifically
so it cannot be reverse-engineered from the result.

### 3. The first screenful

Acceptance criterion 3 — "no undefined ASDLC-specific term" in the first screenful —
forces the hero rewrite. The current opening cannot satisfy it while containing
"checkpoint-gated" and "handoff". The replacement leads with the framing question #11
supplies ("AI coding works well *within* a session. What happens when the project lasts 20,
50, or 100 sessions?"), then the one-line answer in plain terms.

"Proven across 100+ sprints on one product" is a maturity claim and belongs to **#23**. It
moves with the rest of the prose and is not re-litigated here.

### 4. Anchors

Acceptance criterion 4 concerns inbound `README.md#` links. #17's own execution profile
records that a repo-wide grep returned no matches. That was measured at `5b0009d` and is
re-run at `d1854f0` before the edit, because the criterion is cheap to satisfy and cheaper
to check than to assume.

## Scope

**In:** `README.md` only.

**Out:** the diagram (#18), `docs/architecture.md` (#19), `docs/philosophy.md` (#20), the
walkthrough (#21), the install audit (#22), maturity-claim review (#23),
`skills/agentic-sdlc/SKILL.md` (#23's territory — a skill read by an agent and a README read
by a human are allowed to differ in shape), and any change to a command or script.

## Test plan

No new test. #17's own Test Coverage section says documentation-only, and the gate is the
existing suite staying green plus `asdlc-lint.js`. That is honest about what is actually
gated: `asdlc-lint.js` reads `CLAUDE.md` only (`asdlc-lint.js:36,344`) and nothing reads
`README.md`, so the runner can only prove nothing *else* broke.

A README-structure test — assert the section headings appear in the epic's relative order —
was considered. It would turn a documentation criterion into a real gate and would force
#18/#21 to insert their sections in the right slot. Not taken: inventing a new gate is
outside what #17 asks for, and it would need a maintenance contract with three unstarted
issues. Recorded as a follow-up for #23, which reviews public-facing terminology and is the
natural place to decide whether README structure deserves enforcement.

## Verification

- `node --test "scripts/asdlc/test/**/*.test.js"` green — proves no collateral damage.
- `node scripts/asdlc/asdlc-lint.js` clean.
- `git diff --stat` limited to `README.md`, confirming blast radius.
- Repo-wide grep for `README.md#` and `](README` returning no matches, re-run at head.
- The completed claim inventory in the handoff, every line ticked.
- **Review is the real gate** — per #17's execution profile, `review: standard`, comparing
  claim sets rather than reading the diff.

## Follow-ups to record at handoff

1. **Correct #37's Scope premise** — an exempted epic is still subject to `no-labels` and
   `no-milestone`; only `no-execution-profile` is skipped.
2. **Decision tickets remain open on #37**, blocked by #33. The prefix needs no code change
   when it unblocks; the tracker action is `kind/decision` on #33's output tickets.
3. **The `epic` label definition is left in place, unused** — delete when convenient.
4. **Three README sections are absent by design** (#18, #19, #21). Whoever lands those must
   insert at the epic's slot, not append.
5. **README structure is ungated** — the option of a heading-order test is deferred to #23.
