claude() {
    local claude_bin
    local secrets_env="$HOME/.pi/agent/agent-secrets.env"

    if [[ ! -r "$secrets_env" ]]; then
        print -u2 "Claude secrets file is unavailable: $secrets_env"
        return 1
    fi
    if ! whence -p op >/dev/null; then
        print -u2 "1Password CLI (op) is required to launch Claude."
        return 127
    fi
    claude_bin=$(whence -p claude)
    if [[ -z "$claude_bin" ]]; then
        print -u2 "Claude executable is not available on PATH."
        return 127
    fi

    command op run --env-file="$secrets_env" -- "$claude_bin" "$@"
}
