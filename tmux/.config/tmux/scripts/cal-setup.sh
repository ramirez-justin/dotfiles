#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_SECRET_FILE="$SCRIPT_DIR/.client-secret.json"
CREDENTIALS_FILE="$SCRIPT_DIR/.credentials.json"
REDIRECT_PORT=8080
REDIRECT_URI="http://localhost:$REDIRECT_PORT"
SCOPE="https://www.googleapis.com/auth/calendar.readonly"

# Check dependencies
for cmd in curl jq; do
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

if [[ -z "$CLIENT_ID" || "$CLIENT_ID" == "null" ]]; then
    echo "Error: Could not parse client_id from $CLIENT_SECRET_FILE"
    exit 1
fi

# Build auth URL
AUTH_URL="https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${SCOPE}&access_type=offline&prompt=consent"

echo "Opening browser for Google authorization..."
echo ""
echo "If the browser doesn't open, visit this URL:"
echo "$AUTH_URL"
echo ""

# Open browser
open "$AUTH_URL" 2>/dev/null || xdg-open "$AUTH_URL" 2>/dev/null || echo "(Could not open browser automatically)"

# Listen for the redirect with the auth code
echo "Waiting for authorization callback on port $REDIRECT_PORT..."
RESPONSE=$(nc -l "$REDIRECT_PORT" <<< "HTTP/1.1 200 OK

Authorization successful! You can close this tab." 2>&1 | head -1)

# Extract auth code from the GET request
AUTH_CODE=$(echo "$RESPONSE" | grep -oP 'code=\K[^&\s]+' || echo "")

if [[ -z "$AUTH_CODE" ]]; then
    # Try macOS-compatible extraction (no -P flag)
    AUTH_CODE=$(echo "$RESPONSE" | sed -n 's/.*code=\([^& ]*\).*/\1/p')
fi

if [[ -z "$AUTH_CODE" ]]; then
    echo "Error: Could not extract authorization code from callback."
    echo "Response was: $RESPONSE"
    exit 1
fi

echo "Authorization code received. Exchanging for tokens..."

# Exchange auth code for tokens
TOKEN_RESPONSE=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "code=${AUTH_CODE}" \
    -d "client_id=${CLIENT_ID}" \
    -d "client_secret=${CLIENT_SECRET}" \
    -d "redirect_uri=${REDIRECT_URI}" \
    -d "grant_type=authorization_code")

# Check for errors
ERROR=$(echo "$TOKEN_RESPONSE" | jq -r '.error // empty')
if [[ -n "$ERROR" ]]; then
    ERROR_DESC=$(echo "$TOKEN_RESPONSE" | jq -r '.error_description // "unknown error"')
    echo "Error exchanging code for tokens: $ERROR - $ERROR_DESC"
    exit 1
fi

# Extract tokens
ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token')
REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.refresh_token')
EXPIRES_IN=$(echo "$TOKEN_RESPONSE" | jq -r '.expires_in')

if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
    echo "Error: No access token in response."
    echo "$TOKEN_RESPONSE"
    exit 1
fi

if [[ -z "$REFRESH_TOKEN" || "$REFRESH_TOKEN" == "null" ]]; then
    echo "Warning: No refresh token received. You may need to revoke access and re-run."
fi

# Calculate expiry timestamp
EXPIRY=$(($(date +%s) + EXPIRES_IN))

# Save credentials
cat > "$CREDENTIALS_FILE" <<EOF
{
    "access_token": "$ACCESS_TOKEN",
    "refresh_token": "$REFRESH_TOKEN",
    "expiry": $EXPIRY,
    "client_id": "$CLIENT_ID",
    "client_secret": "$CLIENT_SECRET"
}
EOF

chmod 600 "$CREDENTIALS_FILE"

echo ""
echo "Setup complete! Credentials saved to $CREDENTIALS_FILE"
echo "Your tmux status bar will now show calendar events."
echo ""
echo "To test, run: ~/.config/tmux/scripts/cal.sh"
