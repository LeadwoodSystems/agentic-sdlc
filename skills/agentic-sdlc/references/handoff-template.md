# <Sprint id> — <Name> · Handoff

**Date:** YYYY-MM-DD
**Branch / commit:** `<branch>` @ `<sha>`
**Status:** <complete / partial>

> File name: `docs/handoffs/vMAJOR.MINOR-sN-<slug>.md` — matching the plan's slug lets
> `scripts/asdlc/new-sprint.js`'s gate detect a plan/handoff pair automatically.

> **Light-trim discipline:** cite test counts + CI link — never paste raw pytest/CI
> stdout or per-test timings. Link issues/PRs by number (`#123`), not full URL prose.
> Target ~120 lines; if it's running longer, move detail to the linked plan/PR and
> leave a pointer here. The test is still "could a fresh session resume from this
> alone" — trim padding, not substance.

## Goal
<One sentence from the plan — what this sprint set out to do.>

## Scope delivered
- <bullet list of what was actually built>

## How to run / verify
```bash
# exact commands a fresh engineer runs to see it working
```

## Verification
<One line per tier, cited not pasted, e.g.:>
`fast: NNN passed · smoke: NN passed · CI deep: green (SHA <short-sha>)`

| Criterion | Result | Evidence |
|---|---|---|
| <criterion> | ✅ / ❌ | <test count / file ref / PR#link — not pasted output> |

## Key decisions & trade-offs
- <decision — why>

## Deferred / known gaps
- <thing intentionally left for later, with where it picks up>

## Next sprint
- **Goal:** <next sprint goal>
- **Entry points:** <files/dirs to start in>
- **Suggested first actions:** <concrete starting steps>
