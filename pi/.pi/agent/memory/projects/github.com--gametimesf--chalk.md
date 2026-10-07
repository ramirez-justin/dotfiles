# Project Memory: Chalk

Stable facts for `github.com/gametimesf/chalk`.

## Rules

- Store only stable facts specific to this repository.

## Facts

- Permit online and offline divergence at the raw-source boundary when needed,
  but define downstream feature transformations once. Prefer Chalk expressions
  and materialization over duplicate aggregations in online and offline SQL.
- When intentionally different feature semantics are required, use distinct
  names and document the difference rather than resolving one feature with
  divergent algorithms.
