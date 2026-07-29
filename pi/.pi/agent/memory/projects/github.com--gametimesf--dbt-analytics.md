# Project Memory: dbt analytics

Stable facts for `github.com/gametimesf/dbt-analytics`.

## Rules

- Do not store secrets, credentials, transient state, or unverified
  guesses.
- Keep facts stable, actionable, and specific to this repository.
- Audit existing facts before adding or changing entries.

## Facts

- Build downstream dbt models from `stg_*` models whenever the source data is
  available there. Staging models are the cleaned, ready-to-use interface;
  avoid reaching around them to raw sources or legacy core models for fields
  that staging already exposes.
- Data API models should preserve staging-only lineage. For event-to-performer
  mapping, prefer `stg_mongo__events` and extract primary/secondary performer
  IDs there instead of depending on legacy core `mongo__events`.
- Branch rules can require commit status contexts that differ from GitHub check
  run names. In `dbt-analytics`, the `dbt QA` workflow forwards required
  `dbt QA / ...` commit statuses for branch protection.
- In `dbt-analytics`, expensive staging models over external tables or window
  functions should bound non-production builds while preserving production
  behavior, because CI uses sampled/modified-state builds and can time out on
  unbounded first runs.
