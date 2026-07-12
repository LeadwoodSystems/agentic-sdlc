# Issue verification methodology (for `/verify-issue`)

The detailed structure behind the adversarial issue-check. Written from a real run
across four issues in one project (two speculative architecture proposals, two
already-grounded technical-debt issues) — the methodology held for both cases, just
with a lighter touch on the already-grounded ones.

## Why this exists

Tracked issues rot in two different ways, and both waste a sprint if unnoticed:

1. **Written speculatively.** Someone (human or AI) wrote an architecture proposal
   against an imagined version of the codebase — referencing entities, interfaces, or
   patterns that don't exist, or that exist under a different name, or that a prior
   sprint already half-built differently. Building against the doc as written means
   re-deriving (or worse, re-implementing) things that already exist, or missing that
   the real gap is much narrower than the doc implies.
2. **Overtaken by later work.** The issue was accurate when filed, but the codebase
   kept moving — a dependency it named got refactored, a decision it was waiting on
   got made on an unmerged branch, a "gap" it described got closed by an unrelated
   sprint. The issue's premise is now stale even though nothing about the issue
   itself was ever wrong.

Both failure modes look identical from the tracker: an open issue with a plausible
title. The only way to tell them apart from a genuinely-ready issue is to read the
current code, not the issue.

## The drafting structure

An adapted issue should read like the original's intent, corrected against reality.
Keep these sections (add/drop per issue — not every issue needs all of them):

- **Summary** — restate the goal in one paragraph, plus an "already exists as" table:
  proposed thing → real codebase counterpart, with `file:line` citations. This table
  is where most of the value is; it's what stops someone from re-building
  `ConnectorRegistry` when `resolve_connector` already is one.
- **What this issue does NOT do** — every cut or deferred scope item, each with a
  one-line reason (YAGNI for a single-customer system, overlaps issue #N, no real
  target to test against yet, the infrastructure already exists under a different
  name). This section is what lets a reviewer trust the narrowing — an unexplained
  cut reads as laziness; an explained one reads as judgment.
- **Scope**, rewritten small and concrete against real files/models/services, not the
  original's illustrative pseudocode.
- **Non-Goals**, **Acceptance Criteria**, **Test Coverage** — rewritten against the
  actual codebase shape. Acceptance criteria should be checkable against real files
  that exist post-implementation, not against invented interfaces.
- **Sequencing** — real blocking relationships to other open issues, based on actual
  file/logic overlap you found during research (check `git diff` on any in-flight
  branch touching the same files), not assumed from titles alone. State a milestone
  recommendation or an explicit "leave unassigned, blocked" call.

For an issue that turns out to already be evidence-grounded (citing real FIXMEs,
real file paths, accurate as of today), the draft may end up nearly identical to the
original — that's a valid outcome. Don't manufacture cuts to prove the pass was
worth doing. Report "this held up" as plainly as "this needed correcting."

## The adversarial-reviewer prompt template

Drafting and fact-checking must not share the same blind spots. If the same context
that wrote the draft also "verifies" it, confirmation bias survives. Dispatch a
fresh reviewer — no memory of why the draft says what it says — with a prompt shaped
like this:

```
I've drafted an adapted version of issue #N. It claims [list the draft's load-bearing
factual claims — entity X exists as Y, file Z does W, dependency A blocks B]. Read the
draft at <path>, then adversarially verify EVERY claim against the actual current
code — don't trust the draft, check the repo directly.

Specifically verify: [numbered list, one per load-bearing claim, each naming the exact
file/model/function to check and what to confirm about it].

For each claim, report: CONFIRMED / WRONG / NEEDS-CORRECTION with the specific fix,
including corrected file:line citations where the draft cites them. Also flag anything
else technically questionable, infeasible, or backwards — including cases where a
simpler existing mechanism could serve the same purpose instead of the draft's
proposed new one.

Do NOT edit any files. Report findings as plain text, organized by claim number.
```

Incorporate every correction — don't cherry-pick the comfortable ones. A citation
being off by a few lines is a real correction even if the substance holds; fix it,
because the next reader will click through.

## Applying the tracker's own conventions

Before pushing, look at 2-3 comparable existing issues in the same tracker for their
label taxonomy, milestone naming, and however blocking relationships are recorded
(GitHub's native `blocked-by`/`blocking` via the `addBlockedBy` GraphQL mutation, a
project-board status column, a manual "Blocked by #N" line — whatever the project
already does). Reuse it exactly; don't invent a parallel scheme. If the tracker has
a project board with status columns, match the status to what you actually found
(a genuinely blocked issue gets the "Blocked" column, not "Planned" — precision here
is part of what makes the issue trustworthy to whoever triages it next).

## When to run this vs. skip it

Run it before `/sprint` when an issue is: architectural/speculative rather than a
small direct fix; old relative to the project's pace; explicitly flagged for a
codebase-alignment check; or about to be picked up and hasn't been touched since
filed. Skip it for issues that were just filed against code you already just wrote
(nothing to have drifted from yet), or for small, self-evidently-still-accurate bug
reports. This is a multi-pass research effort (research → draft → independent
adversarial fact-check → correction) — reserve it for issues about to become real
sprint work, not routine backlog triage.
