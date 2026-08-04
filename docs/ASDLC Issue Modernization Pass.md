# ASDLC Issue Modernization Pass

Your task is to review every **open GitHub Issue** in this repository and modernize it according to the latest ASDLC philosophy.

Do **not** change the intent or scope of the issue. Instead, improve its execution metadata, clarity, and readiness for AI-assisted development.

---

## Objectives

For every open issue:

1. Read and understand the complete issue.
2. Determine the actual engineering work required.
3. Estimate the complexity and risk.
4. Recommend the most appropriate AI model(s) for each phase of the work.
5. Update the issue by appending (not replacing) an **ASDLC Execution Profile** section.
6. Add or update labels where appropriate.

---

## Guiding Principle

Use the **least capable (fastest/cheapest) model that can reliably complete the work**.

Do **not** default everything to Opus.

Reason about:

* ambiguity
* architectural impact
* blast radius
* codebase familiarity required
* expected reasoning depth
* likelihood of hidden coupling
* implementation complexity
* security implications
* expected review effort

---

## Execution Classes

Use these capability classes.

### Fast

Suitable for:

* documentation
* formatting
* simple refactoring
* isolated fixes
* repetitive work
* issue grooming
* handoff generation

Recommended models:

* Haiku-class

---

### Standard

Suitable for:

* normal implementation
* feature development
* API work
* UI work
* database changes
* moderate debugging
* writing tests

Recommended models:

* Sonnet-class

---

### Deep

Suitable for:

* architecture
* planning
* difficult debugging
* cross-cutting refactors
* security-sensitive work
* governance
* ambiguous requirements
* high-risk reviews

Recommended models:

* Opus-class

---

### Deterministic

No LLM required.

Examples:

* lint
* compilation
* unit tests
* integration tests
* Docker builds
* migrations
* CI verification

These should always be delegated to the runner/toolchain.

---

## For every issue append the following section

```markdown
---

# ASDLC Execution Profile

## Engineering Assessment

Complexity:
- Low / Medium / High

Risk:
- Low / Medium / High

Expected Duration:
- <30 min
- 30–90 min
- Half day
- Full day
- Multi-sprint

Architecture Impact:
- Low / Medium / High

---

## Recommended Workflow

Planning

Execution Class:
Deep / Standard / Fast

Recommended Model:
(Opus / Sonnet / Haiku)

Reason:
(short justification)

---

Implementation

Execution Class:

Recommended Model:

Reason:

---

Verification

Execution Class:
Deterministic

Runner:
CI / GitHub Runner

Tasks:
- lint
- tests
- build
- etc.

---

Review

Execution Class:

Recommended Model:

Reason:

---

## Escalation Rules

Escalate if:

- implementation fails twice
- hidden architectural coupling discovered
- issue scope expands significantly
- security boundary changes
- required context exceeds practical limits

---

## Suggested Labels

complexity/*
risk/*
model/*
execution/*
```

---

## Label Conventions

Apply labels where appropriate.

Examples:

complexity/low

complexity/medium

complexity/high

risk/low

risk/medium

risk/high

model/haiku

model/sonnet

model/opus

execution/fast

execution/standard

execution/deep

execution/deterministic

---

## Constraints

* Do NOT rewrite acceptance criteria.
* Do NOT change implementation scope.
* Do NOT split issues unless absolutely necessary.
* Preserve all existing discussion.
* Append information instead of replacing it.
* If uncertain, explain your reasoning.

---

Think like an experienced software engineering lead reviewing the backlog for efficient AI execution, not merely assigning a model. The goal is to leave every issue more executable, more predictable, and better aligned with the ASDLC methodology.
