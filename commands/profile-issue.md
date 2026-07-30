---
description: Assess a tracked issue and attach an ASDLC Execution Profile — complexity, risk, and per-phase routing
argument-hint: [issue-id] [--milestone <name>] [--dry-run]
---

Assess issue **$ARGUMENTS** and attach an **ASDLC Execution Profile**: what kind of work
it is, and the cheapest execution class that can reliably do each phase of it. This does
not change what the issue asks for — it makes the issue executable.

Complementary to `/verify-issue`, not a replacement. `/verify-issue` asks *"is this issue
still true?"*; this asks *"how should it be executed?"*. On anything architectural or
stale, run `/verify-issue` first — profiling a false premise is wasted work.

Read `references/execution-profiles.md` (in the `agentic-sdlc` skill) before starting —
it defines the classes, the nine assessment dimensions, the profile schema, and the
escalation rules. Read `.asdlc/policy/execution-classes.yaml` for this project's
class→model mapping and default phase routing.

Arguments: an issue number, or `--milestone <name>` to profile every open issue in a
milestone. `--dry-run` prints the proposed body and labels without writing anything.

## Do this

1. **Ensure the taxonomy labels exist.** Idempotent — `--force` updates an existing
   label rather than erroring:

   ```bash
   gh label create complexity/low       --color BFD4F2 --description "ASDLC: small, well-scoped change" --force
   gh label create complexity/medium    --color 5B9BD5 --description "ASDLC: multi-file or multi-step change" --force
   gh label create complexity/high      --color 1F4E79 --description "ASDLC: large or intricate change" --force
   gh label create risk/low             --color C2E0C6 --description "ASDLC: contained blast radius" --force
   gh label create risk/medium          --color FBCA04 --description "ASDLC: crosses a subsystem boundary" --force
   gh label create risk/high            --color D93F0B --description "ASDLC: security, data, or architectural boundary" --force
   gh label create execution/fast       --color E4D5F5 --description "ASDLC: fast class implementation" --force
   gh label create execution/standard   --color B39DDB --description "ASDLC: standard class implementation" --force
   gh label create execution/deep       --color 6A1B9A --description "ASDLC: deep class implementation" --force
   gh label create execution/deterministic --color 546E7A --description "ASDLC: no LLM — runner/toolchain only" --force
   ```

2. **Read the issue in full** — title, body, labels, milestone, linked issues/PRs, and
   any existing `## ASDLC Execution Profile` section (re-profiling replaces it).

3. **Record the commit you are assessing against** — `git rev-parse --short HEAD` — and
   put it in the profile's `assessed_at_sha`. Check `git status` too: if the working tree
   is mid-sprint, say so in the assessment and cite symbols rather than bare line numbers.
   A backlog-wide pass races in-flight work, and an uncited-SHA line number is
   indistinguishable from a wrong one a week later.

4. **Assess against the actual codebase, not the issue text.** Work the nine dimensions
   from the reference doc: ambiguity, architectural impact, blast radius, codebase
   familiarity, reasoning depth, hidden coupling, implementation complexity, security
   implications, review effort. Read the files the issue names. Find out what already
   exists. An assessment with no `file:line` citations is a guess, and a guessed profile
   routes work wrong — which is worse than no profile, because it looks authoritative.

   Delegate this to a subagent per issue when profiling a whole milestone; each
   assessment is an independent research task and they parallelize cleanly.

5. **Derive the profile.** Summarize the dimensions into `complexity`, `risk`,
   `architecture_impact`, `expected_duration`, and `blast_radius`. Then set each phase's
   class: start from `default_routing` in the policy file and deviate only where the
   assessment justifies it — say which dimension drove the deviation. Verification is
   `deterministic` unless there is genuinely nothing a runner can check. Security
   implications force review to `deep`.

6. **Write the section.** Human assessment prose first (with citations), then the JSON
   block inside the markers. Use `scripts/asdlc/lib/profile-block.js` rather than
   hand-editing — it preserves CRLF, replaces an existing block in place, and leaves
   everything outside the markers byte-identical:

   ```bash
   gh issue view <n> --json body --jq .body > body.md
   node -e "
     const fs = require('node:fs');
     const { upsertProfile } = require('./scripts/asdlc/lib/profile-block');
     const body = fs.readFileSync('body.md', 'utf8');
     const profile = JSON.parse(fs.readFileSync('profile.json', 'utf8'));
     fs.writeFileSync('body.md', upsertProfile(body, profile, { assessment: process.env.ASSESSMENT }));
   "
   gh issue edit <n> --body-file body.md
   ```

   Under `--dry-run`, stop here and print the diff instead of running `gh issue edit`.

7. **Apply the labels** — one from each family, matching the profile. The
   `execution/*` label records the **implementation** class:

   ```bash
   gh issue edit <n> --add-label complexity/medium --add-label risk/low --add-label execution/standard
   ```

   Remove any stale label from the same family first. Follow the tracker's existing
   conventions for everything else — do not invent a parallel taxonomy for milestones or
   status; inspect a few comparable issues first.

## Constraints

- **Do not rewrite acceptance criteria**, change scope, or split the issue. If the issue
  looks wrong, say so and recommend `/verify-issue` — don't fix it here.
- **Preserve all existing discussion.** Only the marked profile span is yours to replace.
- **Never record a concrete model name** in the profile or the labels. Classes only; the
  model resolves from `.asdlc/policy/execution-classes.yaml`.
- **Default to the cheaper class.** `deep` everywhere is the same failure as `deep`
  nowhere — it just costs more. If you cannot say which dimension makes something `deep`,
  it isn't.
- If uncertain, say so in the assessment prose rather than picking a class silently.

The test: could a dispatcher read this profile and route the work without reading the
issue body? And would an engineer who knows this codebase agree with the routing?
