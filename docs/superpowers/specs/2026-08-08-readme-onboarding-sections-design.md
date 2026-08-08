# README onboarding sections — design (#18, #21)

**Date:** 2026-08-08
**Sprint:** v0.3-s3 (`sprint/v0.3-s3`)
**Issues:** [#18](https://github.com/LeadwoodSystems/agentic-sdlc/issues/18) (Before/With
diagram, slot 3) and [#21](https://github.com/LeadwoodSystems/agentic-sdlc/issues/21)
(60-second walkthrough, slot 7), both under epic
[#11](https://github.com/LeadwoodSystems/agentic-sdlc/issues/11).
**Assessed against:** `main` @ `2857041`, clean tree.

Both issues were blocked by #17, which landed in v0.3-s2 and put epic #11's section
skeleton in place. They are paired into one sprint because they touch one file, insert at
named slots in the same ordering, and share a single content-preservation concern — done
separately they would rewrite `README.md` twice and verify the slot ordering twice.

---

## 1. What each issue asks for, and what is actually open

Neither issue is open-ended. #18 drafts its diagram in its own body; #21 fixes its command
sequence in its own body. Both profiles therefore route planning to `fast` — *"the design
is settled in the issue itself, not merely because the issue looks small"*.

What was genuinely undecided, and is decided here:

1. How the walkthrough and the existing `## Installing` section share slot 7. Left
   explicitly to this sprint by v0.3-s2's handoff (follow-up 10).
2. Whether the diagram is adopted verbatim, given that #18's own draft does not satisfy
   #18's own third acceptance criterion.
3. How "any command output shown is real, not illustrative" is satisfied for commands that
   have no deterministic stdout.
4. Whether this sprint adds the first automated test that reads `README.md`.

## 2. Slot 7 — `## Quick start` with installing nested

Epic #11's fifteen-slot ordering has **no slot for installing at all**. v0.3-s2 parked
`## Installing` in slot 7, which is the walkthrough's slot. So the two have to be
reconciled, and this sprint is where.

**Decision.** One `## Quick start` owns slot 7:

```
## Quick start
### 1. Install
### 2. Run your first sprint
```

Installing becomes step zero of a first sprint rather than a standalone chore, and the
heading matches the slot's name in the epic. The cost is one more heading demotion in a
file that took six of them last sprint, which is why the content rule below is strict.

**Rejected — two siblings** (`## Installing` then `## Your first sprint`). Cheaper: it
disturbs nothing v0.3-s2 landed. Rejected because slot 7 would hold two `##` headings,
satisfying the epic's ordering only loosely, and because it leaves installing looking like
a prerequisite chore disconnected from the loop it enables.

**Rejected — walkthrough above installing.** Argued on the grounds that a reader wants to
see the loop before committing to an install. Rejected because a reader following the page
top-to-bottom then meets commands they cannot yet run.

### The content rule for the move

The two install claims are inventoried items from #17's 82-claim inventory
(`README.md:45-48` local install, `README.md:52-55` remote install). They relocate
**byte-identical** — heading level changes, body text does not.

Install *accuracy* is explicitly out of scope: it is
[#22](https://github.com/LeadwoodSystems/agentic-sdlc/issues/22)'s job (audit public
installation and plugin naming, the only `risk/medium` issue in the epic, carrying an open
decision about the marketplace identifier). "Improving" the install text here would
pre-empt an audit that has not run.

## 3. Slot 3 — the diagram

**Decision.** Keep #18's two-block contrast, but give the with-path a second column naming
the artifact each step leaves on disk. Vertical layout, in a ` ```text ` fence, under a new
`## Before ASDLC / with ASDLC` heading between `## The problem` and
`## The core mental model`.

```text
WITHOUT A CONTROL PLANE

  Session 1   build
                ↓
              session ends — what happened lives only in a transcript
                ↓
  Session 2   rediscover → assume → continue
                                       ↓
  Session 3   drift

WITH ASDLC

  Issue         the spec
    ↓
  Plan          docs/superpowers/plans/<sprint>.md
    ↓
  Sprint        one branch, one worktree
    ↓
  Build         code + tests
    ↓
  Evidence      real command output, real counts
    ↓
  Handoff       docs/handoffs/<sprint>.md
    ↓
  Checkpoint    STATUS.md entry, staged changes, human approves
    ↓
  Next session resumes from the handoff
```

Wording may be refined during implementation — #18 permits it explicitly, provided the
contrast survives. The artifact column may not be dropped: it is the acceptance criterion.

**Rejected — adopt #18's draft verbatim.** Its with-path reads
`Issue → Plan → Isolated Sprint → Build → Evidence → Handoff → Checkpoint`, which names
*steps*. #18's third acceptance criterion requires the with-path to name *the artifact each
step produces, not just the step*. Landing the draft unchanged would ship a section that
fails its own criterion. This is the same precedence call v0.3-s2 recorded as a general
rule: **where the issue's own draft and the issue's acceptance criterion conflict, the
criterion governs, and the deviation is flagged rather than silently taken.**

**Rejected — horizontal layout** (one chain per block, artifacts in a row underneath). Half
the vertical cost, which matters for an above-the-fold diagram. Rejected because at 80
columns the artifact labels compress to two or three words each, and the specificity —
`docs/handoffs/<sprint>.md` rather than "handoff" — is the entire point of the column.

**Unicode arrows are deliberate.** `→` (U+2192), `↓` (U+2193) and `—` (U+2014) are all
single-width BMP characters and are already established in this file (`README.md:25`,
`README.md:173`). No ASCII-art fallback.

## 4. The gate — the first test that reads `README.md`

v0.3-s2 recorded that nothing automated reads `README.md`: `asdlc-lint.js` is scoped to
`CLAUDE.md`, and no test targets the README. For #17 that left review as the only gate.
#18 is different — its second acceptance criterion is *mechanical*.

**Decision.** Add `scripts/asdlc/test/readme-text-blocks.test.js`, asserting:

1. `README.md` contains **at least one** ` ```text ` fenced block.
2. Every line inside every ` ```text ` fenced block is ≤ 80 columns.

### Why assertion 1 is load-bearing

No ` ```text ` block exists in `README.md` today — measured, every existing fence is a bare
` ``` `. A width-only test would therefore pass vacuously against an empty set, and the
TDD phase for this sprint would be theatre. With the existence check the test is genuinely
**red before the diagram lands and green after**, and it pins #18's first acceptance
criterion (*"in a `text` fenced block"*) as well as its second.

### Why the scope is ` ```text ` and not every fence

Measured on `main` @ `2857041`, the existing layout tree exceeds 80 columns on six lines,
the worst being `README.md:131` at **104**. A repo-wide fence-width rule would fail
immediately and force a rewrite of the layout tree — content that #17's Non-Goal against
content loss protects, and work neither #18 nor #21 asks for. Scoping to ` ```text `
governs exactly the new content and nothing else.

### Implementation constraints

- **CRLF.** Files on disk are CRLF (`core.autocrlf` is on). Split on `/\r?\n/`; a trailing
  `\r` must not count toward the 80.
- **Fence scanning.** Track open/closed state. A closing ` ``` ` must not be read as
  opening a new, unlabelled block.
- **Column counting is `.length`**, i.e. UTF-16 code units. That equals display columns for
  the single-width BMP characters used here, and would not for CJK, emoji, or anything
  needing a surrogate pair. Recorded as a known limit, not fixed: no such character is in
  scope, and a full width-aware implementation is a dependency this repo does not take
  (`#zero-dependencies`).
- The test reads the real `README.md`, not a fixture — it is asserting about this repo's
  own published document.

The suite count rises. The new value is **not predicted here and not typed anywhere**:
`.asdlc/facts.json` measures it and `facts.js` rewrites the span (`#ports-are-prose`).

**Rejected — no test, review is the gate.** Consistent with v0.3-s2's finding, and cheaper.
Rejected because the constraint would then hold only as long as the next editor remembers
it, and because this repo's `#checkpoint` rule requires building test-first — for a
documentation sprint with no test at all, that phase is vacuous.

**Rejected — also gate heading order against the epic's slots.** v0.3-s2 deferred the
structure-enforcement decision to
[#23](https://github.com/LeadwoodSystems/agentic-sdlc/issues/23), and three of the epic's
fifteen slots were left deliberately absent by v0.3-s2. This sprint fills two of them —
slot 3 via #18 and slot 7's walkthrough via #21 — leaving slot 6 (deterministic vs
agentic), which is #19's output. A heading-order test would have to encode which absences
are legal
— which is precisely the judgment #23 exists to make. This sprint gates *legibility*, not
*structure*.

## 5. The walkthrough — content and the accuracy risk

#21's risk is not implementation, it is misdescription: *"walk the sequence against the
actual command prose in `commands/*.md` and confirm no step is misdescribed."* Every row
below is cited, and the citations are the deliverable as much as the prose is.

| Step | Required? | Reads | Produces | Cited |
|---|---|---|---|---|
| `/bootstrap-asdlc` | once per repo | the repo as it stands | `CLAUDE.md`, `docs/STATUS.md`, both `_TEMPLATE.md`s, `scripts/asdlc/`, `.asdlc/facts.json`, `.asdlc/policy/execution-classes.yaml` | `bootstrap-asdlc.md:12-61` |
| `/verify-issue 42` | **selective** | the issue + the codebase | a corrected issue body on the tracker | `verify-issue.md:13-17`, `:62-65` |
| `/profile-issue 42` | recommended | the issue, the codebase, `.asdlc/policy/execution-classes.yaml` | `## ASDLC Execution Profile` block + `complexity/`·`risk/`·`execution/` labels | `profile-issue.md:11-12`, `:73-88`, `:92-97` |
| `/sprint auth-refresh` | required | `CLAUDE.md` + the latest handoff | branch `sprint/vX.Y-sN` + a seeded plan file | `sprint.md:12-20` |
| build test-first | required | the plan | code + tests | `sprint.md:21-22` |
| `/handoff` | required | what actually happened | `docs/handoffs/<sprint-id>-<slug>.md` + the drafted STATUS line | `handoff.md:15-17` |
| `/checkpoint` | required | `CLAUDE.md` § Run / verify | targeted test result, `docs/STATUS.md` entry, `CLAUDE.md` pointer span, staged changes — then **stops for human approval** | `checkpoint.md:12-20`, `:35-44`, `:45-47` |
| `finish-sprint.js` → `/clear` | after the PR merges | the merged sprint | worktree retired, branch cleaned | `checkpoint.md:51-53` |

`/asdlc-hygiene` is named as available at any time, outside the sequence
(`bootstrap-asdlc.md:63-64`).

### The trap the profile named

`commands/verify-issue.md:16-17` states plainly: *"Don't run it on every issue — it's a
multi-pass research effort, reserve it for issues about to become real work."* #21's own
profile flags this as the specific trap. A walkthrough showing `/verify-issue` as a routine
step would misrepresent the loop — which is the failure #21 exists to prevent. It is marked
selective **with the reason stated**, not merely with an "optional" tag. The same
distinction applies more weakly to `/profile-issue`, which
`profile-issue.md:11-12` positions as complementary and recommends running *after*
`/verify-issue` on anything architectural or stale.

### No stdout blocks

**Decision.** Each step names the artifact or state change it produces. No command output
is reproduced anywhere.

`/sprint`, `/handoff` and `/checkpoint` are prose executed by an agent; they have no fixed
stdout. Only the scripts underneath them print deterministically. A slash command's real
product is a file on disk, so naming the artifact *is* the accurate representation — this
satisfies #21's "any command output shown is real" by showing none, and satisfies its
"each command lists the artifact/state it produces" directly.

**Rejected — real script output where it exists.** `new-sprint.js` and `checkpoint-hooks.js`
do print, and this session's own gate run produced quotable output. Rejected because it
mixes two registers in one walkthrough, and the output is Windows-path-flavoured and dated
— stale evidence in a document nothing re-measures.

**Rejected — full transcript of one real sprint.** Maximally verifiable, and far past
sixty seconds. It would also drag this repo's issue numbers and sprint ids into a document
meant to generalise, against the epic's Non-Goal on project-specific detail.

## 6. Scope

**In:** `README.md` (slot 3 insertion, slot 7 restructure + insertion);
`scripts/asdlc/test/readme-text-blocks.test.js` (new); `docs/mutation-manifests/v0.3-s3.json`
(new); the plan, this spec, and the handoff.

**Out:** any change to `skills/`, `commands/`, or any script under `scripts/asdlc/` other
than the new test file — epic #11's Non-Goal. Install text accuracy (#22). Heading-order
enforcement (#23). `docs/architecture.md` (#19) and `docs/philosophy.md` (#20), which are
independent of the skeleton. Slot 6 (deterministic vs agentic) stays absent — it is #19's
output.

## 7. Tasks

Dependency-ordered:

1. **Write the failing test.** `readme-text-blocks.test.js`, both assertions. Confirm it is
   red for the *existence* reason, not an incidental one.
2. **Add the diagram** at slot 3. Test goes green.
3. **Restructure slot 7** — `## Quick start`, `### 1. Install` with the two install claims
   byte-identical.
4. **Write the walkthrough** as `### 2. Run your first sprint`, every row re-verified
   against `commands/*.md` at implementation time rather than trusted from §5.
5. **Mutation manifest** `docs/mutation-manifests/v0.3-s3.json` for the new test — the
   handoff cites it as evidence for #18's criteria, which is exactly the condition
   `commands/checkpoint.md:21-34` attaches the practice to. Anchor on assertion text, never
   on a substring of a test title (v0.3-s2's `EXPECT-RED-INERT` incident).
6. **Verification pass** — full suite, `facts.js --check`, `asdlc-lint.js`, measured max
   column inside the diagram, and an independent re-walk of the walkthrough's citations.
7. **Write the handoff.**

Task 7 is an explicit task because v0.3-s2's plan had none: seven tasks each individually
clean, and the sprint's own resume point left as a placeholder, with everything the sprint
knew living only in gitignored scratch files. That incident is recorded in
`docs/handoffs/v0.3-s2-issue-kinds-and-readme.md`; this plan does not repeat it.

## 8. Evidence to capture for the handoff

- Suite count before and after, both from `facts.js`, never typed.
- `node scripts/asdlc/facts.js --check` and `node scripts/asdlc/asdlc-lint.js` exit codes.
- The test red → green transition, with the red reason quoted.
- The mutation table from `node scripts/asdlc/mutate.js docs/mutation-manifests/v0.3-s3.json`.
- Measured maximum column width inside the new ` ```text ` block.
- The walkthrough's per-row `commands/*.md` citations, re-verified independently of the
  agent that wrote them.
- Confirmation that the two install claims are byte-identical across the slot-7 move.

## 9. Follow-ups to record at handoff

- Slot 6 (deterministic vs agentic) is still absent, owned by #19.
- Whether README structure deserves an order test remains #23's call; this sprint's test
  deliberately does not pre-empt it.
- The `.length`-as-columns limit in the new test, if any non-BMP or wide character is ever
  introduced to a ` ```text ` block.
- #22 has not run, so the install text this sprint relocated is unaudited.
- **Correction (human ruling, mid-sprint, 2026-08-08):** §3's diagram (originally rendered
  at what was line 105) and §5's walkthrough table (originally line 203) both credited
  `/checkpoint` with producing "a staged commit." `/checkpoint` stages changes and stops; it
  does not commit — `commands/checkpoint.md:45-47` is the ground truth: "Do **not** commit
  or push automatically... present the proposed commit and **STOP for the user's
  approval**." The plan (`docs/superpowers/plans/v0.3-s3-readme-onboarding-sections.md`)
  carried the same wording into its Task 2 Step 1 draft and Task 4 Step 1 table, which is
  how it reached `README.md`. The human ruled on it mid-sprint when a blind re-walk caught
  the README instance (see `docs/handoffs/v0.3-s3-readme-onboarding-sections.md`, Incident
  2): "fix it - the cell becomes staged changes, not a staged commit." Both instances in
  this spec are now corrected to "staged changes" so a future session re-deriving the
  diagram or table from this spec does not reintroduce the defect.
