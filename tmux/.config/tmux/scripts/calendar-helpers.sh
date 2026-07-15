#!/bin/bash

calendar_atomic_json_write() {
    local destination=$1
    local temporary

    temporary=$(mktemp "${destination}.tmp.XXXXXX") || return 1
    chmod 600 "$temporary"

    if ! cat >"$temporary" ||
        ! jq -e . "$temporary" >/dev/null 2>&1; then
        rm -f -- "$temporary"
        return 1
    fi

    if ! mv -f -- "$temporary" "$destination"; then
        rm -f -- "$temporary"
        return 1
    fi
    chmod 600 "$destination"
}

calendar_show_popup() {
    local popup_text=$1
    local popup_file
    local popup_command

    popup_file=$(mktemp "${TMPDIR:-/tmp}/dotfiles-calendar-popup.XXXXXX") ||
        return 1
    chmod 600 "$popup_file"
    if ! printf '%s\n' "$popup_text" >"$popup_file"; then
        rm -f -- "$popup_file"
        return 1
    fi

    # Variables expand inside the popup shell, not in this script.
    # shellcheck disable=SC2016
    popup_command='less -- "$CALENDAR_POPUP_FILE"; status=$?; '
    # shellcheck disable=SC2016
    popup_command+='rm -f -- "$CALENDAR_POPUP_FILE"; exit $status'
    if ! tmux display-popup -w50% -h50% -T "Upcoming Meeting" \
        -e "CALENDAR_POPUP_FILE=$popup_file" \
        -E "$popup_command"; then
        rm -f -- "$popup_file"
        return 1
    fi
}
