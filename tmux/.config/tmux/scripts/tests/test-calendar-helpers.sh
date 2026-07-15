#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
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
if grep -F "$payload" "$TMUX_CAPTURE"; then
    echo "popup payload leaked into tmux arguments" >&2
    exit 1
fi
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
