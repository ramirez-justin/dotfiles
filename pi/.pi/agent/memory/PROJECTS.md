# Project Memory

Stable project facts and caveats that may help future Pi sessions.

## Rules

- Do not store secrets, internal credentials, or copied private config.
- Store only facts that are likely to remain useful across sessions.
- Audit existing project facts before appending new ones.
- Remove or update stale facts when projects change.
- Prefer compact summaries over long project histories.

## Dotfiles

- The dotfiles repository uses GNU Stow topic directories.
- The `pi/` topic maps to `~/.pi/agent`.
- `mise.toml` is the task runner entry point for setup and verification.
- Pi package settings live in `pi/.pi/agent/settings.json`.
- For gametime Pi memory, use SOFIA-inspired markdown files rather than
  database or cloud memory infrastructure.
- Do not manage this repo. draft a message to mlplatform.

## Snowflake Objects

- Keep `CLAUDE.md` and `AGENTS.md` synchronized in this repo.
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
- Avoid hard-coded season/date windows in notebooks when a calendar source or
  runtime parameter can define the valid window.

## Gametime Data Review Lessons

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
- In `gametime-data`, Assembled `/forecasts` requires `start_time` and
  `end_time` epoch values aligned to the requested `interval`; half-hour Airflow
  schedules need explicit alignment before calling the API.
