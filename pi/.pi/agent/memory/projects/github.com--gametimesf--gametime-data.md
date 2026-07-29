# Project Memory: Gametime Data

Stable facts for `github.com/gametimesf/gametime-data`.

## Rules

- Do not store secrets, credentials, transient state, or unverified
  guesses.
- Keep facts stable, actionable, and specific to this repository.
- Audit existing facts before adding or changing entries.

## Facts

- Use `mlctl job logs <job-ref>` to retrieve Baseline/SageMaker notebook output,
  final counters, runtime warnings, and benchmark metrics.

- In `gametime-data`, Astro staging and production deploy workflows both call
  `.github/workflows/astro-deploy-to-env.yml`; changes there affect production
  deploys as well as staging. Keep the workflow's `actions/setup-python`
  version in sync when updating the Airflow Python version.
- For Airflow scheduled windows, derive partition/logical-date semantics from
  `data_interval_start` and use `data_interval_end` only as the upper bound.
- Avoid mutating `sys.modules` in tests to stub normal project dependencies;
  it can leak across the pytest session.
- When DAGs and extractors need the same dataset list, share it from a
  lightweight module instead of duplicating lists or importing heavy task code
  at DAG parse time.
- New Snowflake external tables backed by S3 should usually include matching
  entries in `adhoc-ops-toolkit/s3-event-notifications` so auto-refresh works.
- In Snowflake, schema-level future grants take precedence over database-level
  future grants for the same object type in that schema. Avoid adding schema
  future grants casually in `RAW_DB` or `SOURCE_DB` because they can bypass
  database-level future-grant expectations.
- In `gametime-data`, Assembled `/forecasts` requires `start_time` and
  `end_time` epoch values aligned to the requested `interval`; half-hour Airflow
  schedules need explicit alignment before calling the API.
