#!/usr/bin/env bash
# sofia-pre-compact.sh — append a session pre-compact section to today's daily log.
set -uo pipefail

INPUT="$(cat)"
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_sofia-context.sh" "$INPUT"

LOG="${SOFIA_LOG:-$HOME/.local/state/sofia/hooks.log}"
mkdir -p "$(dirname "$LOG")"

mkdir -p "$SOFIA_DAILY_DIR" 2>>"$LOG" || { echo '{}'; exit 0; }
DAILY="$SOFIA_DAILY_DIR/$SOFIA_TODAY.md"

# Initialise file with frontmatter on first write of the day.
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
# Pull fields from input JSON (best effort; empty if absent).
TRANSCRIPT="$(echo "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null || echo "")"
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo "")"
TRIGGER="$(echo "$INPUT" | jq -r '.trigger // ""' 2>/dev/null || echo "")"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null || echo "")"

cat >> "$DAILY" <<EOF

## $NOW · session pre-compact
- Transcript: $TRANSCRIPT
- Session ID: $SESSION_ID
- CWD: $CWD
- Trigger: $TRIGGER
EOF

echo "[$(date -Iseconds)] pre-compact: ctx=$SOFIA_CTX_WRITE wrote $DAILY" >> "$LOG"
echo '{}'
