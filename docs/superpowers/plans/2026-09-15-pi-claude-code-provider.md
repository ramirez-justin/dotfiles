# Pi Claude Code Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom Claude planner with the unpinned Claude provider
package and pilot Claude Sonnet for the read-only Researcher agent.

**Architecture:** Pi loads the provider as a normal package while retaining
OpenAI as the interactive default. Agent frontmatter declares the mixed routing
matrix, and `mise run check-agent-tiers` validates package sources, exact agent
routes, thinking levels, defaults, and offline model availability.

**Tech Stack:** Pi 0.85.1 package configuration, Mise tasks, Python 3 standard
library, Markdown agent definitions, Claude Code 2.1.272.

---

## File Map

- Modify `pi/.pi/agent/settings.json` to unpin Superpowers and add the unpinned
  Claude provider package.
- Modify `pi/.pi/agent/agents/researcher.md` to route Researcher through Claude
  Sonnet at high thinking.
- Modify `pi/.pi/agent/AGENTS.md` to describe the mixed routing policy.
- Modify `pi/.pi/agent/memory/WORKFLOWS.md` to keep durable workflow guidance
  consistent with the agent definitions.
- Modify `mise.toml` to enforce the complete routing matrix and configured
  package sources.
- Delete the four tracked files under
  `pi/.pi/agent/extensions/claude-code-planner/`.
- Delete this task's design and plan documents after final verification.

The unrelated working-tree change in `claude/.claude/settings.json` is outside
scope and must not be staged, edited, restored, or committed.

### Task 1: Strengthen Agent Routing Validation

**Files:**

- Modify: `mise.toml:55-149`
- Verify: `pi/.pi/agent/agents/*.md`
- Verify: `pi/.pi/agent/settings.json`

- [ ] **Step 1: Replace the permissive tier check with an exact matrix check**

Replace the body of `[tasks.check-agent-tiers]` with a Python-backed check that
uses only the standard library:

```toml
[tasks.check-agent-tiers]
description = "Verify Pi agent models, reasoning levels, and defaults"
run = """
set -e
cd {{config_root}}
python3 - <<'PY'
import json
import pathlib
import subprocess
import sys

root = pathlib.Path.cwd()
agents = root / "pi/.pi/agent/agents"
settings_path = root / "pi/.pi/agent/settings.json"

expected = {
    "AstraPlan.md": ("openai-codex/gpt-6-astra", "max"),
    "Explore.md": ("openai-codex/gpt-5.6-luna", "max"),
    "implementer.md": ("openai-codex/gpt-6-astra", "low"),
    "oracle.md": ("openai-codex/gpt-5.6-terra", "max"),
    "Plan.md": ("openai-codex/gpt-5.6-terra", "max"),
    "researcher.md": (
        "pi-claude-code-provider/sonnet",
        "high",
    ),
    "reviewer.md": ("openai-codex/gpt-5.6-terra", "max"),
    "verifier.md": ("openai-codex/gpt-5.6-luna", "max"),
    "worker.md": ("openai-codex/gpt-5.6-sol", "medium"),
}


def frontmatter(path):
    text = path.read_text()
    parts = text.split("---", 2)
    if len(parts) != 3:
        raise ValueError(f"{path}: missing YAML frontmatter")
    values = {}
    for line in parts[1].splitlines():
        if ": " in line:
            key, value = line.split(": ", 1)
            values[key] = value
    return values


errors = []
for name, (model, thinking) in expected.items():
    path = agents / name
    if not path.is_file():
        errors.append(f"missing required agent: {path}")
        continue
    values = frontmatter(path)
    if values.get("model") != model:
        errors.append(
            f"{path}: expected model {model}, got "
            f"{values.get('model')}"
        )
    if values.get("thinking") != thinking:
        errors.append(
            f"{path}: expected thinking {thinking}, got "
            f"{values.get('thinking')}"
        )

actual_files = {path.name for path in agents.glob("*.md")}
extra_files = sorted(actual_files - set(expected))
if extra_files:
    errors.append(f"unvalidated agent definitions: {extra_files}")

settings = json.loads(settings_path.read_text())
sources = [
    item if isinstance(item, str) else item.get("source")
    for item in settings.get("packages", [])
]
required_sources = {
    "git:https://github.com/obra/superpowers.git",
    "npm:pi-claude-code-provider",
}
for source in sorted(required_sources):
    if source not in sources:
        errors.append(f"{settings_path}: missing package {source}")

for source in sources:
    if source and source.startswith(
        "git:https://github.com/obra/superpowers.git@"
    ):
        errors.append(f"{settings_path}: Superpowers must be unpinned")
    if source and source.startswith("npm:pi-claude-code-provider@"):
        errors.append(f"{settings_path}: Claude provider must be unpinned")

required_defaults = {
    "defaultProvider": "openai-codex",
    "defaultModel": "gpt-5.6-sol",
    "defaultThinkingLevel": "medium",
}
for key, value in required_defaults.items():
    if settings.get(key) != value:
        errors.append(
            f"{settings_path}: expected {key}={value}, got "
            f"{settings.get(key)}"
        )

if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)

result = subprocess.run(
    ["mise", "exec", "--", "pi", "--offline", "--list-models"],
    check=True,
    capture_output=True,
    text=True,
)
catalog = {
    (parts[0], parts[1])
    for line in result.stdout.splitlines()
    if len(parts := line.split()) >= 2
}
for model, _thinking in expected.values():
    provider, model_id = model.split("/", 1)
    if (provider, model_id) not in catalog:
        errors.append(f"Pi model catalog does not contain {model}")

if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)

print("Pi agent models and defaults verified")
PY
"""
```

- [ ] **Step 2: Run the strengthened check and confirm it fails first**

Run:

```bash
mise run check-agent-tiers
```

Expected: FAIL because `researcher.md` still selects Terra, the provider package
is absent, and Superpowers is still pinned.

- [ ] **Step 3: Inspect the failure for scope accuracy**

Confirm that every reported failure corresponds to one of the approved changes.
Do not weaken the check to accommodate the current configuration.

### Task 2: Configure the Provider and Mixed Routing

**Files:**

- Modify: `pi/.pi/agent/settings.json`
- Modify: `pi/.pi/agent/agents/researcher.md:1-8`
- Modify: `pi/.pi/agent/AGENTS.md:57-87`
- Modify: `pi/.pi/agent/memory/WORKFLOWS.md:19-36`
- Delete: `pi/.pi/agent/extensions/claude-code-planner/index.ts`
- Delete: `pi/.pi/agent/extensions/claude-code-planner/index.test.ts`
- Delete: `pi/.pi/agent/extensions/claude-code-planner/pty-runner.py`
- Delete: `pi/.pi/agent/extensions/claude-code-planner/stop-hook.mjs`

- [ ] **Step 1: Update the Pi package sources**

In `pi/.pi/agent/settings.json`, change the Superpowers source to:

```json
"source": "git:https://github.com/obra/superpowers.git"
```

Add the provider alongside the other unpinned npm packages:

```json
"npm:pi-claude-code-provider"
```

Do not change `defaultProvider`, `defaultModel`, or
`defaultThinkingLevel`.

- [ ] **Step 2: Route Researcher through Claude Sonnet**

Change the frontmatter in `pi/.pi/agent/agents/researcher.md` to:

```yaml
---
description: Research agent for current external evidence.
display_name: Researcher (Claude Sonnet)
tools: read, grep, find, bash
model: pi-claude-code-provider/sonnet
thinking: high
max_turns: 24
prompt_mode: append
---
```

Keep the Researcher prompt body unchanged.

- [ ] **Step 3: Update user-level routing instructions**

In `pi/.pi/agent/AGENTS.md`, retain Terra/max for `Plan`, `reviewer`, and
`oracle`, and state that `researcher` uses Claude Sonnet/high. Add one sentence
that explicit per-call model overrides require a task-specific reason and do
not change the default routing matrix.

The resulting routing bullets must say:

```markdown
- Launch `Plan`, `reviewer`, or `oracle` on Terra with max reasoning for
  detailed planning, independent review, or assumption checks.
- Launch `researcher` on Claude Sonnet with high reasoning for current external
  evidence.
```

- [ ] **Step 4: Update durable workflow guidance**

In `pi/.pi/agent/memory/WORKFLOWS.md`, change the subagent convention to state
that Luna and Terra use max reasoning, Researcher uses Claude Sonnet/high, Sol
uses medium reasoning, and Implementer uses Astra/low. Preserve the existing
Astra escalation and single-writer rules.

- [ ] **Step 5: Remove the superseded planner**

Run:

```bash
git rm -- \
  pi/.pi/agent/extensions/claude-code-planner/index.ts \
  pi/.pi/agent/extensions/claude-code-planner/index.test.ts \
  pi/.pi/agent/extensions/claude-code-planner/pty-runner.py \
  pi/.pi/agent/extensions/claude-code-planner/stop-hook.mjs
```

Expected: the four tracked planner files are staged for deletion.

- [ ] **Step 6: Reconcile Pi packages through the supported task**

This command performs networked package updates under `~/.pi/agent/npm` and
updates every unpinned Pi package:

```bash
mise run pi-update
```

Expected: Superpowers advances to its current default ref, the Claude provider
installs, npm audit completes, and the repository worktree gains no generated
package files.

- [ ] **Step 7: Run the routing check again**

Run:

```bash
mise run check-agent-tiers
```

Expected: PASS with `Pi agent models and defaults verified`.

- [ ] **Step 8: Confirm the planner has no remaining references**

Run:

```bash
rg -n \
  'claude-code-planner|claude_code_plan|claude-plan' \
  . \
  --hidden \
  --glob '!**/.git/**' \
  --glob '!docs/superpowers/specs/**' \
  --glob '!docs/superpowers/plans/**'
```

Expected: no matches.

- [ ] **Step 9: Commit the implementation without unrelated settings**

Run:

```bash
git add -- \
  mise.toml \
  pi/.pi/agent/settings.json \
  pi/.pi/agent/agents/researcher.md \
  pi/.pi/agent/AGENTS.md \
  pi/.pi/agent/memory/WORKFLOWS.md \
  pi/.pi/agent/extensions/claude-code-planner
git commit -m "feat(pi): add mixed Claude model routing" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

Expected: `claude/.claude/settings.json` is not staged or committed.

### Task 3: Verify the Integrated Configuration

**Files:**

- Verify: `mise.toml`
- Verify: `pi/.pi/agent/settings.json`
- Verify: `pi/.pi/agent/agents/*.md`
- Verify: `pi/.pi/agent/AGENTS.md`
- Verify: `pi/.pi/agent/memory/WORKFLOWS.md`

- [ ] **Step 1: Validate JSON, whitespace, and Markdown width**

Run:

```bash
python3 -m json.tool pi/.pi/agent/settings.json >/dev/null
git diff --check origin/gametime...HEAD
python3 - <<'PY'
from pathlib import Path

paths = [
    Path("pi/.pi/agent/AGENTS.md"),
    Path("pi/.pi/agent/memory/WORKFLOWS.md"),
    Path("pi/.pi/agent/agents/researcher.md"),
]
for path in paths:
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if len(line) > 80:
            raise SystemExit(f"{path}:{number}: line exceeds 80 columns")
print("JSON, whitespace, and Markdown width verified")
PY
```

Expected: PASS.

- [ ] **Step 2: Verify the exact routing matrix**

Run:

```bash
mise run check-agent-tiers
```

Expected: PASS with `Pi agent models and defaults verified`.

- [ ] **Step 3: Verify the Claude aliases in Pi's offline catalog**

Run:

```bash
mise exec -- pi --offline --list-models | awk '
  $1 == "pi-claude-code-provider" {
    found[$2] = 1
  }
  END {
    for (model in found) print model
    exit !(found["haiku"] && found["sonnet"] &&
      found["opus"] && found["fable"])
  }
'
```

Expected: output contains `haiku`, `sonnet`, `opus`, and `fable`; exit zero.

- [ ] **Step 4: Run the repository doctor**

Run:

```bash
mise run doctor
```

Expected: PASS. If it fails only at the already observed Homebrew bundle check,
record that as unrelated evidence and run the targeted Pi checks separately.
Do not install missing Homebrew packages without explicit approval.

- [ ] **Step 5: Obtain independent verification**

Launch one read-only Verifier agent. Ask it to inspect the final implementation
diff, rerun `mise run check-agent-tiers`, verify offline aliases, confirm no
planner references remain, and confirm the unrelated Claude settings file was
excluded from every task commit.

- [ ] **Step 6: Fix any confirmed blocking findings**

Apply only evidence-backed fixes within the approved scope. Rerun the failed
check and the complete targeted verification set before proceeding.

### Task 4: Remove Temporary Planning Artifacts

**Files:**

- Delete:
  `docs/superpowers/specs/2026-09-15-pi-claude-code-provider-design.md`
- Delete:
  `docs/superpowers/plans/2026-09-15-pi-claude-code-provider.md`

- [ ] **Step 1: Remove the task-specific documents**

Run:

```bash
git rm -- \
  docs/superpowers/specs/2026-09-15-pi-claude-code-provider-design.md \
  docs/superpowers/plans/2026-09-15-pi-claude-code-provider.md
```

- [ ] **Step 2: Commit the cleanup**

Run:

```bash
git commit -m "chore(pi): remove provider planning artifacts" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

- [ ] **Step 3: Review the final branch diff**

Run:

```bash
git diff --check origin/gametime...HEAD
git diff --stat origin/gametime...HEAD
git status --short --branch
```

Expected:

- No design or plan artifact appears in the final diff.
- Only approved provider, routing, validation, instruction, and planner-removal
  changes appear in the committed diff.
- `claude/.claude/settings.json` remains the only unrelated uncommitted path.

- [ ] **Step 4: Prepare the branch for the finishing workflow**

Do not merge or push automatically. Use the finishing workflow to present the
verified branch and integration options to Justin.
