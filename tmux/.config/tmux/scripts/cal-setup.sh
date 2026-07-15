#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_SECRET_FILE=${CLIENT_SECRET_FILE:-"$SCRIPT_DIR/.client-secret.json"}
CREDENTIALS_FILE=${CREDENTIALS_FILE:-"$SCRIPT_DIR/.credentials.json"}
CALENDAR_OAUTH_HELPER=${CALENDAR_OAUTH_HELPER:-"$SCRIPT_DIR/calendar_oauth.py"}
SCOPE="https://www.googleapis.com/auth/calendar.readonly"
umask 077
# shellcheck disable=SC1091
source "$SCRIPT_DIR/calendar-helpers.sh"

# Check dependencies
for cmd in curl jq python3; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "Error: $cmd is required but not installed."
        exit 1
    fi
done

# Check client secret exists
if [[ ! -f "$CLIENT_SECRET_FILE" ]]; then
    echo "Error: Client secret file not found at $CLIENT_SECRET_FILE"
    echo ""
    echo "Setup instructions:"
    echo "1. Go to https://console.cloud.google.com"
    echo "2. Create a new project (or select existing)"
    echo "3. Enable the Google Calendar API"
    echo "4. Go to Credentials > Create Credentials > OAuth client ID"
    echo "5. Application type: Desktop app"
    echo "6. Download the JSON and save it as:"
    echo "   $CLIENT_SECRET_FILE"
    exit 1
fi

# Parse client secret - handle both "installed" and "web" credential types
CLIENT_ID=$(jq -r '(.installed // .web).client_id' "$CLIENT_SECRET_FILE")
CLIENT_SECRET=$(jq -r '(.installed // .web).client_secret' "$CLIENT_SECRET_FILE")

if [[ -z "$CLIENT_ID" || "$CLIENT_ID" == "null" ||
    -z "$CLIENT_SECRET" || "$CLIENT_SECRET" == "null" ]]; then
    echo "Error: Could not parse OAuth client credentials."
    exit 1
fi

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

echo "Authorization code received. Exchanging for tokens..."

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

echo ""
echo "Setup complete! Credentials saved to $CREDENTIALS_FILE"
echo "Your tmux status bar will now show calendar events."
echo ""
echo "To test, run: ~/.config/tmux/scripts/cal.sh"
