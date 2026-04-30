#!/usr/bin/env bash
# sofia-session-start.sh — Pi session_start wrapper.
# Reads JSON on stdin, infers context, runs the shared SOFIA Python module,
# and emits the same JSON shape as the Claude hook for reuse by the Pi extension.
set -uo pipefail

INPUT="$(cat)"
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_sofia-context.sh" "$INPUT"

LOG="${SOFIA_LOG:-$HOME/.local/state/sofia/hooks.log}"
mkdir -p "$(dirname "$LOG")"

if [[ ! -d "$HOME/.local/share/sofia/src" ]]; then
  echo "[$(date -Iseconds)] session-start: src dir missing, no-op" >> "$LOG"
  echo '{}'
  exit 0
fi

cd "$HOME/.local/share/sofia/src"
{
  echo "[$(date -Iseconds)] session-start: ctx=$SOFIA_CTX vault=$SOFIA_VAULT"
} >> "$LOG"

# Forward env so the python sees the resolved context.
SOFIA_VAULT="$SOFIA_VAULT" SOFIA_CTX="$SOFIA_CTX" \
  uv run --quiet python -m sofia.hooks.session_start
