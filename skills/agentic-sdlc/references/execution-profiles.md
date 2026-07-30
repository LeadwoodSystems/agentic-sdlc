# Execution profiles — assessing work and routing it

Backing reference for `/profile-issue`. An **Execution Profile** answers "what kind of
work is this, and what is the cheapest resource that can do it reliably?" It is the
first subsystem of the Adaptive Execution Engine: today the assessment is a judgment
call, recorded in a fixed shape; over time the recorded actuals are what let the
recommendation become evidence-driven instead of asserted.

## Guiding principle

**Use the least capable resource that can reliably complete the work.** Not everything
is a `deep` task. Reason about ambiguity, architectural impact, blast radius, required
codebase familiarity, expected reasoning depth, likelihood of hidden coupling,
implementation complexity, security implications, and expected review effort — then pick
per phase, not per issue. Most issues are `deep` to plan and `standard` to build.

## Classes, not model names

Four classes: `fast`, `standard`, `deep`, `deterministic`. Labels and profiles record
the **class**. The concrete model resolves through `.asdlc/policy/execution-classes.yaml`.

This matters more than it looks. Model lineups turn over every few months; a backlog
labelled `model/opus` needs a bulk relabel each time, and every stale label is a wrong
routing decision. A backlog labelled `execution/deep` needs a one-line config edit. It
also matches what the Adaptive Execution Engine is actually for — as the vision doc puts
it, "the AI model is simply one implementation detail of that execution plan."

`deterministic` is the class most often missed. Lint, typecheck, tests, builds,
migrations, and CI verification need no LLM at all — route them to the runner. An
execution plan that plans to have a model "check the tests pass" is doing it wrong.

## The nine assessment dimensions

Work through these against the **actual codebase**, not the issue text. An assessment
with no `file:line` citations is a guess.

| Dimension | What raises it |
|---|---|
| Ambiguity | Requirements open to materially different readings |
| Architectural impact | Changes a durable invariant, boundary, or contract |
| Blast radius | Number and spread of subsystems the change can break |
| Codebase familiarity | How much context must be loaded before the first edit is safe |
| Reasoning depth | Multi-step derivation vs. mechanical application |
| Hidden coupling | Implicit dependencies not visible from the changed files |
| Implementation complexity | Volume and intricacy of the change itself |
| Security implications | Touches authn/authz, credentials, trust boundaries, data egress |
| Review effort | How hard it is to tell correct from plausible-but-wrong |

Complexity, risk, and architecture impact are summaries of these — not independent
judgments. Security implications alone are enough to force review to `deep`.

## The profile block

Every profile is a `## ASDLC Execution Profile` section: human assessment prose, then a
machine-readable JSON block inside marker comments.

```markdown
## ASDLC Execution Profile

Single-file change to a report-only audit script; `findUntriagedIssues`
(`scripts/asdlc/gh-hygiene.js:45`) has no callers outside the audit aggregate, so blast
radius is one function. No auth, no persistence, no schema.

<!-- asdlc:execution-profile -->
```json
{
  "schema": "execution-profile/v1",
  "stage": "estimated",
  "source_issues": [197],
  "sprint_id": null,
  "complexity": "low",
  "risk": "low",
  "architecture_impact": "low",
  "expected_duration": "<30min",
  "blast_radius": ["scripts/asdlc/"],
  "phases": {
    "planning": {"class": "standard", "reason": "Scope is self-evident from the issue."},
    "implementation": {"class": "fast", "reason": "One function, no hidden coupling."},
    "verification": {"class": "deterministic", "runner": "ci", "tasks": ["lint", "unit"]},
    "review": {"class": "fast", "reason": "No behavior change outside the audit report."}
  },
  "escalation": ["implementation fails twice", "hidden coupling discovered"]
}
```
<!-- /asdlc:execution-profile -->
```

Field notes:

- `stage` — `estimated` (on the issue) → `committed` (in the plan) → `actual` (in the handoff).
- `source_issues` / `sprint_id` — the join key that lets an estimate be compared against
  what actually happened. `sprint_id` is `null` until a sprint picks the issue up.
- `expected_duration` — one of `<30min`, `30-90min`, `half-day`, `full-day`, `multi-sprint`.
- `complexity` / `risk` / `architecture_impact` — `low` | `medium` | `high`.
- `escalation` — the conditions that should trigger a re-route mid-sprint.

**The markers are unversioned on purpose.** The schema version lives in the payload. A
versioned marker would stop matching its own v1 span on the next release and append a
duplicate — exactly what the markers exist to prevent. Same reasoning as the
`<!-- asdlc:current-state:auto -->` span in `CLAUDE.md`.

`scripts/asdlc/lib/profile-block.js` owns reading and writing this block: `parseProfile`
extracts the payload (CRLF-tolerant — the GitHub API returns `\r\n`), and `upsertProfile`
replaces the marked span in place or appends the section if absent, leaving everything
outside the markers byte-identical.

## Labels

Three families, one label from each: `complexity/{low,medium,high}`,
`risk/{low,medium,high}`, `execution/{fast,standard,deep,deterministic}`. The
`execution/*` label records the **implementation** class — the phase that dominates cost.

`risk/*` deliberately matches the `risk.level` enum in the ASDLC v2 control plane's
`work-contract.schema.yaml`, so a later port is a mapping rather than a rewrite.

`gh-hygiene.js` flags any open issue missing one of the three prefixes with reason
`no-execution-profile` — that is the "needs profiling" worklist.

## Escalation

Escalation is a routing decision, not a retry. When a trigger fires, move **one class up**
(`fast`→`standard`→`deep`) for the affected phase and record it in the handoff's actuals:

- implementation fails twice
- hidden architectural coupling discovered
- issue scope expands significantly
- security boundary changes → review goes to `deep` regardless of the issue's risk label
- required context exceeds practical limits → split the sprint instead

`deep` is the ceiling for automatic escalation. Going past it is a human call.

## What this does not do

It does not rewrite acceptance criteria, change scope, or split issues — that is
`/verify-issue`'s job, and the two are complementary: `/verify-issue` asks "is this issue
still true?", `/profile-issue` asks "how should it be executed?". Run `/verify-issue`
first on anything architectural or stale; profiling a false premise is wasted work.
