---
description: >-
  Use Superpowers requesting-code-review for a structured local review
argument-hint: "[diff/branch/PR context]"
---
Use `requesting-code-review` for the correctness review and load
`../skills/ponytail-review/SKILL.md` for the separate simplicity checkpoint.
Inspect the current diff and relevant files before conclusions.

For every explicitly requested review, including small reviews, launch both:

- A read-only `reviewer` with `run_in_background: false` for correctness,
  safety, regressions, and test coverage. Explicitly forbid edits.
- An isolated `simplifier` with `run_in_background: false` and
  `isolated: true` for unnecessary machinery only, following the complete
  artifact capture and identity contract in `ponytail-review`.

Freeze writes during review. Wait for both completed lifecycle results before
concluding; neither review substitutes for the other. Validate the simplifier
report sections and echoed identities. Retry a failed dispatch, collection,
malformed, substituted, or mismatched simplicity result once, then block unless
explicitly waived by the user. An incomplete correctness review also blocks
review completion; never present it as a successful review.

Personally verify findings before posting or acting. Resolve every blocking
simplicity finding by fixing and reassessing it or rejecting it with recorded
technical evidence. Never apply findings automatically. Any content change
requires a fresh simplicity artifact and review; refresh correctness review
for changed code as well.

Review context:

$ARGUMENTS
