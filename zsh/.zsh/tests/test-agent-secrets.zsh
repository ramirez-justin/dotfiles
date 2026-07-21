#!/usr/bin/env zsh
set -euo pipefail

REPO_ROOT="${0:A:h:h:h:h}"
HELPER="$REPO_ROOT/zsh/.zsh/agent-secrets.zsh"
REFERENCES="$REPO_ROOT/pi/.pi/agent/agent-secrets.env"
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT
export HOME="$TEST_DIR/home"
export OP_CAPTURE="$TEST_DIR/op-args"
export CLAUDE_CAPTURE="$TEST_DIR/claude-args"
mkdir -p "$HOME/.pi/agent" "$TEST_DIR/bin"
cp "$REFERENCES" "$HOME/.pi/agent/agent-secrets.env"

cat >"$TEST_DIR/bin/op" <<'STUB'
#!/bin/zsh
print -rl -- "$@" >"$OP_CAPTURE"
while (( $# )); do
    if [[ "$1" == "--" ]]; then
        shift
        export JIRA_API_TOKEN="resolved-jira"
        export FIVETRAN_API_KEY="resolved-key"
        export FIVETRAN_API_SECRET="resolved-secret"
        exec "$@"
    fi
    shift
done
exit 2
STUB

cat >"$TEST_DIR/bin/claude" <<'STUB'
#!/bin/zsh
print -rl -- "$@" >"$CLAUDE_CAPTURE"
[[ "$JIRA_API_TOKEN" == "resolved-jira" ]]
[[ "$FIVETRAN_API_KEY" == "resolved-key" ]]
[[ "$FIVETRAN_API_SECRET" == "resolved-secret" ]]
STUB
chmod +x "$TEST_DIR/bin/op" "$TEST_DIR/bin/claude"
PATH="$TEST_DIR/bin:$PATH"

source "$HELPER"
claude --model test "two words"

grep -Fx -- "--env-file=$HOME/.pi/agent/agent-secrets.env" "$OP_CAPTURE"
grep -Fx -- "--" "$OP_CAPTURE"
grep -Fx -- "--model" "$CLAUDE_CAPTURE"
grep -Fx -- "test" "$CLAUDE_CAPTURE"
grep -Fx -- "two words" "$CLAUDE_CAPTURE"

if grep -Ev '^([A-Z_]+)=op://.+$' "$REFERENCES"; then
    print -u2 "reference file contains a non-reference value"
    exit 1
fi
[[ "$(wc -l <"$REFERENCES" | tr -d ' ')" == "3" ]]

rm "$HOME/.pi/agent/agent-secrets.env"
if claude should-not-run; then
    print -u2 "Claude started without the reference file"
    exit 1
fi
