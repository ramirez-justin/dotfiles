# Runtime 1Password Secret Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace persisted plaintext agent credentials with runtime 1Password
resolution for Claude and Jira MCP.

**Architecture:** A reference-only dotenv file is linked into the Pi agent
directory. A focused Zsh helper launches the real Claude executable via
`op run`; Jira MCP resolves only its own token when it starts. Tests use a
temporary home directory and stub executables, so no real secret is read.

**Tech Stack:** Zsh, Bash, Python 3 standard library, jq, 1Password CLI,
ShellCheck, Trivy

---

### Task 1: Add failing reference-file and Claude-wrapper tests

**Files:**
- Create: `zsh/.zsh/tests/test-agent-secrets.zsh`
- Test: `zsh/.zsh/tests/test-agent-secrets.zsh`

- [ ] **Step 1: Write the failing test**

Create an executable Zsh test that uses a temporary home and stub executables:

```zsh
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

if grep -Ev '^([A-Z_]+)=op://[^[:space:]]+$' "$REFERENCES"; then
    print -u2 "reference file contains a non-reference value"
    exit 1
fi
[[ "$(wc -l <"$REFERENCES" | tr -d ' ')" == "3" ]]

rm "$HOME/.pi/agent/agent-secrets.env"
if claude should-not-run; then
    print -u2 "Claude started without the reference file"
    exit 1
fi
```

- [ ] **Step 2: Make the test executable**

```bash
chmod +x zsh/.zsh/tests/test-agent-secrets.zsh
```

- [ ] **Step 3: Run the test and verify RED**

```bash
zsh/.zsh/tests/test-agent-secrets.zsh
```

Expected: FAIL because `agent-secrets.zsh` and `agent-secrets.env` do not exist.

- [ ] **Step 4: Commit the failing test**

```bash
git add zsh/.zsh/tests/test-agent-secrets.zsh
git commit -m "test(zsh): specify runtime agent secrets" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 2: Implement the reference file and fail-closed Claude wrapper

**Files:**
- Create: `pi/.pi/agent/agent-secrets.env`
- Create: `zsh/.zsh/agent-secrets.zsh`
- Modify: `zsh/.zshrc:31-37`
- Test: `zsh/.zsh/tests/test-agent-secrets.zsh`

- [ ] **Step 1: Create the reference-only environment file**

```dotenv
JIRA_API_TOKEN=op://Employee/JRamirez Atlassian API Token/API token
FIVETRAN_API_KEY=op://Employee/JRamirez Fivetran API Key/username
FIVETRAN_API_SECRET=op://Employee/JRamirez Fivetran API Key/password
```

- [ ] **Step 2: Create the Zsh helper**

Create `zsh/.zsh/agent-secrets.zsh`:

```zsh
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
```

- [ ] **Step 3: Source the helper from `.zshrc`**

Replace the direct Pi environment sourcing block with:

```zsh
# Runtime secret resolution for Claude; Pi receives no agent API secrets.
[[ -f "$HOME/.zsh/agent-secrets.zsh" ]] &&
    source "$HOME/.zsh/agent-secrets.zsh"
# Pi requires Node 22+ and extensions with native modules are installed there.
# Run Pi with the same Node ABI to avoid native module mismatch errors.
pi() { mise exec node@22.19.0 -- command pi "$@" }
```

- [ ] **Step 4: Run the test and verify GREEN**

```bash
zsh/.zsh/tests/test-agent-secrets.zsh
zsh -n zsh/.zsh/agent-secrets.zsh zsh/.zshrc
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the wrapper implementation**

```bash
git add pi/.pi/agent/agent-secrets.env zsh/.zsh/agent-secrets.zsh \
  zsh/.zshrc
git commit -m "feat(secrets): resolve Claude credentials at runtime" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 3: Add failing configuration-policy tests

**Files:**
- Create: `pi/.pi/agent/tests/test-runtime-secrets.py`
- Test: `pi/.pi/agent/tests/test-runtime-secrets.py`

- [ ] **Step 1: Write the failing Python test**

Create a standard-library `unittest` module with these assertions:

```python
import json
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).parents[4]


class RuntimeSecretsConfigTests(unittest.TestCase):
    def test_jira_mcp_resolves_its_token_at_startup(self):
        config = json.loads(
            (REPO_ROOT / "pi/.pi/agent/mcp.json").read_text()
        )
        command = config["mcpServers"]["jira"]["args"][1]
        launcher = (REPO_ROOT / "pi/.pi/agent/bin/jira-mcp").read_text()
        self.assertIn("jira-mcp", command)
        self.assertIn("op read", launcher)
        self.assertIn("JIRA_API_TOKEN", launcher)
        self.assertNotIn(
            "${JIRA_API_TOKEN}", json.dumps(config["mcpServers"]["jira"])
        )

    def test_claude_settings_do_not_override_runtime_secrets(self):
        settings = json.loads(
            (REPO_ROOT / "claude/.claude/settings.json").read_text()
        )
        environment = settings["env"]
        self.assertNotIn("JIRA_API_TOKEN", environment)
        self.assertNotIn("FIVETRAN_API_KEY", environment)
        self.assertNotIn("FIVETRAN_API_SECRET", environment)

    def test_pi_environment_does_not_source_plaintext_secrets(self):
        environment = (
            REPO_ROOT / "pi/.pi/agent/env.zsh"
        ).read_text()
        self.assertNotIn("env.local.zsh", environment)
        self.assertNotIn("JIRA_API_TOKEN", environment)

    def test_bootstrap_does_not_inject_plaintext_secrets(self):
        mise = (REPO_ROOT / "mise.toml").read_text()
        readme = (REPO_ROOT / "README.md").read_text()
        self.assertNotIn("inject-secrets", mise)
        self.assertNotIn("inject-secrets", readme)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test and verify RED**

```bash
python3 -m unittest discover \
  -s pi/.pi/agent/tests \
  -p 'test-runtime-secrets.py' -v
```

Expected: FAIL because the Jira command and legacy settings are unchanged.

- [ ] **Step 3: Commit the failing policy tests**

```bash
git add pi/.pi/agent/tests/test-runtime-secrets.py
git commit -m "test(secrets): specify runtime configuration policy" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 4: Restrict Jira MCP and remove legacy injection

**Files:**
- Create: `pi/.pi/agent/bin/jira-mcp`
- Modify: `pi/.pi/agent/mcp.json:30-40`
- Modify: `pi/.pi/agent/env.zsh:1-16`
- Modify: `claude/.claude/settings.json:2-13`
- Modify: `mise.toml:8-16,106-127,257-300`
- Modify: `README.md:90-103`
- Test: `pi/.pi/agent/tests/test-runtime-secrets.py`

- [ ] **Step 1: Add a lazy Jira MCP launcher**

Create executable `pi/.pi/agent/bin/jira-mcp`:

```sh
#!/bin/sh
set -eu

token_ref='op://Employee/JRamirez Atlassian API Token/API token'
JIRA_API_TOKEN=$(op read "$token_ref")
export JIRA_API_TOKEN
exec uvx mcp-atlassian --transport stdio
```

Replace the Jira server command configuration with:

```json
"jira": {
  "command": "sh",
  "args": ["-lc", "exec \"$HOME/.pi/agent/bin/jira-mcp\""],
  "env": {
    "JIRA_URL": "https://${JIRA_HOST}",
    "JIRA_USERNAME": "${JIRA_EMAIL}",
    "TOOLSETS": "all"
  },
  "lifecycle": "lazy"
}
```

- [ ] **Step 2: Remove agent secret injection and plaintext sourcing**

Make `pi/.pi/agent/env.zsh` contain only stable non-secret settings:

```zsh
# Environment shared with Pi sessions.
export JIRA_HOST="gametime.atlassian.net"
export JIRA_EMAIL="justin.ramirez@gametime.co"

# Keep both spellings for tools/plugins that check either variable.
export ENABLE_LSP_TOOL="1"
export ENABLE_LSP_TOOLS="1"
```

Remove `inject-secrets` from `bootstrap.depends`, delete its whole task from
`mise.toml`, and replace the doctor checks for legacy modes with:

```sh
check "no legacy Pi secret file" \
    sh -c '[ ! -e "$HOME/.pi/agent/env.local.zsh" ]'
check "no legacy Claude secret file" \
    sh -c '[ ! -e "$HOME/.claude/settings.local.json" ]'
```

- [ ] **Step 3: Remove Claude secret-key overrides**

Delete only these keys from `claude/.claude/settings.json`:

```json
"JIRA_API_TOKEN": "",
"FIVETRAN_API_KEY": "",
"FIVETRAN_API_SECRET": "",
```

Retain host, email, URL, username, group ID, and LSP settings.

- [ ] **Step 4: Update the README**

Remove `mise run inject-secrets` and its optional Notion reference instructions.
Replace the bootstrap note with:

```markdown
Agent credentials resolve from 1Password when Claude or Jira MCP starts.
Authenticate `op` before launching either tool.
```

- [ ] **Step 5: Run tests and config validation**

```bash
python3 -m unittest discover \
  -s pi/.pi/agent/tests \
  -p 'test-runtime-secrets.py' -v
python3 -m json.tool pi/.pi/agent/mcp.json >/dev/null
python3 -m json.tool claude/.claude/settings.json >/dev/null
python3 - <<'PY'
import pathlib
import tomllib

tomllib.loads(pathlib.Path("mise.toml").read_text())
PY
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit policy and configuration changes**

```bash
git add pi/.pi/agent/bin/jira-mcp pi/.pi/agent/mcp.json \
  pi/.pi/agent/env.zsh pi/.pi/agent/tests/test-runtime-secrets.py \
  claude/.claude/settings.json mise.toml README.md
git commit -m "fix(secrets): remove persisted agent credentials" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 5: Verify, migrate, and remove planning artifacts

**Files:**
- Delete: `docs/superpowers/specs/2026-07-15-runtime-1password-design.md`
- Delete: `docs/superpowers/plans/2026-07-15-runtime-1password.md`
- External delete: `~/.claude/settings.local.json`
- External delete: `~/.pi/agent/env.local.zsh`

- [ ] **Step 1: Run complete local verification**

```bash
zsh/.zsh/tests/test-agent-secrets.zsh
python3 -m unittest discover \
  -s pi/.pi/agent/tests \
  -p 'test-runtime-secrets.py' -v
zsh -n zsh/.zsh/agent-secrets.zsh zsh/.zshrc pi/.pi/agent/env.zsh
shellcheck tests/chalk-mcp-test.sh
trivy fs --quiet --scanners secret,misconfig .
```

Expected: all commands exit 0; Trivy reports zero secrets and misconfigurations.

- [ ] **Step 2: Link the new configuration and validate prerequisites**

```bash
mise run link
command -v op
command -v claude
[[ -r "$HOME/.pi/agent/agent-secrets.env" ]]
grep -E '^[A-Z_]+=op://' "$HOME/.pi/agent/agent-secrets.env"
```

Expected: `op`, `claude`, and the reference file exist; exactly three reference
lines print and no resolved value is printed.

- [ ] **Step 3: Remove only the verified legacy secret files**

```bash
rm "$HOME/.claude/settings.local.json" \
  "$HOME/.pi/agent/env.local.zsh"
```

- [ ] **Step 4: Run post-migration doctor checks**

```bash
mise run doctor
[[ ! -e "$HOME/.claude/settings.local.json" ]]
[[ ! -e "$HOME/.pi/agent/env.local.zsh" ]]
```

Expected: doctor passes and neither plaintext file exists.

- [ ] **Step 5: Request independent security review**

Request review focused on wrapper recursion, runtime secret scope, 1Password
failure behavior, Jira process arguments, plaintext removal, and test realism.

- [ ] **Step 6: Remove temporary planning artifacts**

```bash
git rm docs/superpowers/specs/2026-07-15-runtime-1password-design.md \
  docs/superpowers/plans/2026-07-15-runtime-1password.md
git commit -m "chore(security): remove runtime secret planning artifacts" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

- [ ] **Step 7: Verify the final branch state**

```bash
git status --short
zsh/.zsh/tests/test-agent-secrets.zsh
python3 -m unittest discover \
  -s pi/.pi/agent/tests \
  -p 'test-runtime-secrets.py' -v
```

Expected: clean worktree, passing tests, and no temporary specification or plan
at the branch tip.
