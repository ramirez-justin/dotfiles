---
name: cortex-code
description: >-
  Use when the user asks to inspect, query, modify, or administer Snowflake
  objects with Cortex Code, including warehouses, databases, schemas, tables,
  dynamic tables, governance, Cortex, or Snowflake SQL.
---

# Cortex Code

Use Snowflake Cortex Code CLI for Snowflake tasks when the user wants the
Snowflake AI Kit / Cortex Code workflow rather than direct SnowSQL.

## Preconditions

Before using Cortex Code, verify the local CLI is available:

```sh
which cortex && cortex --version
```

If Cortex Code or the Snowflake AI Kit scripts are missing, use the dotfiles
automation instead of asking the user to remember manual install steps:

```sh
cd ~/Repositories/dotfiles
mise run snowflake-ai-kit-install
```

The Snowflake AI Kit checkout is expected at one of:

- `$SNOWFLAKE_AI_KIT_ROOT`
- `~/.local/share/snowflake-ai-kit`

Cortex Code also needs a configured Snowflake CLI connection:

```sh
snow connection test -c default
```

Do not print secrets, private keys, passphrases, decrypted values, or raw
credential files.

## Preferred Pi tool

Prefer the `cortex_run` tool when it is available.

Use `envelope: "RO"` for read-only requests:

- `select`
- `show`
- `describe` / `desc`
- `explain`
- metadata inspection
- query-performance investigation

Use `envelope: "RW"` only after explicit user approval for mutations:

- `insert`, `update`, `delete`, `merge`, `copy into`
- `create`, `alter`, `drop`, `truncate`, `rename`
- `grant`, `revoke`, role/user/security changes
- warehouse resize/suspend/resume
- task, pipe, stream, dynamic table changes

For follow-up Snowflake questions, set `resumeLast: true` so Cortex keeps prior
context.

## Fallback command

If the tool is unavailable, run the Snowflake AI Kit wrapper directly:

```sh
python3 -u "$SNOWFLAKE_AI_KIT_ROOT/plugins/cortex-code/scripts/router/execute_cortex.py" \
  --prompt "<USER_PROMPT>" \
  --envelope RO \
  --codex
```

Add `--resume-last` for follow-up prompts. Use `--envelope RW` only after
explicit approval.

## Safety

- Ask before running Cortex with a write envelope.
- Prefer narrow, read-only queries and summaries over broad data dumps.
- If a request could mutate production data or configuration, preview the intent
  and ask for confirmation first.
- If `cortex`, `snow`, or the AI Kit scripts are missing, explain the missing
  prerequisite instead of guessing.
