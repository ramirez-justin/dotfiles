---
description: >-
  Structured local correctness and simplicity review
argument-hint: "[diff/branch/PR context]"
---
Run a local structured review. This prompt owns dispatch; use
`requesting-code-review` only for review practice, not its `general-purpose`
reviewer dispatch. Inspect the current diff and relevant files before
conclusions.

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
completion; never present either as successful.

Personally verify both sets of findings before posting or acting. Consolidate
justified corrections into one pass with the existing writer. Resolve every
blocking simplicity finding by fixing and reassessing it or rejecting it with
recorded technical evidence. Never apply findings automatically. Any content
change requires a fresh simplicity review; refresh correctness review for
changed code as well.

Review context:

$ARGUMENTS
