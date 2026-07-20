#!/bin/sh
set -eu

repo=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
wrapper="$repo/pi/.pi/agent/bin/chalk-mcp"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

run_expect_failure() {
    expected=$1
    shift
    output="$tmp/output"
    if "$@" >"$output" 2>&1; then
        fail "command unexpectedly succeeded: $expected"
    fi
    grep -F "$expected" "$output" >/dev/null || {
        cat "$output" >&2
        fail "missing error: $expected"
    }
}

run_expect_failure \
    "Chalk CLI is not installed; run mise run chalk-install." \
    env CHALK_INSTALL="$tmp/missing" sh "$wrapper"

mkdir -p "$tmp/chalk/bin"
cat >"$tmp/chalk/bin/chalk" <<'SH'
#!/bin/sh
if [ "$*" != "config --json" ]; then
    echo "unexpected Chalk config arguments: $*" >&2
    exit 2
fi
case "${FAKE_CHALK_MODE:-ok}" in
    unauthenticated)
        exit 1
        ;;
    missing-secret)
        printf '%s\n' \
            '{"clientId":{"value":"personal-id"},'\
'"apiServer":{"value":"https://api.chalk.ai"}}'
        ;;
    ok)
        printf '%s\n' \
            '{"clientId":{"value":"personal-id"},'\
'"clientSecret":{"value":"personal-secret"},'\
'"apiServer":{"value":"https://api.chalk.ai/"}}'
        ;;
esac
SH
chmod +x "$tmp/chalk/bin/chalk"

run_expect_failure \
    "Chalk CLI is not authenticated; run chalk login." \
    env CHALK_INSTALL="$tmp/chalk" FAKE_CHALK_MODE=unauthenticated \
    sh "$wrapper"

run_expect_failure \
    "Chalk config is missing clientSecret; run chalk login." \
    env CHALK_INSTALL="$tmp/chalk" FAKE_CHALK_MODE=missing-secret \
    sh "$wrapper"

cat >"$tmp/chalk/bin/npx" <<'SH'
#!/bin/sh
{
    printf 'client_id=%s\n' "$CHALK_CLIENT_ID"
    printf 'client_secret=%s\n' "$CHALK_CLIENT_SECRET"
    printf 'arg=%s\n' "$@"
} >"$TEST_CAPTURE"
SH
chmod +x "$tmp/chalk/bin/npx"

capture="$tmp/capture"
PATH="$tmp/chalk/bin:$PATH" \
CHALK_INSTALL="$tmp/chalk" \
FAKE_CHALK_MODE=ok \
TEST_CAPTURE="$capture" \
sh "$wrapper"

grep -F 'client_id=personal-id' "$capture" >/dev/null
grep -F 'client_secret=personal-secret' "$capture" >/dev/null
grep -F 'arg=mcp-remote@0.1.38' "$capture" >/dev/null
grep -F 'arg=https://api.chalk.ai/v1/mcp/sse' "$capture" >/dev/null
# The wrapper must preserve these placeholders for mcp-remote to expand.
# shellcheck disable=SC2016
grep -F 'arg=X-Chalk-Client-Id: ${CHALK_CLIENT_ID}' \
    "$capture" >/dev/null
# shellcheck disable=SC2016
grep -F 'arg=X-Chalk-Client-Secret: ${CHALK_CLIENT_SECRET}' \
    "$capture" >/dev/null
if grep -F 'arg=X-Chalk-Client-Secret: personal-secret' \
    "$capture" >/dev/null; then
    fail "secret was expanded into a process argument"
fi

printf '%s\n' "chalk-mcp wrapper tests passed"
