#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CREDENTIALS_FILE="$SCRIPT_DIR/.credentials.json"

ALERT_IF_IN_NEXT_MINUTES=20
ALERT_POPUP_BEFORE_SECONDS=10
NERD_FONT_FREE="󱁕     "
NERD_FONT_MEETING="󰤙  "

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
		'.access_token = $at | .expiry = $exp' "$CREDENTIALS_FILE" >"${CREDENTIALS_FILE}.tmp" &&
		mv "${CREDENTIALS_FILE}.tmp" "$CREDENTIALS_FILE"
	chmod 600 "$CREDENTIALS_FILE"
fi

# Query Google Calendar API for next event across all calendars
TIME_MIN=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
TIME_MAX=$(date -u -v23H -v59M -v59S +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null)
# Fallback for GNU date
if [[ -z "$TIME_MAX" ]]; then
	TIME_MAX=$(date -u -d "today 23:59:59" +"%Y-%m-%dT%H:%M:%S.000Z")
fi

ENCODED_TIME_MIN=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TIME_MIN'))")
ENCODED_TIME_MAX=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TIME_MAX'))")

# Calendars to check
CALENDAR_IDS=(
	"ramirez.justin@gmail.com"
	"justin.ramirez@gametime.co"
	"family17937415507260572102@group.calendar.google.com"
)

# Query each calendar and collect the soonest timed event
EARLIEST_EVENT=""
EARLIEST_START=""

for CAL_ID in "${CALENDAR_IDS[@]}"; do
	ENCODED_CAL_ID=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$CAL_ID'))")
	RESPONSE=$(curl -s \
		-H "Authorization: Bearer $ACCESS_TOKEN" \
		"https://www.googleapis.com/calendar/v3/calendars/${ENCODED_CAL_ID}/events?timeMin=${ENCODED_TIME_MIN}&timeMax=${ENCODED_TIME_MAX}&maxResults=5&orderBy=startTime&singleEvents=true")

	# Find the first timed (non-all-day) event
	EVENT_ITEM=$(echo "$RESPONSE" | jq -r '[.items[] | select(.start.dateTime != null)] | first // empty' 2>/dev/null)
	if [[ -z "$EVENT_ITEM" || "$EVENT_ITEM" == "null" ]]; then
		continue
	fi

	START=$(echo "$EVENT_ITEM" | jq -r '.start.dateTime')

	if [[ -z "$EARLIEST_START" || "$START" < "$EARLIEST_START" ]]; then
		EARLIEST_START="$START"
		EARLIEST_EVENT="$EVENT_ITEM"
	fi
done

if [[ -z "$EARLIEST_EVENT" ]]; then
	echo "$NERD_FONT_FREE"
	exit 0
fi

EVENT="$EARLIEST_EVENT"
EVENT_START="$EARLIEST_START"

# Skip all-day events (they have .start.date instead of .start.dateTime)
if [[ -z "$EVENT_START" ]]; then
	echo "$NERD_FONT_FREE"
	exit 0
fi

EVENT_TITLE=$(echo "$EVENT" | jq -r '.summary // "No title"')

# Parse event start time (handles timezone offsets correctly)
read -r EVENT_EPOCH EVENT_TIME <<< $(python3 -c "
from datetime import datetime, timezone
import sys
dt = datetime.fromisoformat('$EVENT_START')
print(int(dt.timestamp()), dt.astimezone().strftime('%H:%M'))
")

# Calculate minutes until meeting
DIFF=$((EVENT_EPOCH - NOW))
MINUTES=$((DIFF / 60))

# Display popup if meeting is about to start
if [[ "$DIFF" -gt "$ALERT_POPUP_BEFORE_SECONDS" && "$DIFF" -lt $((ALERT_POPUP_BEFORE_SECONDS + 10)) ]]; then
	EVENT_DESCRIPTION=$(echo "$EVENT" | jq -r '.description // "No description"' | head -5)
	EVENT_ATTENDEES=$(echo "$EVENT" | jq -r '.attendees[]?.email // empty' 2>/dev/null | head -10)
	POPUP_TEXT="Meeting: $EVENT_TITLE\nTime: $EVENT_TIME\n\nAttendees:\n$EVENT_ATTENDEES\n\nNotes:\n$EVENT_DESCRIPTION"
	tmux display-popup -w50% -h50% -T "Upcoming Meeting" -E "echo '$POPUP_TEXT' | less" &>/dev/null &
fi

# Print status
if [[ "$MINUTES" -lt "$ALERT_IF_IN_NEXT_MINUTES" && "$MINUTES" -gt -10 ]]; then
	echo "$NERD_FONT_MEETING $EVENT_TIME $EVENT_TITLE ($MINUTES min)"
else
	echo "$NERD_FONT_FREE"
fi
