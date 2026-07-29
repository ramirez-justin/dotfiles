# Project Memory: Snowflake Objects

Stable facts for `github.com/gametimesf/snowflake-objects`.

## Rules

- Do not store secrets, credentials, transient state, or unverified
  guesses.
- Keep facts stable, actionable, and specific to this repository.
- Audit existing facts before adding or changing entries.

## Facts

- In `snowflake-objects`, keep `CLAUDE.md` as canonical repo guidance;
  `AGENTS.md` should only point agents to `CLAUDE.md`.
- Keep tool versions aligned across `uv.lock`, CI commands, and pre-commit
  hooks; Ruff version drift can make local hooks and CI disagree.
- For repo CLIs, validate path arguments before filesystem traversal so missing
  paths or file-vs-directory mistakes fail cleanly.
- Snowflake read-only SQL guards should reject multi-statement SQL, not only
  validate the first verb; preserve semicolons inside string literals.
- Use fully qualified Python module paths in runbooks, for example
  `notebooks.tools.deploy_notebook`, so commands work from the repo root.
- Notebook validation should fail closed: require valid UTF-8 for files scanned
  for secrets, cover common private-key headers, and reject personal dev schema
  references such as `DEV_DB.<user_name>` in production notebook projects.
- Production source objects for notebook projects belong in `dbt-analytics`
  under the `predictive_analytics` schema/directory; do not add repo-local SQL
  for notebook CI to deploy production views.
- Notebook output defaults should be role-aware: `ANALYST_FULL` writes to the
  shared dev schema, `DATA_TRANSFORMATION` writes to production, and explicit
  `--output-*` arguments override role defaults.
- Airflow notebook runs use `EXECUTE NOTEBOOK PROJECT` with metadata-declared
  runtime, compute pool, query warehouse, and role; they do not reuse a user's
  interactive Snowsight notebook service.
- Omit a notebook project's `requirements_file` when its selected Snowflake
  runtime already bundles every dependency. Check the official Container
  Runtime release inventory first and use `pip list` for the exact patch image;
  unnecessary installation can fail before the first headless cell.
- Headless Notebook Project kernels can remain in `/filesystem`. Resolve
  project-local imports from `JUPYTER_WORK_DIR` and
  `SNOWFLAKE_MAIN_FILE_PATH`, using `Path.cwd()` only as an interactive
  fallback.
- Generated `NB_NON_INTERACTIVE_*` service logs are transient, best-effort
  failure diagnostics. Durable notebook telemetry belongs in Snowflake's event
  table, and notebook code cannot record failures that occur before its first
  cell.
- In `snowflake-objects`, notebook `notebook.yml` Airflow metadata is the source
  of truth for `gametime-data/airflow/dags/config/snowflake_notebooks.yml`;
  merging `snowflake-objects` main can auto-push that generated manifest to
  `gametime-data`, so plan cross-repo PR ordering to avoid duplicate diffs.
- Avoid hard-coded season/date windows in notebooks when a calendar source or
  runtime parameter can define the valid window.
