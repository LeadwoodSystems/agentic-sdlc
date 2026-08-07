# Capability Layer & Public Maturity — build sequence

**Status:** backlog created and Epic 1 profiled. No implementation started.
**Created:** 2026-08-07, against `5b0009d` (clean tree).
**Tracker:** milestone [ASDLC Capability Layer & Public Maturity](https://github.com/LeadwoodSystems/agentic-sdlc/milestone/1) — 47 open issues.

This is a proposal/roadmap document (`docs/*.md` per the *Specs & records* pointer in
`CLAUDE.md`), not a sprint plan and not a handoff. **No sprint ran to produce it** — the
session that created it wrote no code and produced no repo diff beyond this file, so it
has no `docs/STATUS.md` entry and no `docs/handoffs/` file. Precedent:
`docs/ASDLC Issue Modernization Pass.md` and `docs/2026-08-04-asdlc-hardening-plan.md`.

The authoritative backlog is GitHub. This file exists so a fresh session knows the
sequence and the reasoning without re-deriving them from 47 issue bodies.

---

## The architectural principle this initiative must not break

```text
┌───────────────────────────────────────────────┐
│                ASDLC CONTROL PLANE            │
│  Issue → Profile → Plan → Build → Verify      │
│        → Review → Handoff → Checkpoint        │
│  deterministic lifecycle + state transitions  │
└───────────────────────┬───────────────────────┘
                        ▼
┌───────────────────────────────────────────────┐
│             AGENTIC CAPABILITY LAYER          │
│  wayfinding · domain modeling · TDD           │
│  diagnosis · research · architecture reasoning│
│  spec review · standards review               │
│  adaptive reasoning inside bounded phases     │
└───────────────────────┬───────────────────────┘
                        ▼
┌───────────────────────────────────────────────┐
│            DETERMINISTIC MECHANISMS           │
│  git / gh / tests / lint / worktrees          │
│  measured facts / scripts / checkpoint gates  │
│  evidence capture / branch-state verification │
└───────────────────────────────────────────────┘
```

**Skills reason. ASDLC governs. Deterministic mechanisms prove what actually happened.**

The load-bearing rule for every epic below: a capability may reason, but only a lifecycle
command may advance lifecycle state. Routing configuration never grants authority.

## Build sequence

Epics are sequenced, not parallel. Each one's output is the next one's input.

```text
EPIC 1  Public positioning + architecture documentation      ← start here
   ↓    establishes the vocabulary the rest of the docs use
EPIC 2  Domain context (CONTEXT.md)
   ↓    spec-review (Epic 4) and wayfinding (Epic 3) both read it
EPIC 3  Wayfinding + dependency decomposition
   ↓    produces the issue shapes Epic 4 reviews against
EPIC 4  Dual-axis review
   ↓    supplies the review contracts Epic 5 catalogues
EPIC 5  Capability model formalisation
   ↓
        ── observe real usage ──
   ↓
EPIC 6  Governed learning loop
```

Why this order and not another:

- **1 before everything.** Epics 3–5 all extend documents Epic 1 creates
  (`docs/architecture.md`, `docs/philosophy.md`). Writing them first means Epic 5's
  `docs/capabilities.md` extends a document that exists rather than predicting one.
- **2 before 3 and 4.** `CONTEXT.md`'s contract (#24) defines a read point that
  `/wayfind` (#31) and Spec Review (#38) both consume. Building the consumers first
  would fix the interface by accident.
- **4 before 5.** `docs/capabilities.md` (#46) should document contracts that exist.
  Its issue says so explicitly — catalogue real capabilities, not aspirational ones.
- **6 last, after observation.** The retrospective analyses accumulated evidence. Run
  against a history that predates Epics 1–5, it would find patterns about a system that
  no longer exists.

### One schema decision spans three epics

#35, #40 and #48 each extend the `execution-profile/v1` payload
(`scripts/asdlc/lib/profile-block.js`). **Make the schema-evolution call once** — additive
v1 field vs. v2, and how legacy blocks keep parsing — then apply it three times. Three
independent answers is the failure mode; each issue's body flags the coordination.

## Issue map

| # | Title | Sub-issues |
|---|---|---|
| [#11](https://github.com/LeadwoodSystems/agentic-sdlc/issues/11) | **EPIC** Public repository positioning and onboarding | #17–#23 |
| [#12](https://github.com/LeadwoodSystems/agentic-sdlc/issues/12) | **EPIC** Shared domain context and ubiquitous language | #24–#29 |
| [#13](https://github.com/LeadwoodSystems/agentic-sdlc/issues/13) | **EPIC** Wayfinding and dependency-aware issue decomposition | #30–#37 |
| [#14](https://github.com/LeadwoodSystems/agentic-sdlc/issues/14) | **EPIC** Two-axis engineering review | #38–#44 |
| [#15](https://github.com/LeadwoodSystems/agentic-sdlc/issues/15) | **EPIC** ASDLC agentic capability architecture | #45–#50 |
| [#16](https://github.com/LeadwoodSystems/agentic-sdlc/issues/16) | **EPIC** Evidence-driven ASDLC retrospective and learning | #51–#56 |
| [#57](https://github.com/LeadwoodSystems/agentic-sdlc/issues/57) | *bug* — gh-hygiene under-reports untriaged issues past the first 30 | — |

Sub-issues are linked natively (GitHub sub-issue API), so each epic renders its own
progress. Cross-issue dependencies are written as issue references in the **Sequencing**
section of every body — deliberately, so they survive a context reset.

**Epic 1 detail**, the only epic profiled so far:

| # | Title | Complexity | Risk | Planning | Impl |
|---|---|---|---|---|---|
| #17 | Rewrite README information architecture | medium | low | standard | standard |
| #18 | Before ASDLC / With ASDLC diagram | low | low | fast | fast |
| #19 | `docs/architecture.md` | medium | low | **deep** | standard |
| #20 | `docs/philosophy.md` | low | low | standard | fast |
| #21 | 60-second first-sprint walkthrough | low | low | fast | fast |
| #22 | Audit public installation and plugin naming | medium | **medium** | **deep** | standard |
| #23 | Review maturity claims and terminology | medium | low | standard | standard |

`#17 → #18, #21` (they need the section skeleton). `#19`, `#20`, `#22`, `#23` are
independent and can run in any order.

## Decisions taken while creating the backlog

Recorded because they deviate from, or add to, the originating specification.

1. **#37 was added; it is not in the source spec.** The epic-tracker concept collides with
   `gh-hygiene.js:186-213`, which flags every issue lacking `complexity/` + `risk/` +
   `execution/` labels. Epics and Epic 3's decision tickets are never executed directly,
   so both would sit on the "needs profiling" worklist permanently. #37 makes the audit
   recognise non-executable issue kinds.
2. **No execution-profile labels were applied at creation time.** Labelling an issue
   without attaching the profile block would make `gh-hygiene` report it as profiled and
   hide the real worklist. Issues start unprofiled, which is accurate.
3. **#57 is on this milestone but is not part of the initiative.** It gates triage of the
   initiative's backlog, which is the only reason it is filed here.
4. **The two `deep` plannings in Epic 1 each name a specific unresolved decision** — #19,
   whether the three-layer model matches what the code actually enforces; #22, rename the
   marketplace identifier vs. keep-and-explain. Per
   `references/execution-profiles.md`, `deep` without a nameable open question is
   inflation, so no other issue got it.

## Known state a fresh session should not rediscover

- **`gh-hygiene` under-reports.** 47 open issues, 39 unprofiled, but the audit reports 30
  — `gh issue list` at `gh-hygiene.js:193-199` passes no `--limit` and takes gh's default.
  Nine issues are invisible. Filed as #57; fix it before trusting the worklist.
- **Milestone/sprint-version sync reports OUT OF SYNC.** `checkMilestoneVersionSync`
  (`gh-hygiene.js:218-237`) looks for a `vX.Y` token in milestone titles and this
  milestone has none. Pre-existing — it was equally out of sync with zero milestones — but
  it will stay red until a `v0.x` milestone exists or the check learns about
  non-version milestones. Not filed; decide whether it is worth filing.
- **Verification is weak for documentation issues.** `asdlc-lint.js` targets `CLAUDE.md`
  only (`asdlc-lint.js:36,344`) and no test reads `README.md`. For Epic 1 the runner can
  only prove nothing *else* broke; review is the real gate. Reflected in the profiles.
- **This repo has no CI.** The suite is the only gate, so #22's clean-environment install
  check is manual and must be captured as handoff evidence.

## Next action

Epic 1 is profiled and ready to sprint. Either:

- **#57 first** (small, `execution/fast`) so the triage worklist can be trusted; or
- **#17 first** (`sprint/v0.3-s1`), the README rewrite that unblocks #18 and #21.

Epics 2–6 are unprofiled. Profile each epic's sub-issues at the point it is picked up,
not in bulk now — a profile records `assessed_at_sha`, and one assessed against today's
tree is stale by the time Epic 4 starts.
