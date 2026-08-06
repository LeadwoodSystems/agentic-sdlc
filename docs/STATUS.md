# STATUS

Append-only running history, oldest to newest. Never hand-edit — corrections
happen by re-running `scripts/asdlc/checkpoint-hooks.js` / `finish-sprint.js`,
not by typing into this file.

- 2026-08-04 **v0.2-s1** — Execution Profiles: /profile-issue, lib/profile-block.js, execution-classes policy; GAW v0.13 backlog 33/33 profiled — [handoff](docs/handoffs/v0.2-s1-execution-profiles.md) — status: merged (322ead8)
- 2026-08-05 **v0.2-s2** — Worktree/branch lifecycle (squash-merge detection, worktree audit, gate reorder) + measured facts block, lint, and this repo's own CLAUDE.md — [handoff](docs/handoffs/v0.2-s2-worktrees-and-facts.md) — status: merged (44f9a3d)
- 2026-08-05 **v0.2-s3** — mutate.js: manifest-driven mutation runs with EOL-preserving anchors, revert verification and a not-evidence exit code, plus the test-mutation-evidence reference and /checkpoint hook — [handoff](docs/handoffs/v0.2-s3-mutation-tooling.md) — status: merged (f9c811f)
- 2026-08-05 **v0.2-s4** — bootstrap derives its script set instead of enumerating it (the stale list is why consumers never got mutate.js), gh-hygiene gains a sixth check for failing scheduled workflows, plan-template gains the test-tier and regression-sweep riders — [handoff](docs/handoffs/v0.2-s4-bootstrap-derivation-and-riders.md) — status: merged (87e82b9)
- 2026-08-05 **v0.2-s5** — mutation verdicts are now measured rather than reasoned - mutate.js runs the test command unmutated first and refuses an expectRed that already appears in a green run (EXPECT-RED-INERT) or a suite that was already failing (BASELINE-RED); the v0.2-s3 manifest was re-anchored on assertion messages and re-run, and all three of its verdicts held — [handoff](docs/handoffs/v0.2-s5-mutation-baseline-gate.md) — status: merged (c446374)
- 2026-08-05 **v0.2-s6** — checkpoint-hooks now writes through lib/marker-block.js so a checkpoint preserves CRLF; the plugin's own command surface is being dogfooded rather than hand-copied, and three subset enumerations plus the plan-template copy are gone — [handoff](docs/handoffs/v0.2-s6-invariant-drift.md) — status: merged (529d35a)
- 2026-08-06 **v0.2-s7** — profile-block.js now writes through lib/marker-block.js, retiring the last hand-rolled marker splice; mutate.js gains a testable runCli seam so the exit code every checkpoint reads is finally covered; the legacy loop-hardening plan is renamed to pair with its handoff — [handoff](docs/handoffs/v0.2-s7-marker-consolidation.md) — status: merged (ddb1b0c)
- 2026-08-06 **v0.2-s8** — Remote-delete honesty: finish-sprint.js stops swallowing a failed remote branch delete, and gh-hygiene.js can finally see the debris it leaves — [handoff](docs/handoffs/v0.2-s8-remote-delete-honesty.md) — status: awaiting-merge
