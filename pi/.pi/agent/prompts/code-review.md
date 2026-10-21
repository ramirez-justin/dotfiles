---
description: >-
  Structured local correctness and simplicity review
argument-hint: "[diff/branch/PR context]"
---
Run a local structured review. This prompt owns dispatch; use
`requesting-code-review` only for review practice, not its `general-purpose`
reviewer dispatch. Establish requirements and inspect the current diff and
relevant context. Supply scope, requirements, repository standards, relevant
history, and PR/linked issues when available; local reviews need no PR. The
`reviewer` role owns investigation and report details. For fresh reviews,
withhold prior bot/human verdicts until independent investigation, then supply
them for verification and deduplication. Disclose already exposed verdicts or
feedback-validation context and require independent verification.

Give a brief conversational orientation to intent and tradeoffs where useful;
do not require per-file approval or treat stated intent as proof.

For every explicitly requested review, including small reviews, freeze writes
and run the `ponytail-review` checkpoint (`../skills/ponytail-review/SKILL.md`)
with `capture-diff`, an explicit base, and approved requirements. That skill
owns capture, verification, simplifier dispatch, retry, and acceptance.
Concurrently, give a read-only foreground `reviewer` the same frozen snapshot,
identities, and requirements with full-read instructions for correctness,
safety, regressions, and test coverage. Explicitly forbid edits. Do not give
that reviewer the simplifier-specific generated prompt.

Keep writes frozen until both complete; neither review substitutes for the
other. An unresolved simplicity checkpoint blocks completion unless the user
explicitly waives it. An incomplete correctness review also blocks completion;
never present either as successful. Before accepting the reviewer's JSON,
validate all nine required fields and their types/enums against its Report
contract, exact captured identity, the actual completed lifecycle result,
concrete coverage/check evidence, and honest essential gaps. Request one
corrected report for malformed output; otherwise mark it incomplete. A report's
state alone cannot prove lifecycle completion. Essential gaps prevent a clean
verdict; retain verified findings and serious unverified pre-merge checks even
when incomplete. No-confirmed-findings is not proof of correctness.

Personally verify both sets of findings before posting or acting. Consolidate
justified corrections into one pass with the existing writer. Resolve every
blocking simplicity finding by fixing and reassessing it or rejecting it with
recorded technical evidence. Never apply findings automatically. Any content
change requires a fresh simplicity review; refresh correctness review for
changed code as well. Present accepted results as concise human-readable
findings and remaining checks/gaps, not a JSON dump.

Review context:

$ARGUMENTS
