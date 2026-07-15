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
grep -Fx 'code_verifier=verifier' "$CURL_CAPTURE" >/dev/null
[[ "$(stat -f %Lp "$credentials_file")" == "600" ]]
jq -e '.access_token == "access" and .refresh_token == "refresh"' \
    "$credentials_file" >/dev/null
