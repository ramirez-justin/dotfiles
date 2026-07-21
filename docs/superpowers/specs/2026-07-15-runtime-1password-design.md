# Runtime 1Password Secret Resolution Design

## Goal

Eliminate persisted plaintext agent credentials by resolving Jira and Fivetran
secrets from 1Password only when the relevant process starts.

## Scope

This change covers the Claude launcher, Pi Jira MCP launcher, shared Zsh
configuration, bootstrap documentation, and deletion of two legacy generated
secret files.

It does not change package pinning or update behavior. Linear, Notion, and Gmail
continue to use their existing OAuth integrations.

## Architecture

### Reference-only environment file

Add `pi/.pi/agent/agent-secrets.env` with only 1Password references for:

- `JIRA_API_TOKEN`
- `FIVETRAN_API_KEY`
- `FIVETRAN_API_SECRET`

The file contains no resolved values and is linked to
`~/.pi/agent/agent-secrets.env` by the existing Stow workflow.

### Claude runtime environment

Define a `claude()` Zsh function that locates the real Claude executable with
`whence -p claude` and executes it through:

```zsh
op run --env-file="$HOME/.pi/agent/agent-secrets.env" -- "$claude_bin" "$@"
```

The wrapper preserves all arguments. If the reference file, 1Password CLI, or
Claude executable is missing, it exits nonzero before launching Claude. It does
not echo secrets.

The existing Claude planner sources `.zshrc`, so its interactive process uses
the same runtime secret resolution.

### Pi MCP environment

Change the lazy Jira MCP command to resolve only its token at MCP startup:

```sh
JIRA_API_TOKEN=$(op read 'op://Employee/JRamirez Atlassian API Token/API token')
export JIRA_API_TOKEN
exec uvx mcp-atlassian --transport stdio
```

Pi itself does not receive Jira, Fivetran, Linear, or Notion API variables.

### Legacy files and bootstrap

Remove `mise run inject-secrets` from bootstrap and remove its task. Stop
sourcing `~/.pi/agent/env.local.zsh`. Remove empty Claude secret keys so they do
not override the runtime environment.

After the new paths are linked and verified, delete exactly these generated
legacy files:

- `~/.claude/settings.local.json`
- `~/.pi/agent/env.local.zsh`

Their inspected content consists only of generated secret values.

## Data Flow

1. Stow links the reference-only environment file.
2. Running `claude` invokes `op run`, which resolves the three references into
   the Claude child process environment.
3. Starting the lazy Jira MCP uses `op read` to resolve its Jira token into the
   MCP child process environment.
4. Fivetran values never enter Pi or the interactive shell environment.

## Failure Handling

- The Claude wrapper fails closed if required prerequisites are unavailable.
- A locked or unavailable 1Password CLI prevents launch rather than launching
  Claude without the expected credentials.
- Jira MCP startup fails if the token cannot be resolved.
- No command prints secret values or passes resolved secrets as arguments.
- Migration only removes the two named legacy files after successful checks.

## Testing

Tests will use local stub executables to verify that the Claude wrapper invokes
`op run`, uses the reference file, preserves arguments, and fails closed.

Tests will validate that the tracked environment file contains only approved
`op://` references, that the Jira MCP command resolves its token lazily, and
that legacy plaintext injection/sourcing are absent.

Verification includes Zsh syntax, ShellCheck, JSON parsing, Pi extension tests,
Trivy secret scanning, and a post-link migration check without exposing secret
values.

## Acceptance Criteria

- No generated plaintext agent secret files remain after migration.
- Claude receives Jira and Fivetran values only through `op run`.
- Jira MCP resolves only its own token on lazy startup.
- Pi and the interactive shell do not inherit Fivetran or Jira secrets.
- Existing OAuth-based MCP integrations continue unchanged.
- The repository contains only 1Password references, never resolved secrets.
