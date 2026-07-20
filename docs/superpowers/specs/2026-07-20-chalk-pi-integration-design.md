# Chalk Pi Integration Design

## Context

Pi needs access to Chalk through Chalk's hosted MCP server. Chalk advertises a
generic OAuth flow, but its authorization endpoint currently rejects Pi's
localhost callback and only permits Claude's callback. The user cannot create a
service token but can authenticate as a developer through Google SSO.

The dotfiles `gametime` branch is work-only. It should manage the Chalk CLI and
install it during bootstrap.

## Goals

- Install and update the Chalk CLI through the dotfiles workflow.
- Authenticate with the user's personal Chalk developer identity.
- Connect Pi to Chalk without committing or printing credentials.
- Keep the MCP server lazy and avoid adding its tools to every prompt.
- Provide clear setup, failure, and verification instructions.

## Non-goals

- Create or manage Chalk service tokens.
- Implement another OAuth client or remote MCP server.
- Store Chalk credentials in 1Password or tracked files.
- Grant permissions beyond the user's existing Chalk access.

## Approach

Use Chalk's official installer from a dedicated mise task. Add the task to
`bootstrap`, matching the repository's precedent for tools that are not
available through its normal package managers.

Use `chalk login` once after installation. Chalk opens its dashboard in the
browser, where the user signs in with Google SSO. The CLI persists personal
credentials in `~/.config/chalk.yml`, outside the dotfiles repository.

Replace Pi's incompatible direct OAuth configuration with a lazy local STDIO
bridge. The bridge reads credentials from `chalk config --format json` and
passes them as headers to Chalk's hosted MCP endpoint through `mcp-remote`.

## Components

### Managed Chalk CLI installation

Add a `chalk-install` task to `mise.toml` that:

1. Sets `CHALK_INSTALL` to `${HOME}/.chalk` unless already overridden.
2. Prepends `${CHALK_INSTALL}/bin` to `PATH` before installation.
3. Runs Chalk's official installer with `CHALK_VERSION`, defaulting to
   `latest`.
4. Verifies the installed executable with `chalk version`.

Prepending the target directory before installation prevents Chalk's installer
from appending unmanaged lines to the stowed `.zshrc` after it creates the
binary.

Add `chalk-install` to the `bootstrap` dependencies. Re-running bootstrap may
upgrade Chalk to the latest version unless `CHALK_VERSION` is explicitly set.

### Managed shell environment

Add these values to the stowed shell configuration:

```sh
export CHALK_INSTALL="$HOME/.chalk"
export PATH="$CHALK_INSTALL/bin:$PATH"
```

The shell configuration owns PATH setup; Chalk's installer must not modify it.

### Authentication

Run `chalk login` interactively after the first bootstrap. Authentication state
remains in Chalk's local configuration and is never committed.

The integration uses the personal CLI credentials created by `chalk login`.
Chalk therefore applies the user's existing permissions and environment access.

### Pi MCP bridge

Configure the `chalk` server in `pi/.pi/agent/mcp.json` as an STDIO command.
The command will:

1. Confirm that the Chalk CLI is installed and authenticated.
2. Read `clientId`, `clientSecret`, and `apiServer` from
   `chalk config --format json`.
3. Validate the required values without printing them.
4. Start a pinned `mcp-remote` release against
   `${apiServer}/v1/mcp/sse`.
5. Pass the credentials in `X-Chalk-Client-Id` and
   `X-Chalk-Client-Secret` headers.

The implementation will pin the current published `mcp-remote` release when the
change is made. The server remains lazy and proxy-only, preserving Pi's context
window.

## Data Flow

1. Bootstrap installs or updates the Chalk CLI.
2. The user completes `chalk login` through Google SSO once.
3. Pi starts without connecting to Chalk.
4. A Chalk tool request lazily starts the STDIO bridge.
5. The bridge reads local Chalk credentials and starts `mcp-remote`.
6. `mcp-remote` connects to Chalk's hosted MCP endpoint with credential
   headers.
7. Chalk authorizes each MCP operation using the developer's permissions.

## Error Handling

- Missing CLI: tell the user to run `mise run chalk-install`.
- Missing login: tell the user to run `chalk login`.
- Malformed config: stop before starting `mcp-remote` and identify the missing
  field without displaying values.
- Authentication rejection: preserve Chalk's status and error message.
- Missing bridge package: fail with the pinned package invocation error rather
  than silently changing versions.

## Security

- Never print `chalk config` output.
- Never place credentials in `mcp.json`, shell configuration, mise files, or
  documentation.
- Keep `~/.config/chalk.yml` outside Stow and Git.
- Use the user's existing Chalk permissions; do not attempt privilege
  escalation.
- Keep Chalk tools behind Pi's MCP proxy and retain preview-before-mutation
  behavior for operations that may change Chalk resources.

## Documentation

Update `README.md` to document:

- Chalk installation as part of `mise run bootstrap`.
- The one-time `chalk login` step.
- The `mise run chalk-install` update command.
- Pi authentication troubleshooting.

## Verification

1. Parse `mise.toml` and `pi/.pi/agent/mcp.json` successfully.
2. Run formatting and static checks for changed shell configuration.
3. Run `mise run chalk-install` and confirm `chalk version` succeeds.
4. Confirm the installer did not modify `.zshrc` outside the intended edit.
5. Complete `chalk login` interactively.
6. Confirm `chalk config --format json` has required fields without printing
   their values.
7. Connect the Chalk MCP server from Pi.
8. Execute a read-only metadata discovery call.
9. Run the dotfiles doctor task.

## Success Criteria

A fresh work machine can run bootstrap, complete one browser login, restart Pi,
and query authorized Chalk metadata without manually installing tools or
copying credentials into configuration files.
