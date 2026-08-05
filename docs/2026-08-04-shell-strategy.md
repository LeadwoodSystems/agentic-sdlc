# Shell strategy: one shell, bound by the environment

**Date:** 2026-08-04
**Status:** decided and applied (machine-level)
**Source:** W1 of `2026-08-04-asdlc-hardening-plan.md`
**Decision:** PowerShell 7 is canonical on this machine; the Bash tool is retired.

## The five principles

### 1. The agent must not choose the shell
Shell choice is a property of the environment, not of the task. Exposing two shell tools
means the agent picks by habit — its training is overwhelmingly POSIX-shaped — and then
thrashes between them on failure. One tool, bound at session start.

### 2. On Windows, prefer a real runtime over an emulation
MSYS2 must map a shared memory region at a fixed address during DLL initialisation.
`add_item ("\??\C:\Program Files\Git", "/", …) failed, errno 1` *is* that step failing.
WSL2 is a real kernel and has no such failure mode.

State the trade-off honestly: WSL's `/mnt/c` access is materially slower for a repo on
the C: drive, so it is not a free swap for test runs.

### 3. Shells run processes; tools touch files
Both of GAW v0.13-s8's tooling defects came from round-tripping source files through a
shell:

- **Encoding corruption.** `Get-Content -Raw` / `Set-Content` under PowerShell 5.1 reads
  a BOM-less UTF-8 file as ANSI. Every em-dash in `case_engine/emit.py` was destroyed on
  a read-modify-write.
- **CRLF/LF anchor mismatch.** Multi-line anchors joined with `\n` silently failed to
  match CRLF source, skipping 3 of 8 mutation checks with no error.

Read/Edit/Write handle encoding correctly. One stated rule deletes both bug classes:
**never round-trip source files through a shell.** Where a script must do it, use
`[System.IO.File]::ReadAllText` / `WriteAllText`, never `Get-Content -Raw` /
`Set-Content`.

### 4. A broken shell should fail once, loudly, and stand down
The MSYS fatal error surfaces as exit code 5 with a message that reads as transient, so
the agent retries a different way each time. The correct behaviour is to recognise the
signature and stop offering that shell for the session.

### 5. Fix papercuts by upgrading the runtime, not by documenting them
The PowerShell tool description carries roughly 80 lines of PS 5.1 workarounds. `&&` /
`||`, ternary, `??`, `?.`, UTF-8-by-default encoding and `ConvertFrom-Json -AsHashtable`
are **all** present in PowerShell 7. One install removes most of that prompt and a whole
class of bugs.

## What was applied

- `winget install Microsoft.PowerShell` — PowerShell 7 installed.
- The Bash tool is retired on this machine. Where POSIX is genuinely needed, invoke it
  explicitly: `wsl -e bash -lc '…'`.
- `~/.claude/CLAUDE.md`'s shell section rewritten to carry the decision rather than the
  forensic narrative.

## Why the previous diagnosis was incomplete

`~/.claude/CLAUDE.md` concluded (2026-07-16) that an unpinned `npx` statusline was the
root cause of the MSYS crashes, and that installing `ccstatusline` globally fixed it.

That is not the whole story. Re-measured 2026-08-04:

- the statusline already points at an installed `.cmd` — no `npx`, no per-render shell,
- `Get-CimInstance Win32_Process -Filter "Name='bash.exe'"` returned **zero** processes,
- and the crash still fired, mid-session, on an ordinary `git diff` invocation.

The statusline pile-up was real and worth fixing, but it was an *aggravator*, not the
cause. The cause is principle 2: MSYS's fixed-address shared-memory mapping is fragile on
this machine regardless of what else is running. That is why the fix is "stop using it",
not "keep the process count down".

The `gh`-token `extraheader` escape hatch remains valid and is retained — it bypasses
git's credential-prompt/askpass path entirely, so it works even while MSYS is unstable.
