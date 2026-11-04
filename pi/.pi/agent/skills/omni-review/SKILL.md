---
name: omni-review
description: >-
  Verify Omni semantic-model PRs, measures, templated filters, and query
  behavior using branch-bound CLI checks.
disable-model-invocation: true
metadata:
  status: experimental
---

# Omni Review

Use alongside reviewing-prs-with-verification, omni-model-explorer, and
omni-query. Consult omni-model-builder for modeling semantics.

## Establish the target

- Read repository instructions, model YAML, related topics, and CI.
- Pin the PR head. Verify live branch YAML matches the reviewed version.
- Use the project's explicit OAuth profile, not a global profile switch.
- Reviews are read-only; do not create branches or change model defaults.

## Discover current contracts

- Read `omni agent-help`, command `--help`, and focused `--schema` output.
- Search official docs with `omni ai search-omni-docs`; verify its current
  request schema first and follow primary-source links.
- Distinguish documented behavior from observations on this model.
- Reconcile upstream Git-authoring advice with verified repository and
  live sync behavior before recommending an authoring path.

## Verify behavior

- Inspect compiled SQL with `planOnly: true` first.
- Supply `branchId` at request top level and `modelId` inside `query`.
- Do not combine planOnly with resultType or workbook creation.
- Test filter omission/default, explicit alternate value, zero, and
  explicitly cleared value where relevant. These are distinct cases.
- Pass typed query filters; confirm their effect in compiled SQL.
- Check measure grain, aggregation, joins, category inclusion, units,
  date windows, and null-versus-zero behavior.
- Execute bounded aggregate queries when needed. Inspect the actual
  response format and completion status before trusting results.
- Model validation does not establish result correctness.
- Query results do not establish workbook-control behavior or migration
  parity. Verify those separately or report the evidence gap.
- Keep credentials and sensitive result rows out of review artifacts.

## Report

State the reviewed commit and Omni branch, checks performed, verified
findings, and remaining gaps. Follow the existing approval gate before
posting any review.
