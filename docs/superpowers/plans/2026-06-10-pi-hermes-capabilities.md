# Pi Hermes-Like Capabilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add personal Pi subagents, explicit durable memory, and an
approval-gated skill creation workflow to dotfiles.

**Architecture:** Use static dotfiles first: Pi package settings, markdown
subagent definitions, local skills, and memory files under the existing `pi/`
stow topic. Do not add a custom extension in this pass; keep behavior easy to
review and revert.

**Tech Stack:** Pi settings JSON, `pi-subagents`, Agent Skills markdown,
GNU Stow via `mise run link`, Python stdlib validation.

---

## File Structure

- Modify `pi/.pi/agent/settings.json`
  - Add `npm:pi-subagents` to packages.
  - Add conservative `subagents.agentOverrides` for builtin roles.
- Create `pi/.pi/agent/agents/implementer.md`
  - Personal mutation-capable implementation child agent.
- Create `pi/.pi/agent/agents/verifier.md`
  - Personal validation child agent that reports evidence.
- Modify `pi/.pi/agent/AGENTS.md`
  - Add a short memory and delegation index.
- Create `pi/.pi/agent/memory/USER.md`
  - Durable user preferences, with explicit no-secret policy.
- Create `pi/.pi/agent/memory/WORKFLOWS.md`
  - Durable workflow conventions.
- Create `pi/.pi/agent/memory/PROJECTS.md`
  - Stable project facts and caveats.
- Create `pi/.pi/agent/skills/memory-management/SKILL.md`
  - Review-gated memory proposal workflow.
- Create `pi/.pi/agent/skills/skill-creation/SKILL.md`
  - Review-gated Pi skill creation workflow.
- Modify `README.md`
  - Document the new Pi workflow commands and files.

## Task 1: Configure pi-subagents

**Files:**

- Modify: `pi/.pi/agent/settings.json`

- [ ] **Step 1: Inspect current settings**

Run:

```bash
python3 -m json.tool pi/.pi/agent/settings.json >/tmp/pi-settings.json
python3 - <<'PY'
import json
from pathlib import Path
settings = json.loads(Path('pi/.pi/agent/settings.json').read_text())
print(settings['packages'])
print(settings.get('subagents'))
PY
```

Expected: command exits 0 and prints the current package list. It may print
`None` for `subagents`.

- [ ] **Step 2: Add package and overrides**

Edit `pi/.pi/agent/settings.json` so the `packages` array includes
`"npm:pi-subagents"` after `"npm:pi-lens"`, and add this top-level
`subagents` object after `env`:

```json
{
  "subagents": {
    "agentOverrides": {
      "researcher": {
        "thinking": "high",
        "inheritProjectContext": true,
        "inheritSkills": false,
        "systemPrompt": "Read-only research. Cite evidence. Do not edit."
      },
      "reviewer": {
        "thinking": "high",
        "inheritProjectContext": true,
        "inheritSkills": false,
        "systemPrompt": "Review correctness and safety. Do not edit."
      },
      "planner": {
        "thinking": "high",
        "inheritProjectContext": true,
        "inheritSkills": true,
        "systemPrompt": "Plan approved requirements. Do not implement."
      }
    },
    "parallel": {
      "maxTasks": 8,
      "concurrency": 4
    },
    "defaultSessionDir": "~/.pi/agent/sessions/subagent/"
  }
}
```

The final file must remain valid JSON. Preserve all existing settings.

- [ ] **Step 3: Validate JSON**

Run:

```bash
python3 -m json.tool pi/.pi/agent/settings.json >/dev/null
```

Expected: exits 0 with no output.

- [ ] **Step 4: Commit subagent package settings**

Run:

```bash
git add pi/.pi/agent/settings.json
git commit -m "feat(pi): configure subagent package" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

Expected: one commit containing only `pi/.pi/agent/settings.json`.

## Task 2: Add personal subagent roles

**Files:**

- Create: `pi/.pi/agent/agents/implementer.md`
- Create: `pi/.pi/agent/agents/verifier.md`

- [ ] **Step 1: Create the agents directory**

Run:

```bash
mkdir -p pi/.pi/agent/agents
```

Expected: directory exists.

- [ ] **Step 2: Create implementer agent**

Create `pi/.pi/agent/agents/implementer.md` with exactly this content:

```markdown
---
name: implementer
description: Focused implementation agent for approved plans and small fixes.
tools: read, bash, edit, write
thinking: high
systemPromptMode: append
inheritProjectContext: true
inheritSkills: true
defaultContext: fork
defaultProgress: true
maxSubagentDepth: 0
---

You are a focused implementation subagent for Justin's Pi setup.

Work only from an approved plan, explicit parent instructions, or a narrow bug
fix request. Prefer the smallest change that satisfies the task. Do not expand
scope, perform unrelated cleanup, or make product decisions silently.

Before editing, identify the exact files you will touch. During implementation,
keep changes isolated. After implementation, run the most relevant lightweight
validation and report exact commands plus outcomes.

If the task requires a decision that is not specified, stop and ask the parent
for guidance instead of guessing.
```

- [ ] **Step 3: Create verifier agent**

Create `pi/.pi/agent/agents/verifier.md` with exactly this content:

```markdown
---
name: verifier
description: Evidence-focused validation agent for completed work.
tools: read, bash
thinking: high
systemPromptMode: append
inheritProjectContext: true
inheritSkills: false
defaultContext: fork
defaultProgress: true
completionGuard: false
maxSubagentDepth: 0
---

You are a validation subagent for Justin's Pi setup.

Do not edit files. Verify claims by running or inspecting concrete evidence.
Prefer fast, targeted checks before broad suites. Report exactly what you ran,
what passed, what failed, and what remains unverified.

If a check is risky, destructive, slow, or requires external credentials, do not
run it. Explain the risk and recommend a safer command or parent decision.
```

- [ ] **Step 4: Validate frontmatter fields**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
for path in [
    Path('pi/.pi/agent/agents/implementer.md'),
    Path('pi/.pi/agent/agents/verifier.md'),
]:
    text = path.read_text()
    assert text.startswith('---\n'), f'{path}: missing frontmatter'
    assert '\nname: ' in text, f'{path}: missing name'
    assert '\ndescription: ' in text, f'{path}: missing description'
print('agent frontmatter ok')
PY
```

Expected: prints `agent frontmatter ok`.

- [ ] **Step 5: Commit personal agent roles**

Run:

```bash
git add pi/.pi/agent/agents/implementer.md \
  pi/.pi/agent/agents/verifier.md
git commit -m "feat(pi): add personal subagent roles" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

Expected: one commit with the two agent files.

## Task 3: Add explicit durable memory files

**Files:**

- Create: `pi/.pi/agent/memory/USER.md`
- Create: `pi/.pi/agent/memory/WORKFLOWS.md`
- Create: `pi/.pi/agent/memory/PROJECTS.md`
- Modify: `pi/.pi/agent/AGENTS.md`

- [ ] **Step 1: Create the memory directory**

Run:

```bash
mkdir -p pi/.pi/agent/memory
```

Expected: directory exists.

- [ ] **Step 2: Create USER memory**

Create `pi/.pi/agent/memory/USER.md` with exactly this content:

```markdown
# User Memory

Durable preferences about Justin. This file is versioned in dotfiles.

## Rules

- Do not store secrets, tokens, private keys, passphrases, or raw credentials.
- Do not store transient session details or one-off mistakes.
- Prefer stable preferences that should affect future sessions.
- Propose changes as diffs and wait for approval before writing.

## Preferences

- Prefer concise responses unless the task requires detail.
- Prefer minimum code that solves the problem.
- Prefer explicit success criteria and verified outcomes.
- Prefer Linear over Jira for new issue-tracking work unless Jira is requested.
```

- [ ] **Step 3: Create workflow memory**

Create `pi/.pi/agent/memory/WORKFLOWS.md` with exactly this content:

```markdown
# Workflow Memory

Durable workflow conventions for Justin's Pi sessions.

## Rules

- Do not store secrets or transient command output.
- Keep entries short, actionable, and easy to review in git diffs.
- Prefer adding automation when a manual command must be remembered.

## Conventions

- Use `/brainstorm` before creative feature or behavior changes.
- Use `/write-plan` for multi-step implementation planning.
- Use `/execute-plan` or subagent-driven execution for approved plans.
- Use `/debug` before fixing unexpected behavior or test failures.
- Use `/finish` before claiming implementation work is complete.
```

- [ ] **Step 4: Create project memory**

Create `pi/.pi/agent/memory/PROJECTS.md` with exactly this content:

```markdown
# Project Memory

Stable project facts and caveats that may help future Pi sessions.

## Rules

- Do not store secrets, internal credentials, or copied private config.
- Store only facts that are likely to remain useful across sessions.
- Remove or update stale facts when projects change.

## Dotfiles

- The dotfiles repository uses GNU Stow topic directories.
- The `pi/` topic maps to `~/.pi/agent`.
- `mise.toml` is the task runner entry point for setup and verification.
- Pi package settings live in `pi/.pi/agent/settings.json`.
```

- [ ] **Step 5: Add a memory index to AGENTS.md**

Append this section to `pi/.pi/agent/AGENTS.md`:

```markdown
## Durable Memory

Reviewable memory files live in `~/.pi/agent/memory/`, backed by this
repository's `pi/.pi/agent/memory/` directory.

- Read `memory/USER.md` when durable user preferences may affect the task.
- Read `memory/WORKFLOWS.md` when choosing a repeatable workflow.
- Read `memory/PROJECTS.md` when stable project facts may affect the task.
- Never write memory without proposing a diff and receiving approval.
- Never store secrets, credentials, tokens, or transient session details.
```

- [ ] **Step 6: Check markdown line lengths**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
paths = [
    Path('pi/.pi/agent/memory/USER.md'),
    Path('pi/.pi/agent/memory/WORKFLOWS.md'),
    Path('pi/.pi/agent/memory/PROJECTS.md'),
    Path('pi/.pi/agent/AGENTS.md'),
]
long = []
for path in paths:
    for index, line in enumerate(path.read_text().splitlines(), 1):
        if len(line) > 80:
            long.append((str(path), index, len(line)))
assert not long, long
print('markdown line lengths ok')
PY
```

Expected: prints `markdown line lengths ok`.

- [ ] **Step 7: Commit durable memory files**

Run:

```bash
git add pi/.pi/agent/AGENTS.md pi/.pi/agent/memory
git commit -m "feat(pi): add explicit durable memory" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

Expected: one commit with memory files and the AGENTS memory index.

## Task 4: Add memory-management skill

**Files:**

- Create: `pi/.pi/agent/skills/memory-management/SKILL.md`

- [ ] **Step 1: Create the skill directory**

Run:

```bash
mkdir -p pi/.pi/agent/skills/memory-management
```

Expected: directory exists.

- [ ] **Step 2: Create memory-management skill**

Create `pi/.pi/agent/skills/memory-management/SKILL.md` with exactly this
content:

```markdown
---
name: memory-management
description: >-
  Propose, review, and apply durable Pi memory updates. Use when the user asks
  to remember something, update memory, forget stale facts, or preserve a
  reusable preference or workflow across sessions.
---

# Memory Management

Use this skill to manage durable memory in Justin's dotfiles-backed Pi setup.

## Memory Files

- `pi/.pi/agent/memory/USER.md` for durable user preferences.
- `pi/.pi/agent/memory/WORKFLOWS.md` for repeatable workflow conventions.
- `pi/.pi/agent/memory/PROJECTS.md` for stable project facts and caveats.

## Process

1. Classify the candidate memory as user preference, workflow, project fact, or
   not worth storing.
2. Reject secrets, credentials, private keys, tokens, transient session details,
   and unverified assumptions.
3. Read the target memory file before proposing a change.
4. Present the exact diff you plan to apply.
5. Wait for explicit user approval before editing.
6. Apply the smallest useful edit.
7. Show the resulting file path and summarize the stored memory.

## Good Memory

Good memory is stable, actionable, and likely to affect future sessions.
Examples:

- Preferred tools or workflows.
- Repeated project caveats.
- Durable communication preferences.
- Explicitly approved rejected approaches.

## Bad Memory

Do not store:

- Secrets or credential material.
- Temporary task state.
- Raw command output.
- Guesses about the user or workplace.
- Anything the user has not approved.
```

- [ ] **Step 3: Validate skill format**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('pi/.pi/agent/skills/memory-management/SKILL.md')
text = p.read_text()
assert text.startswith('---\n')
assert '\nname: memory-management\n' in text
assert '\ndescription:' in text
for bad in ['TB' + 'D', 'TO' + 'DO']:
    assert bad not in text
print('memory-management skill ok')
PY
```

Expected: prints `memory-management skill ok`.

- [ ] **Step 4: Commit memory-management skill**

Run:

```bash
git add pi/.pi/agent/skills/memory-management/SKILL.md
git commit -m "feat(pi): add memory management skill" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

Expected: one commit with the skill file.

## Task 5: Add skill-creation workflow skill

**Files:**

- Create: `pi/.pi/agent/skills/skill-creation/SKILL.md`

- [ ] **Step 1: Create the skill directory**

Run:

```bash
mkdir -p pi/.pi/agent/skills/skill-creation
```

Expected: directory exists.

- [ ] **Step 2: Create skill-creation skill**

Create `pi/.pi/agent/skills/skill-creation/SKILL.md` with exactly this
content:

```markdown
---
name: skill-creation
description: >-
  Create or improve local Pi skills from repeated workflows. Use when the user
  asks Pi to make a skill, automate a repeated agent workflow, or capture a
  reusable procedure as an Agent Skill.
---

# Skill Creation

Use this skill to create focused, reviewable Pi skills in Justin's dotfiles.

## Target Location

Create local skills under:

```text
pi/.pi/agent/skills/<skill-name>/SKILL.md
```

## Process

1. Collect at least one concrete workflow example from the user or repository.
2. Decide whether the right artifact is a skill, prompt, script, or memory note.
3. If a skill is appropriate, choose a lowercase hyphenated name.
4. Draft `SKILL.md` with valid frontmatter and narrow trigger wording.
5. Include only instructions needed for the repeated workflow.
6. Self-review for safety, ambiguity, scope creep, and missing paths.
7. Present the draft and wait for approval before installing it.
8. Install as experimental unless the user asks to make it active immediately.

## Required Frontmatter

```yaml
---
name: example-skill
description: >-
  Specific trigger wording that says when to use the skill and what it does.
---
```

## Quality Bar

A good skill:

- Has one clear purpose.
- Uses narrow trigger language.
- Names exact files, commands, and approval gates.
- Avoids secrets and hidden side effects.
- Says when not to use the skill.
- Can be understood without reading unrelated chat history.

## Validation

After writing a skill, run:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('pi/.pi/agent/skills/<skill-name>/SKILL.md')
text = p.read_text()
assert text.startswith('---\n')
assert '\nname: ' in text
assert '\ndescription:' in text
for bad in ['TB' + 'D', 'TO' + 'DO']:
    assert bad not in text
PY
```

Replace `<skill-name>` with the actual skill directory name before running.
```

- [ ] **Step 3: Validate skill format**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path('pi/.pi/agent/skills/skill-creation/SKILL.md')
text = p.read_text()
assert text.startswith('---\n')
assert '\nname: skill-creation\n' in text
assert '\ndescription:' in text
for bad in ['TB' + 'D', 'TO' + 'DO']:
    assert bad not in text
print('skill-creation skill ok')
PY
```

Expected: prints `skill-creation skill ok`.

- [ ] **Step 4: Commit skill-creation workflow**

Run:

```bash
git add pi/.pi/agent/skills/skill-creation/SKILL.md
git commit -m "feat(pi): add skill creation workflow" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

Expected: one commit with the skill file.

## Task 6: Document and verify the integrated setup

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add README notes**

In `README.md`, under the existing Pi workflow shortcut comments, add this
block:

```markdown
# Pi Hermes-like personal workflows:
# - Subagents: npm:pi-subagents with researcher, reviewer, planner,
#   implementer, and verifier roles.
# - Memory: ~/.pi/agent/memory/*.md, managed through the memory-management
#   skill and explicit approval.
# - Skill creation: use the skill-creation skill to draft local skills under
#   pi/.pi/agent/skills/.
```

Keep markdown lines under 80 characters.

- [ ] **Step 2: Validate all modified structured files**

Run:

```bash
python3 -m json.tool pi/.pi/agent/settings.json >/dev/null
python3 - <<'PY'
import tomllib
with open('mise.toml', 'rb') as f:
    tomllib.load(f)
PY
```

Expected: both commands exit 0.

- [ ] **Step 3: Validate markdown and skill markers**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
paths = [
    *Path('pi/.pi/agent/memory').glob('*.md'),
    *Path('pi/.pi/agent/skills').glob('*/SKILL.md'),
    *Path('pi/.pi/agent/agents').glob('*.md'),
    Path('pi/.pi/agent/AGENTS.md'),
    Path('README.md'),
]
for path in paths:
    text = path.read_text()
    for bad in ['TB' + 'D', 'TO' + 'DO']:
        assert bad not in text, f'{path}: contains disallowed marker'
    if path.suffix == '.md':
        for index, line in enumerate(text.splitlines(), 1):
            assert len(line) <= 100, f'{path}:{index} too long'
print('markdown and skills ok')
PY
```

Expected: prints `markdown and skills ok`.

- [ ] **Step 4: Link dotfiles and smoke test Pi**

Run:

```bash
mise run link
mise exec -- pi --offline --list-models >/tmp/pi-list-models.out
```

Expected: both commands exit 0.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat
git diff --check
git status --short
```

Expected: diff stat contains only the intended files, `git diff --check` exits
0, and status shows only expected unstaged changes before the final commit.

- [ ] **Step 6: Commit documentation and final verification**

Run:

```bash
git add README.md
git commit -m "docs(pi): document Hermes-like workflows" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

Expected: one documentation commit.

- [ ] **Step 7: Final status check**

Run:

```bash
git status --short
git log --oneline -6
```

Expected: clean working tree and the six implementation commits visible at the
top of history.
