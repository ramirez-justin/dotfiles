# Calendar Security Design

## Goal

Eliminate shell command injection from calendar event data, harden the Google
OAuth callback against interception and request forgery, and ensure calendar
credentials are never created with permissive filesystem modes.

## Scope

This change covers:

- `tmux/.config/tmux/scripts/cal.sh`
- `tmux/.config/tmux/scripts/cal-setup.sh`
- A new standard-library Python OAuth callback helper
- Automated OAuth and shell regression tests

Credential-bearing package pinning, Neovim dependency locking, general
bootstrap pinning, and repository-wide security automation are separate
follow-up changes.

## Architecture

### OAuth callback helper

Add `tmux/.config/tmux/scripts/calendar_oauth.py`. It will use only the Python
standard library and will:

1. Bind an HTTP server exclusively to `127.0.0.1` on an ephemeral port.
2. Generate a cryptographically random OAuth `state` value.
3. Generate a PKCE verifier and its SHA-256 challenge.
4. Construct and open the Google authorization URL.
5. Accept one callback within a bounded timeout.
6. Validate the callback path, `state`, authorization code, and OAuth errors.
7. Print one JSON object containing the code, redirect URI, and verifier.

The helper will never print tokens, client secrets, raw HTTP requests, or raw
OAuth responses.

### Shell setup flow

`cal-setup.sh` will continue to parse the Google client credential file and
exchange the authorization code for tokens. It will invoke the Python helper,
validate every returned JSON field, and include the PKCE verifier in the token
request.

The shell script will set `umask 077` before creating files. It will write
credentials to a mode-600 temporary file in the destination directory, validate
the rendered JSON, and atomically rename the file into place.

### Calendar popup flow

`cal.sh` will treat event titles, descriptions, and attendee addresses only as
data. When a popup is needed, it will:

1. Set `umask 077`.
2. Create a temporary file.
3. Write the complete popup text with `printf`.
4. Pass the generated filename through a tmux popup environment variable.
5. Execute a fixed popup command that reads and removes that file.

No calendar-controlled value will be interpolated into a shell command.
Credential refreshes will use the same atomic mode-600 write pattern as setup.

## Data Flow

1. `cal-setup.sh` reads the client ID and client secret locally.
2. `calendar_oauth.py` starts its loopback listener and opens the browser.
3. Google redirects the browser to the loopback callback.
4. The helper validates the callback and returns structured JSON to Bash.
5. Bash exchanges the code and PKCE verifier for tokens.
6. Bash atomically writes the resulting credential document with mode `0600`.
7. `cal.sh` reads credentials, refreshes them when needed, and queries Google.
8. Event display data is written to a protected temporary file for the popup.

## Error Handling

The OAuth helper will reject:

- Requests to an unexpected path
- Missing or mismatched `state`
- Missing authorization codes
- OAuth error responses
- Callback timeouts

Failures will produce concise diagnostics without sensitive values. The setup
script will reject malformed helper output and malformed token responses.
Temporary files will be removed on failure, and an incomplete write will never
replace a valid credential file.

The tmux status script will continue to degrade to its existing setup or free
status indicators when authorization or API calls fail.

## Testing

### Python unit tests

Tests will verify:

- `state` values are random and URL-safe.
- PKCE challenges match their verifiers.
- Valid callbacks return the expected authorization code.
- Wrong state, wrong path, missing code, and OAuth errors are rejected.
- The callback server binds only to `127.0.0.1`.

### Shell regression tests

Tests will verify:

- Apostrophes, command substitutions, backticks, semicolons, and newlines remain
  file content and never enter the popup command.
- Credential and popup files are created with mode `0600`.
- Failed credential writes do not replace valid credentials.
- Raw token responses are not printed on error.

### Static verification

- `bash -n` passes for both shell scripts.
- ShellCheck passes for modified shell code.
- Python unit tests pass.
- Trivy reports no committed secrets.

## Acceptance Criteria

- Calendar-controlled fields cannot alter the popup command.
- OAuth callbacks are loopback-only and protected by `state` and PKCE.
- The callback listener uses an ephemeral port and bounded timeout.
- Sensitive files are never created with group or world permissions.
- No authorization code, token, or client secret is logged.
- Existing tmux status behavior remains unchanged outside secured flows.
