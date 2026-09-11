# Project Memory: Chalk

Stable facts for `github.com/gametimesf/chalk`.

## Rules

- Do not store secrets, credentials, transient state, or unverified guesses.
- Keep facts stable, actionable, and specific to this repository.
- Audit existing facts before adding or changing entries.

## Facts

- Permit online and offline divergence at the raw-source boundary when needed,
  but define downstream feature transformations once. Prefer Chalk expressions
  and materialization over duplicate aggregations in online and offline SQL.
- When intentionally different feature semantics are required, use distinct
  names and document the difference rather than resolving one feature with
  divergent algorithms.
