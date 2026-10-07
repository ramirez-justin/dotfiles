# Project Memory: Gametime Data

Stable facts for `github.com/gametimesf/gametime-data`.

## Rules

- Store only stable facts specific to this repository.

## Facts

- Use `mlctl job logs <job-ref>` to retrieve Baseline/SageMaker notebook output,
  final counters, runtime warnings, and benchmark metrics. For resource-failure
  diagnosis, query CloudWatch in the workload account rather than assuming the
  source-data or container-registry account owns the job. Baseline CloudWatch
  hosts use `baseline-<job-ref>/algo-1` in the
  `/aws/sagemaker/TrainingJobs` namespace. Check host memory, GPU memory, GPU
  utilization, disk, and the underlying log stream together. Zero-valued host
  telemetry is not proof that usage was zero; treat it as missing/broken data.
  Low GPU memory plus zero GPU utilization rules against GPU OOM, but does not
  exclude host OOM, input decoding failures, or native-process crashes.

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
- With inherited grants, a role may `SELECT` and `SHOW` schema objects while
  `INFORMATION_SCHEMA` hides them if the account's `2026_07` behavior bundle
  is disabled. BCR-2416 fixes that metadata gap. Check the live account,
  role, bundle status, and metadata counts before refreshing a BI schema
  model; a hard refresh can remove generated definitions. Enabling a bundle
  affects unrelated account behavior and requires explicit approval.
- For Snowflake RBAC migrations, source changes, approved saved plans and
  strict Terraform before/after checks, grant metadata, and ordinary-role
  access are separate evidence gates. `snowflake_state_inventory.py` reads
  state from stdin and counts tracked instances, not live Snowflake objects
  or effective access. Keep raw state, plans, and grant rows out of Git and
  chat.
- Treat all `RFD__*` and `TRF__*` Snowflake schemas as transitional. Their
  models will be migrated or succeeded by new tables, so do not establish them
  as durable consumer contracts; prefer stable ADL products or named successors.
- In `gametime-data`, Assembled `/forecasts` requires `start_time` and
  `end_time` epoch values aligned to the requested `interval`; half-hour Airflow
  schedules need explicit alignment before calling the API.
