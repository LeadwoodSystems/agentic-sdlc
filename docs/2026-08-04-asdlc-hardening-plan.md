# ASDLC hardening: one mind, measured facts, one shell

**Date:** 2026-08-04
**Status:** proposal — nothing implemented
**Companion doc:** `2026-08-04-mutation-tooling-and-loop-efficiency.md` (sprint-speed + `mutate.js`
spec). This document does not repeat it.
**Origin:** a working session on `gaw` v0.13-s8, in which the operator named six recurring
complaints. Every finding below was **verified in that session**, not inferred — the commands are
given so a cold reader can re-run them.

> **This plan spans three locations.** Most work lands in this repo (`agentic-sdlc`), some in `gaw`,
> and one item is machine-level (installing PowerShell 7). Each workstream says which.

---

## The six complaints, and the one cause

The operator's words: *drift; sprints are slow; I can't run concurrent sessions without messing with
the HEAD; bash fails then PowerShell is buggy; handoffs should minimise GH-issue drift; CLAUDE.md
becomes bloated and starts to conflict. Everything must move as one mind.*

They reduce to a single root cause:

> **The ASDLC records as prose what should be measured, and offers as a choice what should be bound
> by the environment.**

Prose self-discipline fails under momentum. `docs/superpowers/specs/2026-07-22-loop-hardening-design.md`
already established this and fixed it for `STATUS.md` — scripts took over the bookkeeping. The same
disease is now in four other places.

### Verified evidence

| Symptom | Evidence | How to re-check |
|---|---|---|
| **CLAUDE.md rots** | `gaw/CLAUDE.md` calls the `deep` test tier "the authoritative gate… on every PR" (L115-117) **and** "advisory, AFTER merge" (L64) — a self-contradiction in one file. Three stale counts (fast 722→**802**, smoke 35→**45**, full 1683→**1917**). Admin console port says 3001; operator memory says 3002. L136 instructs *"Keep the timings in § Run/verify honest"* directly above the wrong timings. | Read the file; run `uv run pytest -q`. |
| **Issues drift** | `gaw/docs/v0.13-build-sequence.md` § Verification log exists *only* to record that issues were wrong: *"every `resolution.py` citation was +13 stale"*, *"+24 stale"*, *"frontend +8"*. | Read that section. |
| **Concurrency breaks HEAD** | A **1.15 GB** worktree at `gaw/.claude/worktrees/sprint+v0.12-s14`, last written 2026-07-28, holding `sprint/v0.12-s15` with **14 uncommitted files**. Four orphan local branches. | `git worktree list`; `git branch` |
| **Hygiene can't see it** | **Confirmed bug in this repo.** `scripts/asdlc/gh-hygiene.js:17-20` treats a branch as stale only when `git log <trunk>..<branch>` is empty. Under **squash-merge** — which `finish-sprint.js` performs — that is *never* empty. All three orphan branches have merged PRs (#156, #160, #162) yet report 1–3 commits ahead, so the audit reports **zero** stale branches. It is blind to exactly the workflow the plugin prescribes. | `git log main..sprint/v0.12-s15 --oneline` → 3 commits; `gh pr list --state merged --head sprint/v0.12-s15` → #162 |
| **Shell thrash** | `pwsh` is **not installed** → Windows PowerShell 5.1, whose ANSI-default encoding silently corrupted `backend/app/services/case_engine/emit.py` (every em-dash destroyed on a read-modify-write). `bash` on PATH is `C:\Windows\system32\bash.exe` — the **WSL** launcher — while the Bash tool uses **Git Bash MSYS**, which died 4× with `add_item ("\??\C:\Program Files\Git", "/", …) failed, errno 1`. | `Get-Command pwsh`; `Get-Command bash` |
| **The documented shell fix is stale** | `~/.claude/CLAUDE.md` concludes the unpinned `npx` statusline was the root cause (fixed 2026-07-16). But the statusline now points at an installed `.cmd`, **zero** `bash.exe`/`sh.exe` processes were running, and the crash still fired repeatedly. The diagnosis is not the whole story. | `Get-CimInstance Win32_Process -Filter "Name='bash.exe'"` → 0 |

**Target outcome:** a session reads a small set of files that *cannot* be stale, and nothing checkable
is stored as prose.

---

## W1 — One shell, bound by the environment
**Where:** machine config + this repo (new doc) + `gaw/.claude/rules/`
**Decision taken:** install PowerShell 7 and make it canonical; retire the Bash tool on this machine.

### The from-scratch design (five principles)

1. **The agent must not choose the shell.** Shell choice is a property of the environment, not of the
   task. Exposing two shell tools means the agent picks by habit — its training is overwhelmingly
   POSIX-shaped — and then thrashes between them on failure. One tool, bound at session start.
2. **On Windows, prefer a real runtime over an emulation.** MSYS2 must map a shared memory region at a
   fixed address during DLL initialisation; `add_item(…) failed, errno 1` *is* that step failing.
   WSL2 is a real kernel and has no such failure mode. State the trade-off honestly: WSL's `/mnt/c`
   access is materially slower for a repo on the C: drive, so it is not a free swap for test runs.
3. **Shells run processes; tools touch files.** Both of v0.13-s8's tooling defects — the encoding
   corruption *and* a CRLF/LF anchor mismatch that silently skipped 3 of 8 mutation checks — came from
   round-tripping source files through a shell. Read/Edit/Write handle encoding correctly. One stated
   rule deletes both bug classes.
4. **A broken shell should fail once, loudly, and stand down.** The MSYS fatal error surfaces as exit
   code 5 with a message that reads as transient, so the agent retries a different way each time. The
   correct behaviour is to recognise the signature and stop offering that shell for the session.
5. **Fix papercuts by upgrading the runtime, not by documenting them.** The PowerShell tool
   description carries roughly 80 lines of PS 5.1 workarounds. `&&` / `||`, ternary, `??`, `?.`,
   UTF-8-by-default encoding and `ConvertFrom-Json -AsHashtable` are **all** present in PowerShell 7.
   One install removes most of that prompt and a whole class of bugs.

### Actions

- `winget install Microsoft.PowerShell`; confirm Claude Code resolves `pwsh`.
- Stop using the Bash tool on this machine. Where POSIX is genuinely needed, invoke it explicitly:
  `wsl -e bash -lc '…'` (Ubuntu-22.04 is already installed).
- Add `gaw/.claude/rules/shell-and-files.md`, auto-loading on `scripts/**` — principle 3 verbatim,
  plus the concrete facts: `quote_worker.py` and `resolution.py` are **CRLF**, newly-written files are
  **LF**, and `Get-Content -Raw` / `Set-Content` must never be used on source (use
  `[System.IO.File]::ReadAllText` / `WriteAllText`, or better, the file tools).
- **Rewrite the shell section of `~/.claude/CLAUDE.md`.** Replace the forensic narrative with the
  decision (pwsh canonical, Bash tool retired) and one line on the symptom. Keep the `gh`-token
  header workaround — it is still the right escape hatch — but drop the statusline causal story,
  which the evidence above contradicts.
- Write the principles above to `docs/2026-08-04-shell-strategy.md` in this repo.

---

## W2 — CLAUDE.md: measured facts, stable slugs, a lint
**Where:** this repo (`scripts/asdlc/`, `skills/agentic-sdlc/references/`), then applied to `gaw`.

- **`scripts/asdlc/facts.js`** rewrites an `<!-- asdlc:facts:auto -->` block by **running** the
  commands declared in a small `.asdlc/facts.json` manifest and capturing real counts, timings and
  ports. This is the same move `checkpoint-hooks.js` already makes for the current-state pointer. If a
  declared command fails, the block records that — a visible gap, never a stale number.
- **Rules get stable slugs, not numbers** (`#checkpoint`, `#git`, `#spine-first`). `gaw`'s operating
  rule 4 is a *retired* rule embalmed in a slot purely so historical citations of "rule 6"/"rule 7"
  still resolve. Numbering guarantees that recurs; slugs let a dead rule simply be deleted.
- **`scripts/asdlc/asdlc-lint.js`** fails on: an absent or stale facts block; a retired rule still
  occupying a slot; any rule paragraph over ~120 words (`gaw`'s rule 1 is ~700); and a contradiction
  between two declared facts — the deep-tier one would have been caught.
- **Fix this repo's own drift first.** `skills/agentic-sdlc/references/claude-md-skeleton.md:38` still
  prescribes *"Security-sensitive work gets an adversarial multi-agent review before handoff"* — the
  exact mandate `gaw` retired in v0.13-s2 for hard-blocking sessions configured without subagents.
  Replace with the opt-in wording from W5. The skeleton has drifted from the lesson its own main
  consumer learned.
- **Then apply to `gaw/CLAUDE.md`:** resolve the deep-tier contradiction; move counts, timings and
  ports into the facts block; delete rule 4; split rule 1's mega-paragraph; correct the admin port.

---

## W3 — Issues carry intent and acceptance, never coordinates
**Where:** this repo (`commands/profile-issue.md`, issue template), then `gaw`.

The verification log is a **compensating control** for issue drift. Remove the cause instead.

- **Prohibit `file:line` references in issue bodies.** Name the symbol (`resolution.run_build_reply`),
  not the line. This merely generalises a rule the ecosystem already has — `gaw`'s
  `.claude/rules/tests-must-be-able-to-fail.md` states: *"Describe the mutation by name, not by line
  number… line numbers decay while the file is still being edited."* Coordinates belong in the
  **plan**, written at sprint start against the live tree, where they cannot go stale before use.
- **Close the loop mechanically.** `finish-sprint.js` posts the handoff's *Acceptance → evidence*
  table as the issue's closing comment. GitHub then carries the verdict and no future session
  re-derives it.
- **Verification-log entries become their own files** (`docs/verification/<issue>-<date>.md`) with a
  one-line index row. Each entry is currently a single Markdown table cell of 800+ words, so reading
  the index at all costs an estimated ~9k tokens. This is the plugin's own "reference, never mirror"
  rule applied to a file that predates it.

---

## W4 — Concurrency: one sprint = one worktree = one session
**Where:** this repo (`gh-hygiene.js`, `finish-sprint.js`, `new-sprint.js`, `state-model.md`) + a
one-off cleanup in `gaw`.

State the mental model once, in `state-model.md`:

> A worktree is a second working tree with **its own HEAD**. A branch can be checked out in exactly
> one tree at a time. **The safe unit of concurrency is the worktree, not the session** — two sessions
> in one directory will fight over HEAD; two sessions in two worktrees cannot.

- **Fix `gh-hygiene.js:17-20`** — the verified squash-merge blind spot. Replace the
  `git log <trunk>..<branch>` emptiness test with a merged-PR lookup
  (`gh pr list --state merged --head <branch>`), falling back to `git cherry` where there is no
  GitHub remote. **Regression test:** against `gaw` as it stands today the audit must report
  `sprint/v0.12-s11`, `-s14` and `-s15` as stale; it currently reports none.
- **Add a worktree audit**: any worktree older than N days, holding a branch with a merged PR, or
  carrying uncommitted files.
- **`finish-sprint.js` removes the worktree and deletes the branch** after a successful merge.
- **`new-sprint.js` refuses when a stale worktree exists** — it already gates on unmerged branches;
  this is the same gate for the other resource.
- **One-off cleanup in `gaw`:** inspect the 14 dirty files in `.claude/worktrees/sprint+v0.12-s14`,
  then remove the 1.15 GB worktree and the four orphan branches.

---

## W5 — Workflows: opt-in, one per ASDLC phase
**Where:** this repo, new `.claude/workflows/` (absent in all three repos today).

Workflows belong to the ASDLC's **phases**, shipped by the plugin and scaffolded by
`/bootstrap-asdlc` — not authored per sprint. The phases already have stable execution shapes, and a
shape re-invented every sprint never improves.

- **`verify-issue-sweep.js`** — multi-modal sweep over an issue's claims, then adversarial refutation
  of each. This is what `/verify-issue` already prescribes in prose; v0.13-s8's own verification log
  records that the adversarial pass was run *inline* rather than by an independent reviewer, "recorded
  rather than left implied".
- **`pre-handoff-review.js`** — dimensions → find → adversarially verify.

**Opt-in is the design, and it is the operator's own lesson.** `gaw` operating rule 4 was a
*mandatory* adversarial multi-agent review. It was retired 2026-07-30 because it fired on a large
share of sprints and collided with sessions configured not to spawn subagents, "producing a
merge-blocking decision every time instead of a review". Therefore:

> The command **offers** a workflow when the diff or the issue warrants it, and states the rough cost.
> It never requires one. Its absence is **never** a gap to record in a handoff.

**Explicit non-goal:** the mutation battery is *not* a workflow. It is deterministic script work with
no agent judgement inside the loop — that is `mutate.js`, specced in the companion document.

---

## Sequencing

| # | Workstream | Where | Size |
|---|---|---|---|
| 1 | W1 — install pwsh, retire the Bash tool, shell-strategy doc, fix global CLAUDE.md | machine + this repo + `gaw` | S |
| 2 | W4 cleanup — remove the stale worktree and four branches | `gaw` | S |
| 3 | W4 tooling — `gh-hygiene` squash-merge fix, worktree audit, finish/new-sprint gates | this repo | M |
| 4 | W2 — `facts.js`, `asdlc-lint.js`, skeleton fix, then apply to `gaw/CLAUDE.md` | both | M |
| 5 | W3 — no-coordinates rule, closing-comment automation, verification-log split | both | M |
| 6 | W5 — two workflows + command offers | this repo | M |

Items 1 and 2 are cheap and remove live hazards — worth doing before the next `gaw` sprint. The rest
is a dedicated `agentic-sdlc` sprint, and slots naturally alongside the `mutate.js` work in the
companion document (which should be items 0 and 3½ if the two are merged into one sprint sequence).

---

## Verification

- **W1** — `pwsh -v` resolves; a round-trip of a file containing `—` through the file tools preserves
  it; a command using `&&` parses without error.
- **W2** — run `facts.js` and confirm the block matches a fresh `pytest -q`; hand-edit a count and
  confirm `asdlc-lint` fails; re-introduce the deep-tier contradiction and confirm it fails.
- **W3** — open a test issue containing `foo.py:123` and confirm `profile-issue` rejects it.
- **W4** — the regression test above: `gh-hygiene` must report the three orphan branches as stale
  where it currently reports none. Then confirm it reports clean after cleanup, and that
  `git worktree list` shows only the main tree.
- **W5** — run each workflow against a real **closed** issue and compare its findings against that
  issue's recorded verification-log entry. The log is the ground truth for whether the workflow adds
  anything a careful inline pass would not have found.
- **End-to-end** — run the next `gaw` sprint with W1 and W4 in place, and compare its handoff's
  harness-notes section against v0.13-s8's, which documents two shell failure classes that should no
  longer be possible.
