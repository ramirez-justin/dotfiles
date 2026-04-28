#!/usr/bin/env bash
# _sofia-context.sh — shared helper, sourced by sofia hook scripts.
# Sets:
#   SOFIA_VAULT     — vault root path
#   SOFIA_CTX       — personal | work
#   SOFIA_TODAY     — YYYY-MM-DD
#   SOFIA_DAILY_DIR — $SOFIA_VAULT/_agent/daily/$SOFIA_CTX
#
# Reads:
#   $1                  — JSON blob from Claude Code (cwd, transcript_path, etc.)
#   $SOFIA_CONTEXT env  — explicit override (wins over PWD inference)

set -uo pipefail   # NOT -e: hooks must never block sessions

: "${SOFIA_VAULT:=$HOME/dev/SOFIA}"

_input_json="${1:-}"
_cwd=""
if [[ -n "$_input_json" ]]; then
  _cwd="$(echo "$_input_json" | jq -r '.cwd // empty' 2>/dev/null || echo "")"
fi

if [[ -n "${SOFIA_CONTEXT:-}" ]]; then
  SOFIA_CTX="$SOFIA_CONTEXT"
else
  shopt -s nocasematch
  if [[ "$_cwd" == "$HOME/telophaseqs"* ]] || [[ "$_cwd" == *"/SOFIA/"*"/work/"* ]]; then
    SOFIA_CTX=work
  else
    SOFIA_CTX=personal
  fi
  shopt -u nocasematch
fi

# `both` is allowed as an explicit override, but for daily-log writes we still
# need to pick one bucket. Treat `both` as personal for write paths.
SOFIA_CTX_WRITE="$SOFIA_CTX"
[[ "$SOFIA_CTX" == "both" ]] && SOFIA_CTX_WRITE="personal"

SOFIA_TODAY="$(date +%Y-%m-%d)"
SOFIA_DAILY_DIR="$SOFIA_VAULT/_agent/daily/$SOFIA_CTX_WRITE"

export SOFIA_VAULT SOFIA_CTX SOFIA_CTX_WRITE SOFIA_TODAY SOFIA_DAILY_DIR
