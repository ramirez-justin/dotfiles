# Calendar Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent calendar-controlled command execution, protect the OAuth
loopback flow with state and PKCE, and create all credential files securely.

**Architecture:** A standard-library Python helper owns the loopback OAuth
callback and returns validated structured data to the existing setup script. A
small shell library owns protected temporary files, atomic JSON writes, and the
fixed tmux popup command so those behaviors can be tested independently.

**Tech Stack:** Bash, Python 3.12 standard library, `unittest`, jq, tmux,
ShellCheck, Trivy

---

### Task 1: Add failing popup and atomic-write regression tests

**Files:**
- Create: `tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh`
- Test: `tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh`

- [ ] **Step 1: Write the failing shell test**

Create an executable test that sources the not-yet-created helper library,
stubs `tmux`, and asserts that malicious event data stays out of command
arguments:

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../calendar-helpers.sh
source "$SCRIPT_DIR/calendar-helpers.sh"

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
export TMPDIR="$TEST_DIR"
export TMUX_CAPTURE="$TEST_DIR/tmux-args"
mkdir -p "$TEST_DIR/bin"
cat >"$TEST_DIR/bin/tmux" <<'STUB'
#!/bin/bash
printf '%s\n' "$@" >"$TMUX_CAPTURE"
STUB
chmod +x "$TEST_DIR/bin/tmux"
PATH="$TEST_DIR/bin:$PATH"

marker="$TEST_DIR/injected"
payload="quote ' ; touch $marker ; \$(touch $marker) ; \`touch $marker\`
second line"
calendar_show_popup "$payload"

[[ ! -e "$marker" ]]
! grep -F "$payload" "$TMUX_CAPTURE"
popup_setting=$(grep '^CALENDAR_POPUP_FILE=' "$TMUX_CAPTURE")
popup_file=${popup_setting#CALENDAR_POPUP_FILE=}
[[ -f "$popup_file" ]]
[[ "$(stat -f %Lp "$popup_file")" == "600" ]]
[[ "$(cat "$popup_file")" == "$payload" ]]
rm -f "$popup_file"

credentials="$TEST_DIR/credentials.json"
printf '%s\n' '{"valid":true}' >"$credentials"
chmod 600 "$credentials"
if printf '%s\n' 'not-json' | calendar_atomic_json_write "$credentials"; then
    echo "invalid JSON unexpectedly succeeded" >&2
    exit 1
fi
[[ "$(cat "$credentials")" == '{"valid":true}' ]]

printf '%s\n' '{"token":"safe"}' |
    calendar_atomic_json_write "$credentials"
[[ "$(stat -f %Lp "$credentials")" == "600" ]]
jq -e '.token == "safe"' "$credentials" >/dev/null
```

- [ ] **Step 2: Make the test executable**

Run:

```bash
chmod +x tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh
```

Expected: FAIL because `calendar-helpers.sh` does not exist.

- [ ] **Step 4: Commit the failing regression test**

```bash
git add tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh
git commit -m "test(tmux): reproduce calendar shell injection" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 2: Implement protected popup and atomic JSON helpers

**Files:**
- Create: `tmux/.config/tmux/scripts/calendar-helpers.sh`
- Test: `tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh`

- [ ] **Step 1: Add the minimal helper implementation**

```bash
#!/bin/bash

calendar_atomic_json_write() {
    local destination=$1
    local temporary

    temporary=$(mktemp "${destination}.tmp.XXXXXX") || return 1
    chmod 600 "$temporary"

    if ! cat >"$temporary" || ! jq -e . "$temporary" >/dev/null; then
        rm -f -- "$temporary"
        return 1
    fi

    if ! mv -f -- "$temporary" "$destination"; then
        rm -f -- "$temporary"
        return 1
    fi
    chmod 600 "$destination"
}

calendar_show_popup() {
    local popup_text=$1
    local popup_file
    local popup_command

    popup_file=$(mktemp "${TMPDIR:-/tmp}/dotfiles-calendar-popup.XXXXXX") ||
        return 1
    chmod 600 "$popup_file"
    if ! printf '%s\n' "$popup_text" >"$popup_file"; then
        rm -f -- "$popup_file"
        return 1
    fi

    popup_command='less -- "$CALENDAR_POPUP_FILE"; status=$?; '
    popup_command+='rm -f -- "$CALENDAR_POPUP_FILE"; exit $status'
    if ! tmux display-popup -w50% -h50% -T "Upcoming Meeting" \
        -e "CALENDAR_POPUP_FILE=$popup_file" \
        -E "$popup_command"; then
        rm -f -- "$popup_file"
        return 1
    fi
}
```

- [ ] **Step 2: Run the helper regression test and verify GREEN**

Run:

```bash
tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh
```

Expected: PASS with exit code 0 and no output.

- [ ] **Step 3: Run shell syntax and static checks**

Run:

```bash
bash -n tmux/.config/tmux/scripts/calendar-helpers.sh \
  tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh
shellcheck tmux/.config/tmux/scripts/calendar-helpers.sh \
  tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh
```

Expected: both commands exit 0.

- [ ] **Step 4: Commit the helper implementation**

```bash
git add tmux/.config/tmux/scripts/calendar-helpers.sh
git commit -m "fix(tmux): isolate calendar popup data" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 3: Use secure helpers in the calendar status script

**Files:**
- Modify: `tmux/.config/tmux/scripts/cal.sh:1-50,123-129`
- Test: `tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh`

- [ ] **Step 1: Source the helper and restrict created files**

Immediately after resolving `SCRIPT_DIR`, add:

```bash
umask 077
# shellcheck source=calendar-helpers.sh
source "$SCRIPT_DIR/calendar-helpers.sh"
```

- [ ] **Step 2: Replace credential refresh writes**

Replace the direct temporary-file redirection and rename with:

```bash
UPDATED_CREDENTIALS=$(
    jq --arg at "$ACCESS_TOKEN" --argjson exp "$NEW_EXPIRY" \
        '.access_token = $at | .expiry = $exp' "$CREDENTIALS_FILE"
)
printf '%s\n' "$UPDATED_CREDENTIALS" |
    calendar_atomic_json_write "$CREDENTIALS_FILE"
```

- [ ] **Step 3: Replace the vulnerable popup command**

Keep the existing `POPUP_TEXT` construction and replace the tmux command with:

```bash
calendar_show_popup "$POPUP_TEXT" &>/dev/null &
```

- [ ] **Step 4: Remove unsafe command substitution around Python**

Replace the unquoted here-string command substitution with:

```bash
read -r EVENT_EPOCH EVENT_TIME < <(
    python3 - "$EVENT_START" <<'PY'
from datetime import datetime
import sys

dt = datetime.fromisoformat(sys.argv[1])
print(int(dt.timestamp()), dt.astimezone().strftime("%H:%M"))
PY
)
```

- [ ] **Step 5: Run tests and static checks**

Run:

```bash
tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh
bash -n tmux/.config/tmux/scripts/cal.sh
shellcheck tmux/.config/tmux/scripts/cal.sh
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the status-script fix**

```bash
git add tmux/.config/tmux/scripts/cal.sh
git commit -m "fix(tmux): prevent calendar event command injection" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 4: Add failing OAuth helper unit tests

**Files:**
- Create: `tmux/.config/tmux/scripts/tests/test_calendar_oauth.py`
- Test: `tmux/.config/tmux/scripts/tests/test_calendar_oauth.py`

- [ ] **Step 1: Write tests for state, PKCE, and callback validation**

```python
import base64
import hashlib
import importlib.util
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).parents[1] / "calendar_oauth.py"
spec = importlib.util.spec_from_file_location("calendar_oauth", MODULE_PATH)
calendar_oauth = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(calendar_oauth)


class OAuthSecurityTests(unittest.TestCase):
    def test_state_is_random_and_url_safe(self):
        first = calendar_oauth.generate_state()
        second = calendar_oauth.generate_state()
        self.assertNotEqual(first, second)
        self.assertRegex(first, r"^[A-Za-z0-9_-]+$")

    def test_pkce_challenge_matches_verifier(self):
        verifier, challenge = calendar_oauth.generate_pkce()
        expected = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        self.assertEqual(challenge, expected)

    def test_valid_callback_returns_code(self):
        code = calendar_oauth.validate_callback(
            "/oauth/callback?code=abc123&state=expected", "expected"
        )
        self.assertEqual(code, "abc123")

    def test_wrong_state_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "state"):
            calendar_oauth.validate_callback(
                "/oauth/callback?code=abc123&state=wrong", "expected"
            )

    def test_wrong_path_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "path"):
            calendar_oauth.validate_callback(
                "/wrong?code=abc123&state=expected", "expected"
            )

    def test_missing_code_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "code"):
            calendar_oauth.validate_callback(
                "/oauth/callback?state=expected", "expected"
            )

    def test_oauth_error_is_rejected_without_description(self):
        with self.assertRaisesRegex(
            ValueError, "authorization failed"
        ) as caught:
            calendar_oauth.validate_callback(
                "/oauth/callback?error=access_denied&"
                "error_description=sensitive&state=expected",
                "expected",
            )
        self.assertNotIn("sensitive", str(caught.exception))

    def test_server_binds_only_to_loopback(self):
        server = calendar_oauth.create_callback_server("expected")
        try:
            self.assertEqual(server.server_address[0], "127.0.0.1")
            self.assertGreater(server.server_address[1], 0)
        finally:
            server.server_close()


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
python3 -m unittest discover \
  -s tmux/.config/tmux/scripts/tests \
  -p 'test_calendar_oauth.py' -v
```

Expected: ERROR because `calendar_oauth.py` does not exist.

- [ ] **Step 3: Commit the failing OAuth tests**

```bash
git add tmux/.config/tmux/scripts/tests/test_calendar_oauth.py
git commit -m "test(tmux): specify secure OAuth callback" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 5: Implement the OAuth callback helper

**Files:**
- Create: `tmux/.config/tmux/scripts/calendar_oauth.py`
- Test: `tmux/.config/tmux/scripts/tests/test_calendar_oauth.py`

- [ ] **Step 1: Implement the complete OAuth helper**

Create the complete file:

```python
#!/usr/bin/env python3

import argparse
import base64
import hashlib
import http.server
import json
import secrets
import sys
import urllib.parse
import webbrowser


AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
CALLBACK_PATH = "/oauth/callback"


def generate_state() -> str:
    return secrets.token_urlsafe(32)


def generate_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest)
    return verifier, challenge.rstrip(b"=").decode("ascii")


def validate_callback(target: str, expected_state: str) -> str:
    parsed = urllib.parse.urlparse(target)
    if parsed.path != CALLBACK_PATH:
        raise ValueError("unexpected callback path")

    query = urllib.parse.parse_qs(parsed.query)
    states = query.get("state", [])
    if len(states) != 1 or not secrets.compare_digest(
        states[0], expected_state
    ):
        raise ValueError("invalid OAuth state")
    if query.get("error"):
        raise ValueError("authorization failed")

    codes = query.get("code", [])
    if len(codes) != 1 or not codes[0]:
        raise ValueError("authorization code missing")
    return codes[0]


class OAuthCallbackServer(http.server.HTTPServer):
    expected_state: str
    authorization_code: str | None
    callback_error: str | None


class OAuthCallbackHandler(http.server.BaseHTTPRequestHandler):
    server: OAuthCallbackServer

    def do_GET(self) -> None:
        try:
            code = validate_callback(self.path, self.server.expected_state)
        except ValueError as error:
            self.server.callback_error = str(error)
            self._respond(400, "Authorization failed. Return to the terminal.")
            return

        self.server.authorization_code = code
        self._respond(200, "Authorization complete. You may close this tab.")

    def _respond(self, status: int, message: str) -> None:
        body = message.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def create_callback_server(expected_state: str) -> OAuthCallbackServer:
    server = OAuthCallbackServer(
        ("127.0.0.1", 0), OAuthCallbackHandler
    )
    server.expected_state = expected_state
    server.authorization_code = None
    server.callback_error = None
    return server


def build_authorization_url(
    client_id: str,
    scope: str,
    redirect_uri: str,
    state: str,
    challenge: str,
) -> str:
    query = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": scope,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{AUTHORIZATION_ENDPOINT}?{query}"


def authorize(client_id: str, scope: str, timeout: int) -> dict[str, str]:
    state = generate_state()
    verifier, challenge = generate_pkce()
    server = create_callback_server(state)
    redirect_uri = (
        f"http://127.0.0.1:{server.server_address[1]}{CALLBACK_PATH}"
    )
    authorization_url = build_authorization_url(
        client_id, scope, redirect_uri, state, challenge
    )

    try:
        if not webbrowser.open(authorization_url):
            print(
                f"Open this URL to authorize the calendar: "
                f"{authorization_url}",
                file=sys.stderr,
            )
        server.timeout = timeout
        server.handle_request()
    finally:
        server.server_close()

    if server.callback_error:
        raise RuntimeError(server.callback_error)
    if not server.authorization_code:
        raise TimeoutError("authorization callback timed out")

    return {
        "code": server.authorization_code,
        "redirect_uri": redirect_uri,
        "code_verifier": verifier,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--client-id", required=True)
    parser.add_argument("--scope", required=True)
    parser.add_argument("--timeout", type=int, default=180)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = authorize(args.client_id, args.scope, args.timeout)
    except (OSError, RuntimeError, TimeoutError) as error:
        print(f"Calendar authorization failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Make the helper executable**

```bash
chmod +x tmux/.config/tmux/scripts/calendar_oauth.py
```

- [ ] **Step 3: Run the tests and verify GREEN**

Run:

```bash
python3 -m unittest discover \
  -s tmux/.config/tmux/scripts/tests \
  -p 'test_calendar_oauth.py' -v
python3 -m py_compile tmux/.config/tmux/scripts/calendar_oauth.py
```

Expected: eight tests pass; compilation exits 0.

- [ ] **Step 4: Commit the OAuth helper**

```bash
git add tmux/.config/tmux/scripts/calendar_oauth.py
git commit -m "feat(tmux): add protected OAuth callback" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 6: Add a failing setup integration test

**Files:**
- Create: `tmux/.config/tmux/scripts/tests/test-cal-setup.sh`
- Test: `tmux/.config/tmux/scripts/tests/test-cal-setup.sh`

- [ ] **Step 1: Write the integration test with local stubs**

Create an executable test that uses a temporary client file, a fake OAuth
helper, and a fake `curl` executable:

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/bin"

client_file="$TEST_DIR/client.json"
credentials_file="$TEST_DIR/credentials.json"
printf '%s\n' \
  '{"installed":{"client_id":"client","client_secret":"secret"}}' \
  >"$client_file"

cat >"$TEST_DIR/oauth-helper" <<'STUB'
#!/bin/bash
printf '%s\n' \
  '{"code":"auth-code","redirect_uri":'\
'"http://127.0.0.1:54321/oauth/callback",'\
'"code_verifier":"verifier"}'
STUB
chmod +x "$TEST_DIR/oauth-helper"

cat >"$TEST_DIR/bin/curl" <<'STUB'
#!/bin/bash
printf '%s\n' "$@" >"$CURL_CAPTURE"
printf '%s\n' \
  '{"access_token":"access","refresh_token":"refresh","expires_in":3600}'
STUB
chmod +x "$TEST_DIR/bin/curl"

export CLIENT_SECRET_FILE="$client_file"
export CREDENTIALS_FILE="$credentials_file"
export CALENDAR_OAUTH_HELPER="$TEST_DIR/oauth-helper"
export CURL_CAPTURE="$TEST_DIR/curl-args"
PATH="$TEST_DIR/bin:$PATH"

output=$("$SCRIPT_DIR/cal-setup.sh" 2>&1)
[[ "$output" != *"auth-code"* ]]
[[ "$output" != *"access"* ]]
[[ "$output" != *"refresh"* ]]
grep -Fx 'code_verifier=verifier' "$CURL_CAPTURE"
[[ "$(stat -f %Lp "$credentials_file")" == "600" ]]
jq -e '.access_token == "access" and .refresh_token == "refresh"' \
    "$credentials_file" >/dev/null
```

- [ ] **Step 2: Make the test executable**

```bash
chmod +x tmux/.config/tmux/scripts/tests/test-cal-setup.sh
```

- [ ] **Step 3: Run the integration test and verify RED**

Run:

```bash
tmux/.config/tmux/scripts/tests/test-cal-setup.sh
```

Expected: FAIL because `cal-setup.sh` does not yet honor the testable paths or
invoke the OAuth helper.

- [ ] **Step 4: Commit the failing integration test**

```bash
git add tmux/.config/tmux/scripts/tests/test-cal-setup.sh
git commit -m "test(tmux): cover secure calendar setup" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 7: Integrate state and PKCE into calendar setup

**Files:**
- Modify: `tmux/.config/tmux/scripts/cal-setup.sh:1-129`
- Test: `tmux/.config/tmux/scripts/tests/test-cal-setup.sh`

- [ ] **Step 1: Add secure defaults and helper sourcing**

Replace fixed file assignments and the fixed callback configuration with:

```bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_SECRET_FILE=${CLIENT_SECRET_FILE:-"$SCRIPT_DIR/.client-secret.json"}
CREDENTIALS_FILE=${CREDENTIALS_FILE:-"$SCRIPT_DIR/.credentials.json"}
CALENDAR_OAUTH_HELPER=${CALENDAR_OAUTH_HELPER:-"$SCRIPT_DIR/calendar_oauth.py"}
SCOPE="https://www.googleapis.com/auth/calendar.readonly"
umask 077
# shellcheck source=calendar-helpers.sh
source "$SCRIPT_DIR/calendar-helpers.sh"
```

Require `python3` alongside `curl` and `jq`.

- [ ] **Step 2: Replace the browser and netcat callback flow**

Add a testable helper runner and validate every returned field:

```bash
run_oauth_helper() {
    if [[ -x "$CALENDAR_OAUTH_HELPER" &&
        "$CALENDAR_OAUTH_HELPER" != *.py ]]; then
        "$CALENDAR_OAUTH_HELPER" \
            --client-id "$CLIENT_ID" \
            --scope "$SCOPE"
    else
        python3 "$CALENDAR_OAUTH_HELPER" \
            --client-id "$CLIENT_ID" \
            --scope "$SCOPE"
    fi
}

if ! OAUTH_RESULT=$(run_oauth_helper); then
    echo "Calendar authorization failed." >&2
    exit 1
fi
if ! AUTH_CODE=$(jq -er '.code' <<<"$OAUTH_RESULT") ||
    ! REDIRECT_URI=$(jq -er '.redirect_uri' <<<"$OAUTH_RESULT") ||
    ! CODE_VERIFIER=$(jq -er '.code_verifier' <<<"$OAUTH_RESULT"); then
    echo "Calendar authorization returned invalid data." >&2
    exit 1
fi
```

- [ ] **Step 3: Add PKCE to the token exchange**

Replace the exchange and token parsing with:

```bash
if ! TOKEN_RESPONSE=$(
    curl --silent --show-error --fail-with-body \
        -X POST "https://oauth2.googleapis.com/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "code=${AUTH_CODE}" \
        -d "client_id=${CLIENT_ID}" \
        -d "client_secret=${CLIENT_SECRET}" \
        -d "redirect_uri=${REDIRECT_URI}" \
        -d "code_verifier=${CODE_VERIFIER}" \
        -d "grant_type=authorization_code"
); then
    echo "Failed to exchange the calendar authorization code." >&2
    exit 1
fi

if ! ACCESS_TOKEN=$(jq -er '.access_token' <<<"$TOKEN_RESPONSE") ||
    ! REFRESH_TOKEN=$(jq -er '.refresh_token' <<<"$TOKEN_RESPONSE") ||
    ! EXPIRES_IN=$(jq -er '.expires_in | numbers' <<<"$TOKEN_RESPONSE"); then
    echo "Calendar token service returned invalid data." >&2
    exit 1
fi
EXPIRY=$(($(date +%s) + EXPIRES_IN))
```

Neither error branch may print `TOKEN_RESPONSE`.

- [ ] **Step 4: Write credentials atomically**

Construct credentials with `jq -n` and pipe them to the helper:

```bash
CREDENTIAL_JSON=$(
    jq -n \
        --arg access "$ACCESS_TOKEN" \
        --arg refresh "$REFRESH_TOKEN" \
        --argjson expiry "$EXPIRY" \
        --arg client_id "$CLIENT_ID" \
        --arg client_secret "$CLIENT_SECRET" \
        '{
            access_token: $access,
            refresh_token: $refresh,
            expiry: $expiry,
            client_id: $client_id,
            client_secret: $client_secret
        }'
)
printf '%s\n' "$CREDENTIAL_JSON" |
    calendar_atomic_json_write "$CREDENTIALS_FILE"
```

- [ ] **Step 5: Run the integration and regression tests**

Run:

```bash
tmux/.config/tmux/scripts/tests/test-cal-setup.sh
tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh
python3 -m unittest discover \
  -s tmux/.config/tmux/scripts/tests \
  -p 'test_calendar_oauth.py' -v
```

Expected: all tests pass.

- [ ] **Step 6: Run shell static checks**

Run:

```bash
bash -n tmux/.config/tmux/scripts/cal-setup.sh
shellcheck tmux/.config/tmux/scripts/cal-setup.sh
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the setup hardening**

```bash
git add tmux/.config/tmux/scripts/cal-setup.sh
git commit -m "fix(tmux): protect calendar OAuth setup" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 8: Verify the complete calendar hardening

**Files:**
- Verify: `tmux/.config/tmux/scripts/`

- [ ] **Step 1: Run all calendar tests**

```bash
tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh
tmux/.config/tmux/scripts/tests/test-cal-setup.sh
python3 -m unittest discover \
  -s tmux/.config/tmux/scripts/tests -v
```

Expected: all shell tests and eight Python tests pass.

- [ ] **Step 2: Run syntax and static analysis**

```bash
bash -n tmux/.config/tmux/scripts/cal.sh \
  tmux/.config/tmux/scripts/cal-setup.sh \
  tmux/.config/tmux/scripts/calendar-helpers.sh \
  tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh \
  tmux/.config/tmux/scripts/tests/test-cal-setup.sh
shellcheck tmux/.config/tmux/scripts/cal.sh \
  tmux/.config/tmux/scripts/cal-setup.sh \
  tmux/.config/tmux/scripts/calendar-helpers.sh \
  tmux/.config/tmux/scripts/tests/test-calendar-helpers.sh \
  tmux/.config/tmux/scripts/tests/test-cal-setup.sh
python3 -m py_compile tmux/.config/tmux/scripts/calendar_oauth.py \
  tmux/.config/tmux/scripts/tests/test_calendar_oauth.py
```

Expected: every command exits 0 with no warnings.

- [ ] **Step 3: Run a focused security scan**

```bash
trivy fs --quiet --scanners secret,misconfig tmux/.config/tmux
```

Expected: zero secret and misconfiguration findings.

- [ ] **Step 4: Request independent review**

Request review focused on shell boundaries, callback validation, sensitive
output, filesystem modes, test realism, and regressions.

### Task 9: Remove temporary planning artifacts

**Files:**
- Delete:
  `docs/superpowers/specs/2026-07-14-calendar-security-design.md`
- Delete: `docs/superpowers/plans/2026-07-14-calendar-security.md`

- [ ] **Step 1: Delete the temporary documents after verification succeeds**

```bash
git rm docs/superpowers/specs/2026-07-14-calendar-security-design.md \
  docs/superpowers/plans/2026-07-14-calendar-security.md
```

- [ ] **Step 2: Commit the cleanup**

```bash
git commit -m "chore(security): remove calendar planning artifacts" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

- [ ] **Step 3: Verify the final branch state**

Re-run Task 8 Steps 1 through 3, then run:

```bash
git status --short
git log --oneline --decorate -12
```

Expected: tests and checks pass, the worktree is clean, and neither temporary
document remains in the branch tip.
