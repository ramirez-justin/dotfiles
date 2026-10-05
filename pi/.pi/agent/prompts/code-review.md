---
description: >-
  Use Superpowers requesting-code-review for a structured local review
argument-hint: "[diff/branch/PR context]"
---
Use `requesting-code-review` for the correctness review and load
`../skills/ponytail-review/SKILL.md` for the separate simplicity checkpoint.
Inspect the current diff and relevant files before conclusions.

For every explicitly requested review, including small reviews, freeze writes
and use `ponytail-review`'s canonical `capture-diff` helper with an explicit
base and approved requirements. Pin the receipt and verify before dispatch.
Give both agents the same frozen snapshot, identities, and requirements with
full-read continuation instructions, and dispatch them concurrently:

- A read-only `reviewer` with `run_in_background: false` for correctness,
  safety, regressions, and test coverage. Explicitly forbid edits.
- An isolated `simplifier` with `run_in_background: false` and
  `isolated: true` for unnecessary machinery only. Send the helper-generated
  prompt verbatim, following `ponytail-review`'s capture/verification contract.
  Do not manually reconstruct payloads or depend on inherited context.

Keep writes frozen, wait for both completed lifecycle results, and verify the
packet again before concluding; neither review substitutes for the other.
Validate the simplifier report sections and echoed identities. Retry a failed
dispatch, collection, malformed, substituted, or mismatched simplicity result
once, then block unless explicitly waived by the user. An incomplete
correctness review also blocks completion; never present it as successful.

Personally verify both sets of findings before posting or acting. Consolidate
justified corrections into one pass with the existing writer. Resolve every
blocking simplicity finding by fixing and reassessing it or rejecting it with
recorded technical evidence. Never apply findings automatically. Any content
change requires a fresh simplicity artifact and review; refresh correctness
review for changed code as well.

Review context:

$ARGUMENTS
