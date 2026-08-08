# Agentic SDLC

**AI coding works well *within* a session. What happens when the project lasts 20, 50, or
100 sessions?**

Agentic SDLC is a Claude Code plugin that keeps a long AI-driven build coherent across all of
them — by writing down where the work got to, in a form the next session can pick up.

## The problem

Every AI coding session starts with amnesia — no memory of yesterday's decisions, no trace of
why a file looks the way it does. Left unmanaged, that either forces every session to
re-derive context from scratch, or worse, to guess. Agentic SDLC exists to answer one question
cheaply: *where were we, and what do I do next?*

The answer has two halves. Keep the context a session always reads **thin**, so it stays
readable; and end every unit of work by writing down what happened, with evidence, so the
next session starts from a record instead of an archaeology dig.

## Before ASDLC / with ASDLC

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
  Checkpoint    STATUS.md entry, staged commit, human approves
    ↓
  Next session resumes from the handoff
```

The left column is the step; the right column is what it leaves on disk. Nothing in the
loop depends on a session remembering anything.

## The core mental model

1. **Thin persistent context.** Your repo's `CLAUDE.md` holds only durable rules and
   architecture (target under ~200 lines) — never a changelog. Running history lives in
   `docs/STATUS.md`; the current state lives in the **latest** `docs/handoffs/` file.
2. **Checkpoint every sprint.** Plan (before) → build test-first → verify with evidence →
   handoff (after) → commit → **stop for human approval** → `/clear`. One unit of work
   per checkpoint.

## The sprint lifecycle

1. **Plan** → `docs/superpowers/plans/` (brainstorm → write the plan).
2. **Build test-first.**
3. **Verify with real evidence** — commands run, live output, test counts. Not assertions.
4. **Adversarial review** — *offered* when the diff or issue warrants it (security surface,
   auth, data handling, wide blast radius), with its rough cost stated. Never mandatory:
   a review that fires on every sprint and can't run in a subagent-less session produces a
   merge-blocking decision instead of a review, which is why that mandate was retired.
5. **Handoff** → an evidence-bearing `docs/handoffs/<sprint>.md` so a fresh session can
   resume exactly here.
6. **Checkpoint** → tests pass, handoff exists, `docs/STATUS.md` updated, commit staged.
   Then stop for approval and `/clear` before the next sprint.

## Quick start

### 1. Install

```
/plugin marketplace add /path/to/agentic-sdlc
/plugin install agentic-sdlc@leadwood-local
```

Or point Claude Code at this repo directly once it's public:

```
/plugin marketplace add LeadwoodSystems/agentic-sdlc
/plugin install agentic-sdlc@leadwood-local
```

### 2. Run your first sprint

```
/bootstrap-asdlc            once per repo, not once per sprint

/verify-issue 42            selective — see below
/profile-issue 42           recommended before planning
/sprint auth-refresh        required — starts the sprint

  ... the agent builds, test-first ...

/handoff                    required — never skip this one
/checkpoint                 required — ends by stopping for your approval
```

What each step leaves behind:

| Step | Required? | What it produces |
|---|---|---|
| `/bootstrap-asdlc` | Once per repo | `CLAUDE.md`, `docs/STATUS.md`, the handoff and plan templates, `scripts/asdlc/`, and `.asdlc/` |
| `/verify-issue 42` | Selective | A corrected issue body on the tracker |
| `/profile-issue 42` | Recommended | An Execution Profile block on the issue, plus `complexity/`, `risk/` and `execution/` labels |
| `/sprint auth-refresh` | Required | A `sprint/vX.Y-sN` branch and a seeded plan file under `docs/superpowers/plans/` |
| The build | Required | Code and tests, written test-first |
| `/handoff` | Required | `docs/handoffs/<sprint>.md`, plus the one-line `docs/STATUS.md` entry it drafts |
| `/checkpoint` | Required | The test result, the `docs/STATUS.md` entry, the rewritten `CLAUDE.md` pointer span, and a staged commit — then it **stops for your approval** |
| `finish-sprint.js` | After the PR merges | Retires the worktree, flips the STATUS entry to merged, deletes the branch |

**`/verify-issue` is deliberately not routine.** It is a multi-pass research effort, and
the command says so itself: reserve it for issues that are architectural, speculative, or
old enough that the codebase has moved under them. Running it on every issue costs far more
than it returns.

**`/checkpoint` never commits for you.** It stages, reports, and stops. The pause is where
you decide whether the sprint is actually finished — and after the PR merges, `/clear`
before starting the next one.

`/asdlc-hygiene` sits outside this sequence and can be run any time.

## Commands

| Command | What it does |
|---|---|
| `/bootstrap-asdlc` | Scaffold this workflow into a new (or existing) repo |
| `/verify-issue [id]` | Adversarially check a tracked issue against the codebase before it becomes a plan |
| `/profile-issue [id]` | Assess an issue and attach an Execution Profile — complexity, risk, and per-phase routing |
| `/sprint [name]` | Start a sprint — runs the sprint gate, scaffolds its plan, kicks off brainstorm → plan |
| `/checkpoint` | Non-blocking gate: tests + handoff-exists + STATUS/CLAUDE.md pointer script, then stage |
| `/handoff` | Generate an evidence-bearing handoff from the template |
| `/asdlc-hygiene [trunk] [version]` | On-demand audit: stale branches, stale worktrees, default-branch drift, untriaged issues, milestone/version sync |

## State model — one source of truth

| Tier | Lives in | Holds |
|---|---|---|
| Durable | `CLAUDE.md` | architecture, rules, gotchas — read every session, in full |
| History | `docs/STATUS.md` | append-only, **machine-generated only** (never hand-edited) |
| Current state | latest `docs/handoffs/*.md` | status, evidence, follow-ups — read at session start |

Exactly one source of truth for "where things are": the newest handoff. Don't hand-sync
the same status into `CLAUDE.md`, memory, and a handoff — that drifts.

**Numbers are measured, not typed.** Every count, timing and port `CLAUDE.md` asserts is
declared in `.asdlc/facts.json` as a *command to run*; `scripts/asdlc/facts.js` executes
them and owns the `<!-- asdlc:facts:auto -->` span. A command that fails writes
`**UNMEASURED**` with the reason rather than leaving the old value — a stale number that
looks freshly measured is worse than no automation. `scripts/asdlc/asdlc-lint.js` fails
when the block is absent or stale, when a retired rule is still holding a numbered slot,
when a rule runs past ~120 words, or when two of the file's own assertions contradict
each other.

**Operating rules carry stable slugs, not numbers** — cite `#git`, not "rule 2". Numbering
means a retired rule must be embalmed in its slot forever so old citations keep resolving;
with slugs it is simply deleted and a stale citation fails loudly.

Plans and handoffs share one naming scheme: `vMAJOR.MINOR-sN-<slug>.md`. When a milestone
closes, run `node scripts/asdlc/archive-sprint-docs.js <milestone>` to move each type's files
into its own `archive/<milestone>/` subdirectory (`docs/handoffs/archive/<milestone>/`,
`docs/superpowers/plans/archive/<milestone>/`) so the live directories stay small.

## Concurrency model

**One sprint = one worktree = one session.** A branch can be checked out in exactly one
working tree at a time, so the worktree — not the session — is the safe unit of
concurrency: two sessions in one directory fight over HEAD, two sessions in two worktrees
cannot. `new-sprint.js` refuses to start a sprint over a stale worktree, `finish-sprint.js`
removes the worktree before deleting the branch, and `/asdlc-hygiene` audits for orphans.

## Architecture and repository layout

```
.asdlc/
  facts.json           the numbers CLAUDE.md may assert, as commands to run
  policy/execution-classes.yaml   execution-class → model mapping (agent-read, unparsed)
.claude-plugin/
  plugin.json          plugin manifest
  marketplace.json      local marketplace manifest (self-hosting single plugin)
commands/
  bootstrap-asdlc.md    /bootstrap-asdlc
  sprint.md              /sprint
  checkpoint.md          /checkpoint
  handoff.md             /handoff
  verify-issue.md        /verify-issue
  profile-issue.md       /profile-issue
  asdlc-hygiene.md       /asdlc-hygiene
scripts/asdlc/
  lib/exec.js            shared git/gh exec helper
  lib/profile-block.js    execution-profile block parse/upsert
  lib/marker-block.js     generic `<!-- asdlc:… -->` span upsert + injection guard
  lib/branch-status.js    is-this-branch-merged (squash-merge aware)
  new-sprint.js           sprint-start gate + branch/plan scaffolding
  checkpoint-hooks.js     STATUS.md append + CLAUDE.md pointer rewrite
  finish-sprint.js        post-merge worktree removal, status flip, branch cleanup
  gh-hygiene.js           read-only hygiene audit (local/remote branches, worktrees, issues, milestones)
  archive-sprint-docs.js  milestone-scoped archival
  facts.js                measure .asdlc/facts.json → CLAUDE.md facts block
  asdlc-lint.js           durable-context lint (stale facts, numbered rules, contradictions)
skills/agentic-sdlc/
  SKILL.md               the skill Claude Code loads
  references/            state model + plan/handoff/CLAUDE.md templates
```

## Common failure modes

- Hand-editing `docs/STATUS.md` or CLAUDE.md's current-state line → let
  `scripts/asdlc/checkpoint-hooks.js` own both; hand-edits are exactly what caused drift
  in real usage.
- Skipping the handoff "to save time" → the next session can't resume; this is the one
  step never to cut.
- Pushing straight to `main`, or bundling many sprints into one PR.
- Running two sessions in the same working tree to get parallelism → they fight over
  HEAD. One worktree per sprint, and retire it when the sprint ends: an orphan worktree
  survived a week at 1.15 GB holding 14 uncommitted files nobody could see.
- Typing a test count, timing, or port into `CLAUDE.md` → it's wrong within weeks and
  still reads as authoritative. Declare it in `.asdlc/facts.json` and let `facts.js`
  measure it.
- Letting merged sprint branches or worktrees pile up, or milestones drift from the
  sprint version scheme → run `/asdlc-hygiene` periodically to catch all three.
- Hard-blocking hooks for routine actions → prefer non-blocking helper commands; the
  one exception is `new-sprint.js`'s gate, which *does* hard-block starting a new sprint
  on top of an uncommitted one — that specific failure mode was observed in practice and
  is deliberately not advisory.

## Philosophy and design decisions

Agentic SDLC is a spec-driven, checkpoint-gated build loop for driving large,
multi-session AI software builds without losing context, handoffs, or history.

**Core principle:** keep persistent context thin, push history to disk, and make every
sprint resume-ready from a written handoff. Proven across 100+ sprints on one product.

**Works for solo devs and small teams — it's just GitHub.** No new tooling required. The
loop rides directly on primitives you already use:

```
Issue (the spec)  →  Branch (one working line)  →  Commit (one clean checkpoint)
      →  PR (where review happens)  →  Main (the reviewed baseline)
```

Solo? You review your own PR before merging — the pause is the point. Small team?
That's where a teammate looks.

## Credits

This plugin orchestrates the `superpowers` skills (brainstorming, writing-plans,
test-driven-development, verification-before-completion, requesting-code-review) — it
does not replace them.

## License

MIT — see [LICENSE](LICENSE).
