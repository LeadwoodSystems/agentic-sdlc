# Agentic SDLC

A Claude Code plugin: a spec-driven, checkpoint-gated build loop for driving large,
multi-session AI software builds without losing context, handoffs, or history.

**Core principle:** keep persistent context thin, push history to disk, and make every
sprint resume-ready from a written handoff. Proven across 100+ sprints on one product.

This plugin orchestrates the `superpowers` skills (brainstorming, writing-plans,
test-driven-development, verification-before-completion, requesting-code-review) — it
does not replace them.

## The problem

Every AI coding session starts with amnesia — no memory of yesterday's decisions, no
trace of why a file looks the way it does. Left unmanaged, that either forces every
session to re-derive context from scratch, or worse, to guess. Agentic SDLC exists to
answer one question cheaply: *where were we, and what do I do next?*

## The two rules

1. **Thin persistent context.** Your repo's `CLAUDE.md` holds only durable rules and
   architecture (target under ~200 lines) — never a changelog. Running history lives in
   `docs/STATUS.md`; the current state lives in the **latest** `docs/handoffs/` file.
2. **Checkpoint every sprint.** Plan (before) → build test-first → verify with evidence →
   handoff (after) → commit → **stop for human approval** → `/clear`. One unit of work
   per checkpoint.

## The loop, per sprint

1. **Plan** → `docs/superpowers/plans/` (brainstorm → write the plan).
2. **Build test-first.**
3. **Verify with real evidence** — commands run, live output, test counts. Not assertions.
4. **Adversarial review** for risky or security-sensitive work.
5. **Handoff** → an evidence-bearing `docs/handoffs/<sprint>.md` so a fresh session can
   resume exactly here.
6. **Checkpoint** → tests pass, handoff exists, `docs/STATUS.md` updated, commit staged.
   Then stop for approval and `/clear` before the next sprint.

## Commands

| Command | What it does |
|---|---|
| `/bootstrap-asdlc` | Scaffold this workflow into a new (or existing) repo |
| `/verify-issue [id]` | Adversarially check a tracked issue against the codebase before it becomes a plan |
| `/sprint [name]` | Start a sprint — runs the sprint gate, scaffolds its plan, kicks off brainstorm → plan |
| `/checkpoint` | Non-blocking gate: tests + handoff-exists + STATUS/CLAUDE.md pointer script, then stage |
| `/handoff` | Generate an evidence-bearing handoff from the template |
| `/asdlc-hygiene [trunk] [version]` | On-demand audit: stale branches, default-branch drift, untriaged issues, milestone/version sync |

## State model — one source of truth

| Tier | Lives in | Holds |
|---|---|---|
| Durable | `CLAUDE.md` | architecture, rules, gotchas — read every session, in full |
| History | `docs/STATUS.md` | append-only, **machine-generated only** (never hand-edited) |
| Current state | latest `docs/handoffs/*.md` | status, evidence, follow-ups — read at session start |

Exactly one source of truth for "where things are": the newest handoff. Don't hand-sync
the same status into `CLAUDE.md`, memory, and a handoff — that drifts.

Plans and handoffs share one naming scheme: `vMAJOR.MINOR-sN-<slug>.md`. When a milestone
closes, run `node scripts/asdlc/archive-sprint-docs.js <milestone>` to move its files into
`archive/<milestone>/` so the live directories stay small.

## Works for solo devs and small teams — it's just GitHub

No new tooling required. The loop rides directly on primitives you already use:

```
Issue (the spec)  →  Branch (one working line)  →  Commit (one clean checkpoint)
      →  PR (where review happens)  →  Main (the reviewed baseline)
```

Solo? You review your own PR before merging — the pause is the point. Small team?
That's where a teammate looks.

## Installing

```
/plugin marketplace add /path/to/agentic-sdlc
/plugin install agentic-sdlc@leadwood-local
```

Or point Claude Code at this repo directly once it's public:

```
/plugin marketplace add LeadwoodSystems/agentic-sdlc
/plugin install agentic-sdlc@leadwood-local
```

## Common mistakes

- Hand-editing `docs/STATUS.md` or CLAUDE.md's current-state line → let
  `scripts/asdlc/checkpoint-hooks.js` own both; hand-edits are exactly what caused drift
  in real usage.
- Skipping the handoff "to save time" → the next session can't resume; this is the one
  step never to cut.
- Pushing straight to `main`, or bundling many sprints into one PR.
- Letting merged sprint branches pile up, or milestones drift from the sprint version
  scheme → run `/asdlc-hygiene` periodically to catch both.
- Hard-blocking hooks for routine actions → prefer non-blocking helper commands; the
  one exception is `new-sprint.js`'s gate, which *does* hard-block starting a new sprint
  on top of an uncommitted one — that specific failure mode was observed in practice and
  is deliberately not advisory.

## Layout

```
.claude-plugin/
  plugin.json          plugin manifest
  marketplace.json      local marketplace manifest (self-hosting single plugin)
commands/
  bootstrap-asdlc.md    /bootstrap-asdlc
  sprint.md              /sprint
  checkpoint.md          /checkpoint
  handoff.md             /handoff
  verify-issue.md        /verify-issue
  asdlc-hygiene.md       /asdlc-hygiene
scripts/asdlc/
  lib/exec.js            shared git/gh exec helper
  new-sprint.js           sprint-start gate + branch/plan scaffolding
  checkpoint-hooks.js     STATUS.md append + CLAUDE.md pointer rewrite
  finish-sprint.js        post-merge status flip, branch cleanup, milestone check
  gh-hygiene.js           read-only hygiene audit
  archive-sprint-docs.js  milestone-scoped archival
skills/agentic-sdlc/
  SKILL.md               the skill Claude Code loads
  references/            state model + plan/handoff/CLAUDE.md templates
```

## License

MIT — see [LICENSE](LICENSE).
