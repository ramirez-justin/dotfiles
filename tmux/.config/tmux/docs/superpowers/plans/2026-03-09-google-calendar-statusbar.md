# Google Calendar Tmux Status Bar Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the next Google Calendar meeting in the tmux status bar with a countdown timer.

**Architecture:** A bash OAuth setup script handles one-time auth, storing tokens locally. A main bash script runs on each tmux status refresh — it manages token refresh, queries the Google Calendar API, and outputs formatted text for the status bar.

**Tech Stack:** Bash, curl, jq, Google Calendar API v3

---

## File Structure

| File | Responsibility |
|------|---------------|
| `scripts/cal-setup.sh` | One-time OAuth flow: opens browser, captures auth code, saves tokens |
| `scripts/cal.sh` | Main script: token refresh, API query, status bar output, popup trigger |
| `scripts/.credentials.json` | Stored access/refresh tokens (gitignored) |
| `scripts/.client-secret.json` | Google OAuth client ID/secret (gitignored) |
| `.gitignore` | Exclude credential files |
| `tmux.conf` | Wire `cal.sh` into `status-right` |

---

## Chunk 1: Project Setup and OAuth Script

### Task 1: Create directory structure and .gitignore

**Files:**
- Create: `~/.config/tmux/scripts/` (directory)
- Create: `~/.config/tmux/.gitignore`

- [ ] **Step 1: Create scripts directory**

```bash
mkdir -p ~/.config/tmux/scripts
```

- [ ] **Step 2: Create .gitignore**

Create `~/.config/tmux/.gitignore`:

```
scripts/.credentials.json
scripts/.client-secret.json
```

- [ ] **Step 3: Verify**

```bash
ls -la ~/.config/tmux/scripts/
cat ~/.config/tmux/.gitignore
```

Expected: directory exists, .gitignore lists both credential files.

- [ ] **Step 4: Commit**

```bash
cd ~/.config/tmux
git add .gitignore
git commit -m "chore: add .gitignore for calendar credential files"
```

---

### Task 2: Write the OAuth setup script

**Files:**
- Create: `~/.config/tmux/scripts/cal-setup.sh`

**Context:** This script handles one-time Google OAuth setup. It reads the client secret JSON the user downloaded from Google Cloud Console, opens the browser for consent, captures the redirect on a local port, exchanges the auth code for tokens, and saves them.

**Prerequisite:** User must have:
1. Created a Google Cloud project at https://console.cloud.google.com
2. Enabled the Google Calendar API
3. Created OAuth 2.0 credentials (Application type: "Desktop app")
4. Downloaded the client secret JSON to `~/.config/tmux/scripts/.client-secret.json`

- [ ] **Step 1: Write cal-setup.sh**

Create `~/.config/tmux/scripts/cal-setup.sh`:

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_SECRET_FILE="$SCRIPT_DIR/.client-secret.json"
CREDENTIALS_FILE="$SCRIPT_DIR/.credentials.json"
REDIRECT_PORT=8080
REDIRECT_URI="http://localhost:$REDIRECT_PORT"
SCOPE="https://www.googleapis.com/auth/calendar.events.readonly"

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
```

- [ ] **Step 2: Make executable**

```bash
chmod +x ~/.config/tmux/scripts/cal-setup.sh
```

- [ ] **Step 3: Verify script parses correctly**

```bash
bash -n ~/.config/tmux/scripts/cal-setup.sh
```

Expected: no syntax errors.

- [ ] **Step 4: Commit**

```bash
cd ~/.config/tmux
git add scripts/cal-setup.sh
git commit -m "feat: add Google Calendar OAuth setup script"
```

---

## Chunk 2: Main Calendar Script

### Task 3: Write the main calendar script

**Files:**
- Create: `~/.config/tmux/scripts/cal.sh`

**Context:** This script is called by tmux on every status bar refresh (typically every 15 seconds). It must be fast — if credentials are missing, it exits silently. It refreshes the access token if expired, queries the Google Calendar API for the next event, and outputs formatted text.

- [ ] **Step 1: Write cal.sh**

Create `~/.config/tmux/scripts/cal.sh`:

```bash
#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CREDENTIALS_FILE="$SCRIPT_DIR/.credentials.json"

ALERT_IF_IN_NEXT_MINUTES=10
ALERT_POPUP_BEFORE_SECONDS=10
NERD_FONT_FREE="󱁕 "
NERD_FONT_MEETING="󰤙"

# Exit silently if not set up yet
if [[ ! -f "$CREDENTIALS_FILE" ]]; then
    echo "$NERD_FONT_FREE"
    exit 0
fi

# Read credentials
ACCESS_TOKEN=$(jq -r '.access_token' "$CREDENTIALS_FILE")
REFRESH_TOKEN=$(jq -r '.refresh_token' "$CREDENTIALS_FILE")
EXPIRY=$(jq -r '.expiry' "$CREDENTIALS_FILE")
CLIENT_ID=$(jq -r '.client_id' "$CREDENTIALS_FILE")
CLIENT_SECRET=$(jq -r '.client_secret' "$CREDENTIALS_FILE")

# Refresh token if expired
NOW=$(date +%s)
if [[ "$NOW" -ge "$EXPIRY" ]]; then
    TOKEN_RESPONSE=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "client_id=${CLIENT_ID}" \
        -d "client_secret=${CLIENT_SECRET}" \
        -d "refresh_token=${REFRESH_TOKEN}" \
        -d "grant_type=refresh_token")

    NEW_ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
    EXPIRES_IN=$(echo "$TOKEN_RESPONSE" | jq -r '.expires_in // empty')

    if [[ -z "$NEW_ACCESS_TOKEN" ]]; then
        echo "$NERD_FONT_FREE"
        exit 0
    fi

    ACCESS_TOKEN="$NEW_ACCESS_TOKEN"
    NEW_EXPIRY=$((NOW + EXPIRES_IN))

    # Update credentials file
    jq --arg at "$ACCESS_TOKEN" --argjson exp "$NEW_EXPIRY" \
        '.access_token = $at | .expiry = $exp' "$CREDENTIALS_FILE" > "${CREDENTIALS_FILE}.tmp" \
        && mv "${CREDENTIALS_FILE}.tmp" "$CREDENTIALS_FILE"
    chmod 600 "$CREDENTIALS_FILE"
fi

# Query Google Calendar API for next event
TIME_MIN=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
TIME_MAX=$(date -u -v23H -v59M -v59S +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null)
# Fallback for GNU date
if [[ -z "$TIME_MAX" ]]; then
    TIME_MAX=$(date -u -d "today 23:59:59" +"%Y-%m-%dT%H:%M:%S.000Z")
fi

ENCODED_TIME_MIN=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TIME_MIN'))")
ENCODED_TIME_MAX=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TIME_MAX'))")

EVENTS_RESPONSE=$(curl -s \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${ENCODED_TIME_MIN}&timeMax=${ENCODED_TIME_MAX}&maxResults=1&orderBy=startTime&singleEvents=true")

# Check if we got events
EVENT_COUNT=$(echo "$EVENTS_RESPONSE" | jq -r '.items | length // 0')

if [[ "$EVENT_COUNT" -eq 0 || "$EVENT_COUNT" == "null" ]]; then
    echo "$NERD_FONT_FREE"
    exit 0
fi

# Parse first event
EVENT=$(echo "$EVENTS_RESPONSE" | jq -r '.items[0]')
EVENT_START=$(echo "$EVENT" | jq -r '.start.dateTime // empty')

# Skip all-day events (they have .start.date instead of .start.dateTime)
if [[ -z "$EVENT_START" ]]; then
    echo "$NERD_FONT_FREE"
    exit 0
fi

EVENT_TITLE=$(echo "$EVENT" | jq -r '.summary // "No title"')

# Parse event start time
EVENT_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$(echo "$EVENT_START" | cut -d'+' -f1 | cut -d'-' -f1-3 | sed 's/Z$//')" +%s 2>/dev/null)
# Fallback for GNU date
if [[ -z "$EVENT_EPOCH" ]]; then
    EVENT_EPOCH=$(date -d "$EVENT_START" +%s)
fi

EVENT_TIME=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$(echo "$EVENT_START" | cut -d'+' -f1 | cut -d'-' -f1-3 | sed 's/Z$//')" +"%H:%M" 2>/dev/null)
if [[ -z "$EVENT_TIME" ]]; then
    EVENT_TIME=$(date -d "$EVENT_START" +"%H:%M")
fi

# Calculate minutes until meeting
DIFF=$((EVENT_EPOCH - NOW))
MINUTES=$((DIFF / 60))

# Display popup if meeting is about to start
if [[ "$DIFF" -gt "$ALERT_POPUP_BEFORE_SECONDS" && "$DIFF" -lt $((ALERT_POPUP_BEFORE_SECONDS + 10)) ]]; then
    EVENT_END=$(echo "$EVENT" | jq -r '.start.dateTime // empty')
    EVENT_DESCRIPTION=$(echo "$EVENT" | jq -r '.description // "No description"' | head -5)
    EVENT_ATTENDEES=$(echo "$EVENT" | jq -r '.attendees[]?.email // empty' 2>/dev/null | head -10)
    POPUP_TEXT="Meeting: $EVENT_TITLE\nTime: $EVENT_TIME\n\nAttendees:\n$EVENT_ATTENDEES\n\nNotes:\n$EVENT_DESCRIPTION"
    tmux display-popup -w50% -h50% -T "Upcoming Meeting" -E "echo '$POPUP_TEXT' | less" &>/dev/null &
fi

# Print status
if [[ "$MINUTES" -lt "$ALERT_IF_IN_NEXT_MINUTES" && "$MINUTES" -gt -60 ]]; then
    echo "$NERD_FONT_MEETING $EVENT_TIME $EVENT_TITLE ($MINUTES min)"
else
    echo "$NERD_FONT_FREE"
fi
```

- [ ] **Step 2: Make executable**

```bash
chmod +x ~/.config/tmux/scripts/cal.sh
```

- [ ] **Step 3: Verify script parses correctly**

```bash
bash -n ~/.config/tmux/scripts/cal.sh
```

Expected: no syntax errors.

- [ ] **Step 4: Test without credentials (should show free icon silently)**

```bash
~/.config/tmux/scripts/cal.sh
```

Expected: outputs `󱁕 ` (the free icon) and exits cleanly.

- [ ] **Step 5: Commit**

```bash
cd ~/.config/tmux
git add scripts/cal.sh
git commit -m "feat: add Google Calendar status bar script"
```

---

## Chunk 3: Tmux Integration

### Task 4: Wire cal.sh into tmux.conf

**Files:**
- Modify: `~/.config/tmux/tmux.conf:63`

**Context:** Replace the empty `status-right` with a call to `cal.sh`. The `#()` syntax tells tmux to run a shell command and use its output.

- [ ] **Step 1: Update tmux.conf**

Change line 63 from:
```bash
set -g status-right ''
```
to:
```bash
set -g status-right '#(~/.config/tmux/scripts/cal.sh)'
```

- [ ] **Step 2: Verify tmux.conf is valid**

```bash
tmux source-file ~/.config/tmux/tmux.conf
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/.config/tmux
git add tmux.conf
git commit -m "feat: wire calendar script into tmux status bar"
```

---

### Task 5: Run OAuth setup and verify end-to-end

**Context:** This is the manual verification step. The user runs the setup, authorizes, and confirms the status bar works.

- [ ] **Step 1: Place client secret file**

User downloads OAuth client JSON from Google Cloud Console and saves to:
```
~/.config/tmux/scripts/.client-secret.json
```

- [ ] **Step 2: Run setup**

```bash
~/.config/tmux/scripts/cal-setup.sh
```

Expected: browser opens, user authorizes, script prints "Setup complete!"

- [ ] **Step 3: Verify credentials saved**

```bash
ls -la ~/.config/tmux/scripts/.credentials.json
```

Expected: file exists with `-rw-------` permissions.

- [ ] **Step 4: Test cal.sh with real credentials**

```bash
~/.config/tmux/scripts/cal.sh
```

Expected: either the free icon (no meetings soon) or a meeting with countdown.

- [ ] **Step 5: Reload tmux and verify status bar**

```bash
tmux source-file ~/.config/tmux/tmux.conf
```

Expected: status bar right side shows calendar output.
