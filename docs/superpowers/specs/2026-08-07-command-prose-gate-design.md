# Command-prose gate — design

**Date:** 2026-08-07
**Sprint:** v0.2-s9 (`sprint/v0.2-s9`)
**Status:** approved, not yet implemented

## The problem

v0.2-s8 added a seventh check to `gh-hygiene.js` and very nearly shipped with
`commands/asdlc-hygiene.md` still instructing the agent to "Present the **six** findings".
Every task review passed and the suite was green throughout; the miss was caught by reading
the prose against the code by hand.

`/asdlc-hygiene`'s prose **is** its executable surface — an agent following it is the thing
that runs. So a stale command file ships a detection that exists in the script and is never
read by anyone. Nothing in the suite, in `asdlc-lint.js`, or in any other gate looks at a
command file at all. v0.2-s4 hit the same class of bug from the other side, when a
hand-enumerated script list in `bootstrap-asdlc.md` went stale and a sprint shipped a tool
no consumer could receive.

## What we found while designing

Three things surfaced during design that changed the shape from what the s8 handoff
anticipated. All three are recorded here because each one invalidates a plausible approach.

**The two delivery paths are disjoint, not divergent.** The s8 handoff asked us to decide
"whether consumers get `commands/*.md` via reinstall or via `/bootstrap-asdlc` — the two
paths deliver different files and nothing checks they agree." Reading
`commands/bootstrap-asdlc.md:31-36`: bootstrap copies every `.js` under `scripts/asdlc/`
and **never copies `commands/*.md` at all**. There is exactly one copy of command prose —
the plugin's — so there is no second copy to drift, and no agreement to check.

The real asymmetry runs the other way. A consumer's `scripts/asdlc/` is a **frozen snapshot**
taken at bootstrap time, while `commands/*.md` stays **live** from the plugin cache and
refreshes on every reinstall. The drift that can actually bite a consumer is plugin prose
describing a script version they do not have. That is the inverse of what s8 predicted, and
it is deliberately **out of scope** here (see Scope).

**`asdlc-lint.js` is a document linter, not a repo linter.** Its whole contract is
`lintClaudeMd(claudeMdPath)` (`asdlc-lint.js:398`) and its CLI takes one optional path to a
`CLAUDE.md` (`:427`). The s8 handoff's suggested "cheap first cut" — put the check inside
`asdlc-lint.js` — would place a cross-file, two-directory check inside a function whose only
argument is a single document. Rejected on those grounds; see Rejected alternatives.

**The check set exists in three vocabularies, none sharing a source.**

| Where | Form |
|---|---|
| `runHygieneAudit` result keys (`gh-hygiene.js:326-332`) | `staleRemoteBranches` |
| `main()` report line (`:359`) | `Stale remote sprint branches:` |
| `anyCheckFailed` array (`:372`) | `'staleRemoteBranches'` — a hand-copy of the keys |
| Command prose (`asdlc-hygiene.md:19`) | `stale remote sprint branches` |

A gate matching camelCase keys against English prose must fuzzy-match. A fuzzy gate that
passes is worse than no gate: it is the confidently-wrong failure mode that `.asdlc/facts.json`
exists to prevent. The coupling needs a real single source, not a heuristic.

## Scope

**In:**

- A check manifest in `gh-hygiene.js` that `runHygieneAudit`, `main()`'s rendering, and
  `anyCheckFailed` all derive from.
- A two-tier gate in the test suite covering this repo's own `commands/` against its own
  `scripts/asdlc/`.
- Rewriting `commands/asdlc-hygiene.md`'s findings list to use the report's labels verbatim.

**Out:**

- **Consumer-side skew detection** (snapshotted scripts vs live plugin prose). Needs
  `CLAUDE_PLUGIN_ROOT` resolution and a version/skew notion that does not exist yet.
  A separate sprint if it is ever wanted.
- **A general prose-declaration format** for any command against any script.
  `asdlc-hygiene.md` is the only known instance; designing a declaration format would be
  most of the work and would be speculative.
- **Flagging scripts that no command mentions.** `archive-sprint-docs.js` and everything
  under `lib/` legitimately have no command; this direction is noise.

## Design

### 1. `HYGIENE_CHECKS` — one array, three consumers

```js
const HYGIENE_CHECKS = [
  { key: 'staleBranches',
    label: 'Stale merged branches',
    run: (cwd, c) => findStaleBranches(cwd, { trunk: c.declaredTrunk, runner: c.runner }),
    format: (v) => (v.length ? v.join(', ') : 'none') },
  // …six more, one per check, in report order
];
```

`format` takes `(value, ctx)` rather than `(value)` because the `defaultBranch` line closes
over `declaredTrunk` (`gh-hygiene.js:367`). Every other formatter ignores the second
argument.

The seven entries, in report order, with the labels that become the gate's match targets:

| `key` | `label` |
|---|---|
| `staleBranches` | Stale merged branches |
| `staleRemoteBranches` | Stale remote sprint branches |
| `staleWorktrees` | Stale worktrees |
| `defaultBranch` | Default branch |
| `untriagedIssues` | Untriaged issues |
| `milestoneSync` | Milestone/sprint version sync |
| `failingScheduled` | Failing scheduled workflows |

Three call sites derive from it:

- **`runHygieneAudit`** — a loop building `report[key] = safeCheck(() => check.run(cwd, ctx))`,
  replacing the literal object at `:325-333`. The `safeCheck` isolation guarantee is
  unchanged: every key is still present even when every check throws.
- **`main()`** — a loop printing `${label}: ${formatCheck(report[key], (v) => check.format(v, ctx))}`,
  replacing the seven hand-written lines at `:358-370`.
- **`anyCheckFailed`** — `HYGIENE_CHECKS.some((c) => isCheckError(report[c.key]))`, which
  **deletes the duplicated key list at `:372`**. That duplicate is the same
  subset-enumeration smell v0.2-s6 removed in three other places, and s8 recorded it as
  standing debt.

Rendering must stay byte-identical. That is a verification obligation, not just an
intention — see Evidence.

### 2. The gate lives in the suite

Scope is this repo, and per `CLAUDE.md` the suite is the only gate here. So: one new
`scripts/asdlc/test/command-prose.test.js`. No new CLI, no new consumer surface, and
`asdlc-lint.js` keeps its single-document contract.

**Tier 1 — named scripts exist.** Walk `commands/*.md`, extract every `scripts/asdlc/…\.js`
path — anywhere in the file, prose or fenced block alike — and assert each resolves on disk.
The pattern requires a `.js` suffix, so `bootstrap-asdlc.md`'s bare
`${CLAUDE_PLUGIN_ROOT}/scripts/asdlc/` directory reference is correctly not a match.
Ten paths across five command files resolve today
(`handoff.md` and `verify-issue.md` name no scripts), so this **ships green as a regression
guard, not a fix**. It is the v0.2-s4 failure mode, gated.

**Tier 2 — the hygiene findings list matches the script.** Two assertions:

1. Every `HYGIENE_CHECKS[].label` appears case-insensitively in `commands/asdlc-hygiene.md`.
2. The spelled-out numeral in "Present the **seven** findings" equals `HYGIENE_CHECKS.length`,
   via a small word-to-number lookup. Seven checks today; the lookup covers zero through
   twelve and the test fails loudly rather than silently passing if the count outgrows it.

### 3. Prose rewrite

`commands/asdlc-hygiene.md:19`'s parenthesised list becomes the seven labels verbatim. The
English gets slightly more mechanical, and that is the trade: the prose now names the exact
lines the agent will read back from the script, so exact-substring matching works and no
third vocabulary exists to maintain.

## Rejected alternatives

- **Count-only gate** (~20 lines, no production change): assert the prose numeral equals the
  number of keys `runHygieneAudit` returns. It would have caught the s8 bug exactly. Rejected
  because it misses a renamed or reordered check, and because it leaves the `:372` duplicate
  in place — the refactor is what makes the gate cheap *and* pays down recorded debt.
- **A `prose` field on the manifest**, separate from `label`. This was the original proposal.
  Rejected on reading `main()` against the command file: it would be a third hand-maintained
  vocabulary, which is the exact thing this sprint deletes.
- **Widening `asdlc-lint.js`** into a repo linter with subcommands. Rejected: it lints one
  document by contract, and consumers run it against their own `CLAUDE.md`. Growing it into a
  repo-shape checker changes what it means for every consumer, for one check.
- **Fuzzy camelCase-to-English matching**, avoiding the refactor entirely. Rejected: a gate
  that can pass on a near-miss manufactures false confidence.
- **Manifest now, prose matching later.** Rejected: it ships a `label` field the gate does not
  read, and an unused field is one the next sprint lets rot.

## Known limits

Stated here so they do not get discovered as gaps later.

- The gate proves prose and script **agree**, not that either is **right**. A label that is
  wrong in both places passes.
- Tier 1 checks existence only, not that a command's description of a script is accurate.
- Consumers get none of this — `test/` is excluded from bootstrap by design.
- `main()` in `gh-hygiene.js` remains untested generally (carried from s8), so the refactored
  rendering is verified by a live run and mutation, not by a unit test.

## Evidence to capture

- Suite total, from `node --test "scripts/asdlc/test/**/*.test.js"`. 320 at the s8 handoff;
  the new total gets measured at checkpoint rather than predicted here.
- `docs/mutation-manifests/v0.2-s9.json`, proving the gate bites rather than merely existing.
  Four mutations, each naming the assertion it must turn red:
  remove one label from the prose list (tier 2, label match); break a script path in a command
  file (tier 1); change the numeral in "Present the seven findings" (tier 2, count); drop an
  entry from `HYGIENE_CHECKS` (tier 2, count — from the other side).
  Every anchor confirmed to match exactly one line before the run.
- `node scripts/asdlc/gh-hygiene.js main v0.2` before and after the refactor, diffed, to show
  rendering is byte-identical.
- `node scripts/asdlc/facts.js --check` exit 0 and `node scripts/asdlc/asdlc-lint.js` clean.
