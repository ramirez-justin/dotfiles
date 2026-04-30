#!/usr/bin/env bash
# sofia-session-end.sh — append a Pi session-end section to today's daily log.
set -uo pipefail

INPUT="$(cat)"
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_sofia-context.sh" "$INPUT"

LOG="${SOFIA_LOG:-$HOME/.local/state/sofia/hooks.log}"
mkdir -p "$(dirname "$LOG")"

mkdir -p "$SOFIA_DAILY_DIR" 2>>"$LOG" || { echo '{}'; exit 0; }
DAILY="$SOFIA_DAILY_DIR/$SOFIA_TODAY.md"

if [[ ! -f "$DAILY" ]]; then
  cat > "$DAILY" <<EOF
---
type: daily
context: $SOFIA_CTX_WRITE
agent-managed: true
last-touched: $SOFIA_TODAY
sofia-index: true
---
# Daily log — $SOFIA_TODAY ($SOFIA_CTX_WRITE)

EOF
fi

NOW="$(date +%H:%M)"
TRANSCRIPT="$(echo "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null || echo "")"
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo "")"
REASON="$(echo "$INPUT" | jq -r '.reason // ""' 2>/dev/null || echo "")"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null || echo "")"

cat >> "$DAILY" <<EOF

## $NOW · pi session end
- Reason: $REASON
- Transcript: $TRANSCRIPT
- Session ID: $SESSION_ID
- CWD: $CWD
EOF

echo "[$(date -Iseconds)] session-end: ctx=$SOFIA_CTX_WRITE wrote $DAILY" >> "$LOG"
echo '{}'
