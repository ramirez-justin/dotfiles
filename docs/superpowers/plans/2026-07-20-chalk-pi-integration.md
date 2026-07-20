# Chalk Pi Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install Chalk through work-dotfiles bootstrap and connect Pi to
Chalk's hosted MCP server with the developer's personal CLI credentials.

**Architecture:** A mise task installs Chalk into `~/.chalk`, while the stowed
Zsh configuration owns its PATH entry. A small tested shell wrapper reads the
untracked Chalk CLI configuration and launches pinned `mcp-remote` without
putting credentials in tracked files or process arguments.

**Tech Stack:** mise, Zsh, POSIX shell, Chalk CLI, jq, pi-mcp-adapter,
`mcp-remote@0.1.38`, Markdown

---

## File Structure

- Modify `mise.toml`: install Chalk during bootstrap and verify it in doctor.
- Modify `zsh/.zshrc`: own `CHALK_INSTALL` and the Chalk binary PATH entry.
- Create `pi/.pi/agent/bin/chalk-mcp`: isolate credential loading and the MCP
  bridge process.
- Create `tests/chalk-mcp-test.sh`: test wrapper failures and secret handling
  with fake Chalk and npx executables.
- Modify `pi/.pi/agent/mcp.json`: route the lazy Chalk server through the
  wrapper instead of incompatible direct OAuth.
- Modify `README.md`: document bootstrap, login, updates, and recovery.

### Task 1: Manage Chalk CLI Installation

**Files:**

- Modify: `mise.toml:8-15`
- Modify: `mise.toml:43-46`
- Modify: `mise.toml:92-104`
- Modify: `zsh/.zshrc:1-8`

- [ ] **Step 1: Prove the managed installation is absent**

Run:

```bash
cd ~/Repositories/dotfiles
! grep -F '"chalk-install"' mise.toml
! grep -F 'export CHALK_INSTALL="$HOME/.chalk"' zsh/.zshrc
```

Expected: both negated checks exit successfully because neither managed entry
exists yet.

- [ ] **Step 2: Add the managed shell environment**

Insert this block after the existing local-bin PATH entry in `zsh/.zshrc`:

```zsh
# Chalk CLI
export CHALK_INSTALL="$HOME/.chalk"
export PATH="$CHALK_INSTALL/bin:$PATH"
```

- [ ] **Step 3: Add Chalk to bootstrap**

Change the bootstrap dependency list in `mise.toml` to:

```toml
[tasks.bootstrap]
description = "Full machine setup (after 1Password is authenticated)"
depends = [
  "brew-install",
  "tools-install",
  "install-omz",
  "chalk-install",
  "inject-secrets",
]
run = "mise run link"
```

- [ ] **Step 4: Add the installer task**

Insert this task after `tasks.tools-install` in `mise.toml`:

```toml
[tasks.chalk-install]
description = "Install or update the Chalk CLI"
depends = ["brew-install"]
run = """
set -euo pipefail
export CHALK_INSTALL="${CHALK_INSTALL:-$HOME/.chalk}"
export PATH="$CHALK_INSTALL/bin:$PATH"
version="${CHALK_VERSION:-latest}"
curl -fsSL https://api.chalk.ai/install.sh | sh -s -- "$version"
chalk version
"""
```

The exported PATH lets Chalk find the newly created binary during its installer
check, so the installer does not append lines to the stowed `.zshrc`.

- [ ] **Step 5: Add the doctor check**

Insert this check after `check "mise tools installed" mise current`:

```sh
check "chalk available" command -v chalk
```

- [ ] **Step 6: Validate managed configuration without installing**

Run:

```bash
cd ~/Repositories/dotfiles
python3 - <<'PY'
import pathlib
import tomllib

with pathlib.Path("mise.toml").open("rb") as file:
    config = tomllib.load(file)

assert "chalk-install" in config["tasks"]["bootstrap"]["depends"]
assert config["tasks"]["chalk-install"]["depends"] == ["brew-install"]
assert "chalk version" in config["tasks"]["chalk-install"]["run"]
print("mise Chalk configuration valid")
PY
zsh -n zsh/.zshrc
mise tasks | grep -F 'chalk-install'
git diff --check -- mise.toml zsh/.zshrc
```

Expected:

```text
mise Chalk configuration valid
chalk-install  Install or update the Chalk CLI
```

`zsh -n` and `git diff --check` produce no output and exit zero.

- [ ] **Step 7: Commit the managed installation**

```bash
cd ~/Repositories/dotfiles
git add mise.toml zsh/.zshrc
git commit \
  -m "feat(chalk): manage Chalk CLI installation" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 2: Bridge Chalk Personal Credentials to MCP

**Files:**

- Create: `pi/.pi/agent/bin/chalk-mcp`
- Create: `tests/chalk-mcp-test.sh`
- Modify: `pi/.pi/agent/mcp.json:30-34`

- [ ] **Step 1: Write the failing wrapper test**

Create `tests/chalk-mcp-test.sh`:

```sh
#!/bin/sh
set -eu

repo=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
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
case "${FAKE_CHALK_MODE:-ok}" in
    unauthenticated)
        exit 1
        ;;
    missing-secret)
        printf '%s\n' \
            '{"clientId":"personal-id","apiServer":"https://api.chalk.ai"}'
        ;;
    ok)
        printf '%s\n' \
            '{"clientId":"personal-id","clientSecret":"personal-secret",'\
'"apiServer":"https://api.chalk.ai/"}'
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
grep -F 'arg=X-Chalk-Client-Id: ${CHALK_CLIENT_ID}' \
    "$capture" >/dev/null
grep -F 'arg=X-Chalk-Client-Secret: ${CHALK_CLIENT_SECRET}' \
    "$capture" >/dev/null
if grep -F 'arg=X-Chalk-Client-Secret: personal-secret' \
    "$capture" >/dev/null; then
    fail "secret was expanded into a process argument"
fi

printf '%s\n' "chalk-mcp wrapper tests passed"
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd ~/Repositories/dotfiles
sh tests/chalk-mcp-test.sh
```

Expected: FAIL because `pi/.pi/agent/bin/chalk-mcp` does not exist.

- [ ] **Step 3: Create the credential-safe wrapper**

Create `pi/.pi/agent/bin/chalk-mcp`:

```sh
#!/bin/sh
set -eu

chalk_bin="${CHALK_INSTALL:-$HOME/.chalk}/bin/chalk"
if [ ! -x "$chalk_bin" ]; then
    echo "Chalk CLI is not installed; run mise run chalk-install." >&2
    exit 1
fi

if ! chalk_config=$(
    "$chalk_bin" config --format json 2>/dev/null
); then
    echo "Chalk CLI is not authenticated; run chalk login." >&2
    exit 1
fi

config_value() {
    field=$1
    value=$(printf '%s' "$chalk_config" | jq -er \
        --arg field "$field" \
        '.[$field] | select(type == "string" and length > 0)' \
        2>/dev/null) || {
        echo "Chalk config is missing $field; run chalk login." >&2
        exit 1
    }
    printf '%s' "$value"
}

CHALK_CLIENT_ID=$(config_value clientId)
CHALK_CLIENT_SECRET=$(config_value clientSecret)
CHALK_API_SERVER=$(config_value apiServer)
CHALK_API_SERVER=${CHALK_API_SERVER%/}
export CHALK_CLIENT_ID CHALK_CLIENT_SECRET

exec npx -y mcp-remote@0.1.38 \
    "$CHALK_API_SERVER/v1/mcp/sse" \
    --header 'X-Chalk-Client-Id: ${CHALK_CLIENT_ID}' \
    --header 'X-Chalk-Client-Secret: ${CHALK_CLIENT_SECRET}'
```

Make both scripts executable:

```bash
cd ~/Repositories/dotfiles
chmod +x pi/.pi/agent/bin/chalk-mcp tests/chalk-mcp-test.sh
```

- [ ] **Step 4: Run the wrapper test to verify it passes**

Run:

```bash
cd ~/Repositories/dotfiles
sh tests/chalk-mcp-test.sh
```

Expected:

```text
chalk-mcp wrapper tests passed
```

- [ ] **Step 5: Replace incompatible OAuth with the wrapper**

Replace the `chalk` block in `pi/.pi/agent/mcp.json` with:

```json
"chalk": {
  "command": "sh",
  "args": [
    "-lc",
    "exec \"$HOME/.pi/agent/bin/chalk-mcp\""
  ],
  "lifecycle": "lazy"
}
```

Do not add `directTools`; Chalk remains behind the MCP proxy.

- [ ] **Step 6: Validate the MCP configuration and scripts**

Run:

```bash
cd ~/Repositories/dotfiles
jq -e '
  .mcpServers.chalk.command == "sh" and
  .mcpServers.chalk.args == [
    "-lc",
    "exec \"$HOME/.pi/agent/bin/chalk-mcp\""
  ] and
  .mcpServers.chalk.lifecycle == "lazy" and
  (.mcpServers.chalk | has("auth") | not) and
  (.mcpServers.chalk | has("directTools") | not)
' pi/.pi/agent/mcp.json
sh -n pi/.pi/agent/bin/chalk-mcp
sh -n tests/chalk-mcp-test.sh
sh tests/chalk-mcp-test.sh
git diff --check -- \
  pi/.pi/agent/bin/chalk-mcp \
  pi/.pi/agent/mcp.json \
  tests/chalk-mcp-test.sh
```

Expected: jq prints `true`, syntax checks are silent, and the test prints:

```text
chalk-mcp wrapper tests passed
```

- [ ] **Step 7: Commit the MCP bridge**

```bash
cd ~/Repositories/dotfiles
git add \
  pi/.pi/agent/bin/chalk-mcp \
  pi/.pi/agent/mcp.json \
  tests/chalk-mcp-test.sh
git commit \
  -m "feat(pi): bridge Chalk MCP through CLI auth" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 3: Document Chalk Setup and Recovery

**Files:**

- Modify: `README.md:35-70`
- Modify: `README.md:87-115`

- [ ] **Step 1: Prove Chalk instructions are absent**

Run:

```bash
cd ~/Repositories/dotfiles
! grep -F 'chalk login' README.md
! grep -F 'mise run chalk-install' README.md
```

Expected: both negated checks exit successfully.

- [ ] **Step 2: Update fresh-machine bootstrap instructions**

Replace steps 4 through 8 in `README.md` with:

```markdown
# 4. Install packages needed for authentication, including 1Password CLI
mise run brew-install

# 5. Authenticate 1Password CLI (open 1Password desktop app first)
op account add

# 6. Run the managed bootstrap, including Chalk CLI installation
mise run bootstrap

# 7. Authenticate Chalk through the browser with the work Google account
chalk login

# 8. Open a new shell, then create ~/.zshrc.local with machine-specific secrets
# 9. Copy snowflake/.snowflake/connections.toml.example to
#    ~/.snowflake/connections.toml and verify with:
#    snow connection test -c default
```

Replace the note below the block with:

```markdown
> On subsequent runs, `mise run bootstrap` updates managed packages, including
> the Chalk CLI. It requires 1Password to be authenticated. Chalk login state
> remains in `~/.config/chalk.yml`.
```

- [ ] **Step 3: Add daily and troubleshooting commands**

Add this command near `snowflake-ai-kit-install` in Daily Commands:

```bash
mise run chalk-install  # install/update Chalk CLI without full bootstrap
```

Add this subsection before Machine-Specific Secrets:

````markdown
## Chalk and Pi

Pi reaches Chalk through the hosted MCP server using personal credentials from
the Chalk CLI. Authenticate once after installation:

```bash
chalk login
```

If Pi reports that Chalk is not installed, run:

```bash
mise run chalk-install
```

If Pi reports that Chalk is not authenticated, rerun `chalk login`, restart Pi,
and reconnect the `chalk` MCP server. Credentials remain in
`~/.config/chalk.yml` and must not be copied into this repository.
````

- [ ] **Step 4: Validate documentation**

Run:

```bash
cd ~/Repositories/dotfiles
markdownlint README.md \
  docs/superpowers/specs/2026-07-20-chalk-pi-integration-design.md \
  docs/superpowers/plans/2026-07-20-chalk-pi-integration.md
grep -F 'mise run bootstrap' README.md
grep -F 'chalk login' README.md
grep -F 'mise run chalk-install' README.md
git diff --check -- README.md
```

Expected: markdownlint and `git diff --check` are silent. Each grep prints at
least one matching line.

- [ ] **Step 5: Commit documentation**

```bash
cd ~/Repositories/dotfiles
git add README.md
git commit \
  -m "docs(chalk): document Pi setup" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 4: Install, Authenticate, and Verify End to End

**Files:**

- Verify only; no tracked file changes expected.

- [ ] **Step 1: Record the managed Zsh configuration checksum**

Run:

```bash
cd ~/Repositories/dotfiles
before=$(shasum zsh/.zshrc | awk '{print $1}')
printf '%s\n' "$before" > /tmp/chalk-zshrc-before
```

Expected: `/tmp/chalk-zshrc-before` contains one checksum.

- [ ] **Step 2: Run the managed Chalk installer**

Run:

```bash
cd ~/Repositories/dotfiles
mise run chalk-install
chalk version
```

Expected: Chalk reports a successful installation under `~/.chalk` and prints
its version.

- [ ] **Step 3: Confirm the installer did not modify managed shell config**

Run:

```bash
cd ~/Repositories/dotfiles
after=$(shasum zsh/.zshrc | awk '{print $1}')
test "$after" = "$(cat /tmp/chalk-zshrc-before)"
git diff --exit-code -- zsh/.zshrc
```

Expected: both commands exit zero with no output.

- [ ] **Step 4: Authenticate interactively**

Run:

```bash
chalk login
```

Expected: the browser opens, Google SSO completes, and the CLI reports a
created session. Do not print `~/.config/chalk.yml`.

- [ ] **Step 5: Verify credential fields without displaying values**

Run:

```bash
chalk config --format json | jq -e '
  (.clientId | type == "string" and length > 0) and
  (.clientSecret | type == "string" and length > 0) and
  (.apiServer | type == "string" and length > 0)
' >/dev/null
printf '%s\n' "Chalk CLI credentials are configured"
```

Expected:

```text
Chalk CLI credentials are configured
```

- [ ] **Step 6: Re-run static and wrapper checks**

Run:

```bash
cd ~/Repositories/dotfiles
python3 -c \
  'import tomllib; tomllib.load(open("mise.toml", "rb"))'
jq empty pi/.pi/agent/mcp.json
zsh -n zsh/.zshrc
sh -n pi/.pi/agent/bin/chalk-mcp
sh tests/chalk-mcp-test.sh
git diff --check
```

Expected: all commands exit zero. The wrapper test prints:

```text
chalk-mcp wrapper tests passed
```

- [ ] **Step 7: Reload Pi and connect Chalk**

Restart Pi or run `/reload`, then invoke:

```text
/mcp reconnect chalk
```

Expected: the `chalk` server connects without opening the incompatible MCP
OAuth callback flow.

- [ ] **Step 8: Perform a read-only MCP discovery call**

In Pi, list the Chalk server tools, then call Chalk's feature-listing metadata
tool without mutation.

Expected: Pi receives authorized Chalk metadata through the MCP proxy. If the
server exposes a differently named read-only listing tool, inspect its tool
list and choose the read-only feature or environment listing operation.

- [ ] **Step 9: Run repository health checks**

Run:

```bash
cd ~/Repositories/dotfiles
mise run doctor
```

Expected: every check reports `ok`, ending with:

```text
dotfiles doctor passed
```

- [ ] **Step 10: Confirm only unrelated pre-existing changes remain**

Run:

```bash
cd ~/Repositories/dotfiles
git status --short
git log --oneline -4
```

Expected: implementation files are clean. Pre-existing changes to
`pi/.pi/agent/memory/PROJECTS.md` and `pi/.pi/agent/memory/USER.md` remain
uncommitted and untouched. The recent history contains the design, plan, and
three implementation commits.
