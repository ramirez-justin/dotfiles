#!/bin/bash

calendar_atomic_json_write() (
    local destination=$1
    local temporary=""

    # Invoked by the EXIT trap below.
    # shellcheck disable=SC2329
    cleanup() {
        if [[ -n "$temporary" ]]; then
            rm -f -- "$temporary"
        fi
    }
    trap cleanup EXIT
    trap 'exit 1' HUP INT TERM

    temporary=$(mktemp "${destination}.tmp.XXXXXX") || return 1
    chmod 600 "$temporary"

    if ! cat >"$temporary" ||
        ! jq -e . "$temporary" >/dev/null 2>&1; then
        return 1
    fi

    mv -f -- "$temporary" "$destination" || return 1
    temporary=""
    chmod 600 "$destination"
)

calendar_show_popup() (
    local popup_text=$1
    local popup_file=""
    local popup_command

    # Invoked by the EXIT trap below.
    # shellcheck disable=SC2329
    cleanup() {
        if [[ -n "$popup_file" ]]; then
            rm -f -- "$popup_file"
        fi
    }
    trap cleanup EXIT
    trap 'exit 1' HUP INT TERM

    popup_file=$(mktemp "${TMPDIR:-/tmp}/dotfiles-calendar-popup.XXXXXX") ||
        return 1
    chmod 600 "$popup_file"
    printf '%s\n' "$popup_text" >"$popup_file" || return 1

    # Variables expand inside the popup shell, not in this script.
    # shellcheck disable=SC2016
    popup_command='less -- "$CALENDAR_POPUP_FILE"; status=$?; '
    # shellcheck disable=SC2016
    popup_command+='rm -f -- "$CALENDAR_POPUP_FILE"; exit $status'
    tmux display-popup -w50% -h50% -T "Upcoming Meeting" \
        -e "CALENDAR_POPUP_FILE=$popup_file" \
        -E "$popup_command"
)

calendar_form_encode() {
    if (( $# == 0 || $# % 2 != 0 )); then
        echo "form fields must be key-value pairs" >&2
        return 1
    fi

    {
        while (($#)); do
            printf '%s\0%s\0' "$1" "$2"
            shift 2
        done
    } | python3 -c '
import sys
import urllib.parse

parts = sys.stdin.buffer.read().split(b"\0")
if parts and parts[-1] == b"":
    parts.pop()
if len(parts) % 2:
    raise SystemExit("invalid form input")
pairs = [
    (parts[index].decode(), parts[index + 1].decode())
    for index in range(0, len(parts), 2)
]
sys.stdout.write(urllib.parse.urlencode(pairs))
'
}

calendar_post_form() {
    local endpoint=$1
    local body
    shift

    body=$(calendar_form_encode "$@") || return 1
    printf '%s' "$body" |
        curl --silent --show-error --fail-with-body \
            --request POST "$endpoint" \
            --header "Content-Type: application/x-www-form-urlencoded" \
            --data-binary @-
}

calendar_get_with_bearer() {
    local access_token=$1
    local url=$2

    printf 'Authorization: Bearer %s\n' "$access_token" |
        curl --silent --show-error --header @- "$url"
}
