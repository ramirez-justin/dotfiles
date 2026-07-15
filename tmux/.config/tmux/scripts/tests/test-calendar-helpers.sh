#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/calendar-helpers.sh"

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
export TMPDIR="$TEST_DIR"
export TMUX_CAPTURE="$TEST_DIR/tmux-args"
export TMUX_CONTENT_CAPTURE="$TEST_DIR/tmux-content"
export CURL_CAPTURE="$TEST_DIR/curl-args"
export CURL_STDIN_CAPTURE="$TEST_DIR/curl-stdin"
mkdir -p "$TEST_DIR/bin"

cat >"$TEST_DIR/bin/less" <<'STUB'
#!/bin/bash
[[ "$1" == "--" ]]
cat "$2" >/dev/null
STUB
chmod +x "$TEST_DIR/bin/less"

cat >"$TEST_DIR/bin/tmux" <<'STUB'
#!/bin/bash
printf '%s\n' "$@" >"$TMUX_CAPTURE"
popup_environment=""
popup_command=""
while (($#)); do
    case "$1" in
        -e)
            shift
            popup_environment=$1
            ;;
        -E)
            shift
            popup_command=$1
            ;;
    esac
    shift
done
export "$popup_environment"
cat "$CALENDAR_POPUP_FILE" >"$TMUX_CONTENT_CAPTURE"
bash -c "$popup_command"
STUB
chmod +x "$TEST_DIR/bin/tmux"

cat >"$TEST_DIR/bin/curl" <<'STUB'
#!/bin/bash
printf '%s\n' "$@" >"$CURL_CAPTURE"
cat >"$CURL_STDIN_CAPTURE"
printf '%s\n' '{}'
STUB
chmod +x "$TEST_DIR/bin/curl"
PATH="$TEST_DIR/bin:$PATH"

assert_not_in_file() {
    local needle=$1
    local file=$2
    if grep -F "$needle" "$file"; then
        echo "unexpected sensitive value in $file" >&2
        exit 1
    fi
}

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
[[ ! -e "$popup_file" ]]
[[ "$(cat "$TMUX_CONTENT_CAPTURE")" == "$payload" ]]

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

authorization_code="code-sensitive"
client_secret="client-sensitive"
calendar_post_form \
    "https://oauth2.example/token" \
    code "$authorization_code" \
    client_secret "$client_secret" >/dev/null
assert_not_in_file "$authorization_code" "$CURL_CAPTURE"
assert_not_in_file "$client_secret" "$CURL_CAPTURE"
grep -F 'code=code-sensitive' "$CURL_STDIN_CAPTURE" >/dev/null
grep -F 'client_secret=client-sensitive' "$CURL_STDIN_CAPTURE" >/dev/null

access_token="bearer-sensitive"
calendar_get_with_bearer \
    "$access_token" "https://calendar.example/events" >/dev/null
assert_not_in_file "$access_token" "$CURL_CAPTURE"
grep -F "Authorization: Bearer $access_token" \
    "$CURL_STDIN_CAPTURE" >/dev/null
