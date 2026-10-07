---
name: snowflake-external-table-manual-sync
description: >-
  Use when Terraform or another IaC tool changes Snowflake external table
  columns but provider lifecycle settings ignore those details, requiring a
  manual Snowflake sync that preserves column order, grants, and refresh
  behavior.
---

# Snowflake External Table Manual Sync

Use this skill when an infrastructure-as-code change updates Snowflake external
table columns, but the provider ignores external table details during apply.
This can happen when the external table resource uses a lifecycle rule such as
`ignore_changes = all` because provider import/read behavior is incomplete.

The goal is to make the live Snowflake external table match the IaC definition,
including column cardinality, ordinal position, expressions, partition columns,
location, file format, refresh behavior, comments, and grants.

## Preconditions

- Read the applicable repository instructions and team runbook before making
  changes.
- Use read-only Snowflake metadata checks before any mutation.
- Treat `CREATE OR REPLACE EXTERNAL TABLE`, `ALTER EXTERNAL TABLE`, grants, and
  refreshes as production-impacting mutations unless team policy says
  otherwise.
- Get explicit approval from the user or change owner for the exact write plan
  before running mutating SQL.
- Do not query row data unless data validation is explicitly requested.
- Do not expose secrets, private keys, tokens, or credential material.

## Workflow

1. Inspect the IaC diff and identify each changed external table.
2. Read the external table module or resource implementation.
   - Confirm whether table details are ignored during apply, for example
     `ignore_changes = all`.
   - Confirm how column expressions are rendered. Some modules wrap expressions
     with a final type cast such as `(<expression>::<type>)`; do not double-cast
     unless the live DDL requires it.
3. Extract the expected IaC column list for each changed table.
   - Count explicitly declared external table columns.
   - Add Snowflake's implicit `VALUE` column when comparing to live metadata.
   - Record expected ordinal positions, especially near new columns, partition
     columns, and filename/path metadata columns.
4. Run read-only Snowflake metadata checks:
   - `SELECT CURRENT_ROLE(), CURRENT_WAREHOUSE(), CURRENT_DATABASE(),
     CURRENT_SCHEMA();`
   - `SHOW TABLES LIKE '<table_name>' IN <database>.<schema>;`
   - `SHOW GRANTS ON TABLE <fully_qualified_table_name>;`
   - `DESCRIBE TABLE <fully_qualified_table_name>;`
   - `SELECT GET_DDL('TABLE', '<fully_qualified_table_name>');`
5. Compare live metadata to the IaC definition:
   - total column count, including implicit `VALUE`
   - ordinal positions
   - data types
   - virtual column expressions
   - partition columns
   - external stage location
   - file format
   - refresh settings
   - comments
   - grants and owning role
6. Do not use `ALTER TABLE ... ADD COLUMN` when the IaC definition requires new
   columns before existing trailing columns. Snowflake appends added columns,
   which can leave live ordinal positions mismatched with the desired
   definition.
7. If order must match IaC, prepare full replacement DDL:
   - `USE ROLE <owning_or_authorized_role>;`
   - `CREATE OR REPLACE EXTERNAL TABLE <fully_qualified_table_name> (...)`
   - full column list in IaC order
   - `PARTITION BY (...)`
   - same `LOCATION`
   - same refresh behavior, such as `REFRESH_ON_CREATE=false`
   - same `FILE_FORMAT`
   - `COPY GRANTS`
   - same `COMMENT`
8. Present the exact DDL plan and wait for explicit approval before running it.
9. After approval, execute the DDL with the owning or otherwise authorized role.
10. Refresh external table metadata when appropriate:
    - `ALTER EXTERNAL TABLE <fully_qualified_table_name> REFRESH;`
11. Verify after the change:
    - `DESCRIBE TABLE <fully_qualified_table_name>;`
    - `INFORMATION_SCHEMA.COLUMNS` for ordinal positions and total count
    - `SHOW GRANTS ON TABLE <fully_qualified_table_name>;`
    - new columns appear in the expected IaC order
    - grants survived via `COPY GRANTS`
12. Report concise evidence:
    - tables changed
    - expected vs actual total columns
    - key ordinals around the changed columns
    - refresh result
    - grants preserved or any missing grants
    - errors verbatim, if any

## DDL Template

```sql
USE ROLE <owning_or_authorized_role>;

CREATE OR REPLACE EXTERNAL TABLE <database>.<schema>.<table_name>(
  <column_name> <type> AS (<expression>),
  ...
)
PARTITION BY (<partition_column>)
LOCATION=@<database>.<schema>.<stage>/<path>/
REFRESH_ON_CREATE=false
FILE_FORMAT=<database>.<schema>.<file_format>
COPY GRANTS
COMMENT='<existing_comment>';

ALTER EXTERNAL TABLE <database>.<schema>.<table_name> REFRESH;
```

## Verification Queries

```sql
DESCRIBE TABLE <database>.<schema>.<table_name>;

SELECT
  ordinal_position,
  column_name,
  data_type
FROM <database>.INFORMATION_SCHEMA.COLUMNS
WHERE table_catalog = '<database>'
  AND table_schema = '<schema>'
  AND table_name = '<table_name>'
ORDER BY ordinal_position;

SHOW GRANTS ON TABLE <database>.<schema>.<table_name>;
```

## Safety Notes

- Prefer metadata-only validation unless row-level validation is requested.
- Use `COPY GRANTS` unless there is a verified reason not to.
- If grants are not preserved, stop and ask before manually regranting.
- If the table has auto-refresh, notification integrations, masking policies,
  row access policies, tags, or contact metadata, include those properties in
  the replacement DDL or stop and ask for review.
- If the live `GET_DDL` differs from the IaC definition in unrelated ways, call
  out the drift before changing anything.
