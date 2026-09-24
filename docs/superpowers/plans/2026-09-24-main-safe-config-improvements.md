# Main Safe Configuration Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade personal Sol/Luna routing to GPT-6 and make the Homebrew
portion of `mise run doctor` stable without changing any other behavior.

**Architecture:** Extend the existing Python workflow contract first, then make
minimal declarative changes to Pi settings, three agent definitions, and the
Mise doctor command. Work in the current tree as one writer because this change
builds on uncommitted workflow-parity files that must remain intact.

**Tech Stack:** Pi Markdown agent definitions, JSON, Python `unittest`, TOML,
Mise, Homebrew Bundle.

**Design:**
`docs/superpowers/specs/2026-09-24-main-safe-config-improvements-design.md`

---

### Task 1: Capture the baseline and verify model availability

**Files:**

- Inspect: all staged, unstaged, and untracked files
- Inspect: `mise.lock`
- Inspect: `zsh/.zshrc`

- [ ] **Step 1: Capture the complete dirty-worktree baseline**

```bash
git status --porcelain=v1 -z > /tmp/main-safe-config-status-before

git diff --binary > /tmp/main-safe-config-before.patch
git diff --cached --binary > /tmp/main-safe-config-cached-before.patch

git ls-files --others --exclude-standard -z \
  > /tmp/main-safe-config-untracked-before

shasum -a 256 mise.lock zsh/.zshrc \
  > /tmp/main-safe-config-preserved-hashes
```

Expected: all commands exit zero. The binary patch records every dirty tracked
file exactly; the status and untracked lists record all remaining paths. The two
independent-file hashes match the prior workflow checkpoint:

```text
bc0b969758562085df8ecd4cd68d5b0ab9394690401fcab172ee8ccc5de0a59c  mise.lock
777d4150762173ec0deedc7308b5c89922265a9231930b859c657ef7fbfd6a62  zsh/.zshrc
```

- [ ] **Step 2: Verify GPT-6 aliases before mutation**

```bash
mise exec -- pi --offline --list-models \
  | grep -E '^openai-codex[[:space:]]+gpt-6-(sol|luna)([[:space:]]|$)'
```

Expected: one row for `gpt-6-sol` and one for `gpt-6-luna`. Stop without
changing tracked contract or configuration files if either is absent.

### Task 2: Extend the workflow contract test-first

**Files:**

- Modify: `pi/.pi/agent/tests/test_agent_workflow.py:37-55`
- Modify: `pi/.pi/agent/tests/test_agent_workflow.py:74-150`
- Modify: `pi/.pi/agent/tests/test_agent_workflow.py:181-188`

- [ ] **Step 1: Require the GPT-6 default and role assignments**

After loading settings in `test_package_selection`, add:

```python
self.assertEqual(settings["defaultModel"], "gpt-6-sol")
```

Change only these expected role models in `test_agent_role_contracts`:

```python
"Explore.md": (
    "openai-codex/gpt-6-luna",
```

```python
"verifier.md": (
    "openai-codex/gpt-6-luna",
```

```python
"worker.md": (
    "openai-codex/gpt-6-sol",
```

- [ ] **Step 2: Require the stable doctor behavior**

Append these assertions to `test_mise_workflow_tasks`:

```python
doctor = tasks["doctor"]["run"]
self.assertIn("brew_prefix=$(brew --prefix)", doctor)
self.assertIn(
    'PATH="$brew_prefix/bin:$brew_prefix/sbin:$HOME/.cargo/bin:$PATH"',
    doctor,
)
self.assertIn("HOMEBREW_NO_AUTO_UPDATE=1", doctor)
self.assertIn("brew bundle check --no-upgrade", doctor)
```

- [ ] **Step 3: Run the contract and verify it fails for the intended gaps**

```bash
python3 pi/.pi/agent/tests/test_agent_workflow.py -v
```

Expected: failure because `settings.json` still selects `gpt-5.6-sol`, role
frontmatter still selects GPT-5.6 Sol/Luna, and doctor lacks the two stable Brew
markers. There must be no import or syntax failure.

### Task 3: Update personal Sol/Luna routing

**Files:**

- Modify: `pi/.pi/agent/settings.json:4`
- Modify: `pi/.pi/agent/agents/Explore.md:5`
- Modify: `pi/.pi/agent/agents/verifier.md:5`
- Modify: `pi/.pi/agent/agents/worker.md:5`
- Test: `pi/.pi/agent/tests/test_agent_workflow.py`

- [ ] **Step 1: Change the personal default**

In `settings.json`, set:

```json
"defaultModel": "gpt-6-sol"
```

- [ ] **Step 2: Change the three role models**

Use these exact frontmatter values:

```yaml
# Explore.md and verifier.md
model: openai-codex/gpt-6-luna
```

```yaml
# worker.md
model: openai-codex/gpt-6-sol
```

Preserve Oracle on GPT-6 Astra and correct its label:

```yaml
# oracle.md
display_name: Oracle (Astra)
model: openai-codex/gpt-6-astra
```

Do not change Plan, reviewer, simplifier, AstraPlan, implementer, researcher,
thinking, tool, isolation, or turn-limit settings.

- [ ] **Step 3: Run the focused contract tests**

```bash
python3 -m unittest \
  pi/.pi/agent/tests/test_agent_workflow.py \
  -v
```

Expected: model assertions pass; the doctor assertions remain failing until
Task 4.

### Task 4: Stabilize the Homebrew doctor check

**Files:**

- Modify: `mise.toml:41`
- Test: `pi/.pi/agent/tests/test_agent_workflow.py`

- [ ] **Step 1: Replace only the Brewfile doctor invocation**

Replace:

```toml
check "brew bundle" brew bundle check --file={{config_root}}/Brewfile
```

with:

```toml
check "brew bundle" sh -c '
brew_prefix=$(brew --prefix)
PATH="$brew_prefix/bin:$brew_prefix/sbin:$HOME/.cargo/bin:$PATH"
export PATH
export HOMEBREW_NO_AUTO_UPDATE=1
brew bundle check --no-upgrade --file="$1"
' sh {{config_root}}/Brewfile
```

Leave every other doctor check unchanged.

- [ ] **Step 2: Run the complete workflow contract**

```bash
python3 pi/.pi/agent/tests/test_agent_workflow.py -v
```

Expected: all seven tests pass.

- [ ] **Step 3: Validate and run Mise tasks**

```bash
mise tasks validate
mise run check-agent-tiers
mise run doctor
```

Expected: all commands exit zero. Doctor must report `brew bundle ok`, agent
model tiers, Pi startup, symlinks, and the remaining personal checks as `ok`.

### Task 5: Verify scope and commit logical groups

**Files:**

- Verify: all changed files
- Commit: Pi workflow files as one group
- Commit: Mise workflow files as one group
- Commit: preserved independent changes as separate groups

- [ ] **Step 1: Run final static and runtime checks**

```bash
ruff check pi/.pi/agent/tests/test_agent_workflow.py
git diff --check
python3 pi/.pi/agent/tests/test_agent_workflow.py -v
mise tasks validate
mise run check-agent-tiers
mise run doctor
mise exec -- pi --offline --list-models \
  | grep -E '^openai-codex[[:space:]]+gpt-6-(sol|luna)([[:space:]]|$)'
```

Expected: every command exits zero, seven contract tests pass, and both GPT-6
aliases are listed.

- [ ] **Step 2: Run source diagnostics**

Run primary TypeScript LSP diagnostics for:

```text
pi/.pi/agent/extensions/session-status.ts
pi/.pi/agent/extensions/stop-notification.ts
```

Then run pi-lens session diagnostics for every edited file.

Expected: zero blocking errors or warnings introduced by this work.

- [ ] **Step 3: Prove prior dirty work remains represented**

```bash
shasum -a 256 mise.lock zsh/.zshrc
git status --short
git diff --stat
```

Expected: `mise.lock` and `zsh/.zshrc` match the hashes captured in Task 1.
Inspect the complete diff against `/tmp/main-safe-config-before.patch` and
confirm that only the approved GPT-6 routing, test assertions, and doctor
stabilization were added to the prior working state.

- [ ] **Step 4: Commit the Pi workflow group**

```bash
git add \
  pi/.pi/agent/AGENTS.md \
  pi/.pi/agent/agents \
  pi/.pi/agent/extensions/session-status.ts \
  pi/.pi/agent/extensions/stop-notification.ts \
  pi/.pi/agent/prompts \
  pi/.pi/agent/settings.json \
  pi/.pi/agent/skills/ai-docs-maintenance \
  pi/.pi/agent/skills/executing-plans \
  pi/.pi/agent/skills/orchestration \
  pi/.pi/agent/skills/ponytail-review \
  pi/.pi/agent/skills/skill-creation \
  pi/.pi/agent/skills/writing-plans \
  pi/.pi/agent/subagents.json \
  pi/.pi/agent/tests/test_agent_workflow.py

git commit -m "feat(pi): add model-tiered agent workflow"
```

Expected: one commit containing the complete personal Pi workflow and GPT-6
routing, with no Mise, lockfile, shell, or work-only files.

- [ ] **Step 5: Commit the Mise workflow group**

```bash
git add mise.toml
git commit -m "feat(mise): improve agent workflow tasks"
```

Expected: one commit containing link/update/check-agent behavior and the stable
doctor check.

- [ ] **Step 6: Commit preserved independent changes**

```bash
git add mise.lock
git commit -m "chore(mise): refresh tool lock"

git add zsh/.zshrc
git commit -m "chore(zsh): enable Terragrunt provider cache"
```

Expected: each pre-existing change is isolated in its own Conventional Commit.

- [ ] **Step 7: Commit this implementation plan**

```bash
git add docs/superpowers/plans/2026-09-24-main-safe-config-improvements.md
git commit -m "docs: plan safe main config improvements"
```

Expected: the plan is committed separately from runtime configuration.

- [ ] **Step 8: Verify the final repository state**

```bash
git status --short
git log --oneline -6
python3 pi/.pi/agent/tests/test_agent_workflow.py -q
mise run doctor
```

Expected: the worktree is clean, the logical commits are present, tests pass,
and doctor exits zero.
