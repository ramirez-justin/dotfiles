---
name: snowflake
description: >-
  Use when querying Snowflake, troubleshooting warehouse data, using SnowSQL,
  checking Snowflake roles/grants, or accessing Gametime Snowflake with Justin's
  local key-pair setup.
---

# Snowflake

Use SnowSQL with Justin's existing local connection configuration. Do not ask
user to re-describe the private key workflow unless a command fails and
configuration needs debugging.

## Preferred connection

Prefer the configured SnowSQL connection:

```sh
snowsql -c okta_conn \
  -q "select current_user(), current_role(), current_warehouse();"
```

The connection is defined in `~/.snowsql/config`. It already includes Justin's
Snowflake username, authenticator, private key path, and output formatting.
Do not print or copy private-key material, passphrases, passwords, 1Password
values, or decrypted secrets.

If the named connection is unavailable, the known direct production pattern is:

```sh
snowsql -a gametime-prod -u JUSTIN_RAMIREZ \
  --private-key-path ~/.ssh/snowflake_production.p8
```

SnowSQL may prompt for the encrypted private key passphrase. Do not ask the user
to paste the passphrase into chat.

## Query workflow

For read-only troubleshooting, run focused queries with `snowsql -c okta_conn
-q "..."`. Prefer small result sets and add `limit` where appropriate.

Read-only operations are OK without extra approval:

- `select`
- `show`
- `describe` / `desc`
- `explain`
- `with ... select`

For anything that mutates data, schema, security, warehouses, tasks, pipes, or
streams, preview the exact SQL and ask for explicit approval before running it.
This includes:

- `insert`, `update`, `delete`, `merge`, `copy into`
- `create`, `alter`, `drop`, `truncate`, `rename`
- `grant`, `revoke`, `use role`, role/user changes
- warehouse suspend/resume/resize and task changes

## Safety rules

- Never reveal secrets or private key contents in responses or command output.
- Do not decrypt SOPS or 1Password values unless the user asked for that
  specific operation.
- Do not write query results containing sensitive customer data to disk unless
  explicitly requested.
- Prefer aggregate/count/sample queries over broad table dumps.
- Use `limit` for exploratory queries.
- When unsure whether a statement is safe, treat it as mutating and ask first.

## Useful checks

```sh
snowsql -c okta_conn -q "select current_user(), current_role();"
snowsql -c okta_conn -q "select current_database(), current_schema();"
snowsql -c okta_conn -q "select current_warehouse();"
snowsql -c okta_conn -q "show roles;"
snowsql -c okta_conn -q "show warehouses;"
snowsql -c okta_conn -q "show databases;"
```
