---
description: >-
  Structured local correctness and simplicity review
argument-hint: "[diff/branch/PR context]"
---
Run a local structured review. This prompt owns dispatch; use
`requesting-code-review` only for review practice, not its `general-purpose`
reviewer dispatch. Establish requirements and inspect the current diff and
relevant context before conclusions. Supply enough task-specific context for
a fresh reviewer: scope, requirements, repository standards, relevant history,
and PR description or linked issues when available; local reviews need no PR.
For fresh reviews, withhold prior bot/human verdicts until independent
investigation, then supply them for verification and deduplication. For
feedback-validation requests or verdicts already in context, disclose that
exposure and require independent verification of supplied claims.

Scale supporting investigation to risk, prioritizing early verification of
high-risk hypotheses over exhaustive inventory. Give a brief conversational
orientation to intent and tradeoffs where useful; do not require per-file user
approval or treat stated intent as proof.

For every explicitly requested review, including small reviews, freeze writes
and run the `ponytail-review` checkpoint (`../skills/ponytail-review/SKILL.md`)
with `capture-diff`, an explicit base, and approved requirements. That skill
owns capture, verification, simplifier dispatch, retry, and acceptance.
Concurrently, give a read-only foreground `reviewer` the same frozen snapshot,
identities, and requirements with full-read instructions for correctness,
safety, regressions, and test coverage. Explicitly forbid edits.

Keep writes frozen until both complete; neither review substitutes for the
other. An unresolved simplicity checkpoint blocks completion unless the user
explicitly waives it. An incomplete correctness review also blocks
completion; never present either as successful. Accept a clean correctness
review only with a completed lifecycle result for the captured identity,
concrete coverage and check evidence, and explicit gaps. Aborted or
turn-limited reviews are incomplete, not passes; serious unverified concerns
remain explicit pre-merge checks, not confirmed defects or silent omissions.

Personally verify both sets of findings before posting or acting. Consolidate
justified corrections into one pass with the existing writer. Resolve every
blocking simplicity finding by fixing and reassessing it or rejecting it with
recorded technical evidence. Never apply findings automatically. Any content
change requires a fresh simplicity review; refresh correctness review for
changed code as well.

Review context:

$ARGUMENTS
