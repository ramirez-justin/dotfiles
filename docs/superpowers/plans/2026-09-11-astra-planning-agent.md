# Astra Planning Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an efficient GPT-6 Astra architecture-planning agent with
automatic, criteria-based escalation and a Terra implementation-planning
handoff.

**Architecture:** Keep Sol as the general-session default and Terra `Plan` as
the normal detailed planner. Add an isolated, read-only `AstraPlan` agent for
qualified architecture work, route it through instruction-driven criteria, and
validate both the specialized agent and unchanged default model.

**Tech Stack:** Pi Markdown agent definitions, tintinweb/pi-subagents
frontmatter, shell validation in Mise, Markdown workflow documentation.

---

## File Map

- Create `pi/.pi/agent/agents/AstraPlan.md`: define the specialized agent and
  its planning contract.
- Modify `mise.toml`: validate Astra's model tier, exact agent constraints,
  model availability, and unchanged Sol default.
- Modify `pi/.pi/agent/AGENTS.md`: define automatic escalation and efficient
  Astra-to-Terra handoff.
- Modify `pi/.pi/agent/prompts/write-plan.md`: apply the same routing when
  `/write-plan` is invoked.
- Modify `pi/.pi/agent/memory/WORKFLOWS.md`: keep injected workflow memory
  consistent with authoritative routing instructions.
- Modify `README.md`: describe the mixed GPT-5.6/GPT-6 agent tiers accurately.
- Delete the task-specific design and plan after verification, as required by
  the durable workflow rule.

### Task 1: Add the Astra Agent Contract and Validation

**Files:**

- Create: `pi/.pi/agent/agents/AstraPlan.md`
- Modify: `mise.toml:55-80`

- [ ] **Step 1: Extend the validation task before creating the agent**

Replace the existing `[tasks.check-agent-tiers]` task with:

```toml
[tasks.check-agent-tiers]
description = "Verify Pi agent models, reasoning levels, and defaults"
run = """
set -e
agents={{config_root}}/pi/.pi/agent/agents
settings={{config_root}}/pi/.pi/agent/settings.json
astra="$agents/AstraPlan.md"
checked=0
for file in "$agents"/*.md; do
    model=$(awk -F': ' '$1 == "model" { print $2; exit }' "$file")
    thinking=$(awk -F': ' '$1 == "thinking" { print $2; exit }' "$file")
    case "$model" in
        *gpt-5.6-luna|*gpt-5.6-terra|*gpt-6-astra) expected=max ;;
        *gpt-5.6-sol) expected=medium ;;
        *) continue ;;
    esac
    checked=$((checked + 1))
    if [ "$thinking" != "$expected" ]; then
        echo "$file: expected thinking $expected for $model, got $thinking" >&2
        exit 1
    fi
done
if [ "$checked" -eq 0 ]; then
    echo "No tiered Pi agents found in $agents" >&2
    exit 1
fi

if [ ! -f "$astra" ]; then
    echo "Missing Astra planning agent: $astra" >&2
    exit 1
fi
for expected in \
    "name: AstraPlan" \
    "tools: read, grep, find, bash" \
    "model: openai-codex/gpt-6-astra" \
    "thinking: max" \
    "max_turns: 20" \
    "isolated: true" \
    "isolation: off" \
    "prompt_mode: append"
do
    if ! grep -Fxq -- "$expected" "$astra"; then
        echo "$astra: missing required setting: $expected" >&2
        exit 1
    fi
done

for expected in \
    '"defaultProvider": "openai-codex"' \
    '"defaultModel": "gpt-5.6-sol"' \
    '"defaultThinkingLevel": "medium"'
do
    if ! grep -Fq -- "$expected" "$settings"; then
        echo "$settings: missing required default: $expected" >&2
        exit 1
    fi
done

if ! mise exec -- pi --offline --list-models | \
    awk '$1 == "openai-codex" && $2 == "gpt-6-astra" { found=1 }
         END { exit !found }'
then
    echo "Pi model catalog does not contain openai-codex/gpt-6-astra" >&2
    exit 1
fi

echo "Pi agent models and defaults verified ($checked agents)"
"""
```

- [ ] **Step 2: Run the check and verify the missing-agent failure**

Run:

```bash
mise run check-agent-tiers
```

Expected: non-zero exit with
`Missing Astra planning agent: .../agents/AstraPlan.md`.

- [ ] **Step 3: Create the specialized agent**

Create `pi/.pi/agent/agents/AstraPlan.md` with:

```markdown
---
name: AstraPlan
description: Architecture planning for qualified, highly complex tasks.
display_name: Astra Plan (GPT-6)
tools: read, grep, find, bash
model: openai-codex/gpt-6-astra
thinking: max
max_turns: 20
isolated: true
isolation: off
prompt_mode: append
---

# Astra Plan

You are the architecture-planning specialist for Justin's Pi setup. Work only
on tasks whose dispatch brief records the approved Astra escalation signals.
If the brief does not justify escalation, stop and recommend the Terra `Plan`
agent.

Do not edit files, implement changes, or mutate external systems. Use `bash`
only for read-only inspection. Treat evidence supplied in the dispatch brief as
the starting point; verify only facts that materially affect the decision and
do not repeat discovery already performed by another agent.

Focus on architecture, system boundaries, cross-system tradeoffs,
decomposition, migrations, rollout, rollback, and risks. Leave routine
file-level expansion to Terra `Plan` unless architecture and implementation
sequencing cannot reasonably be separated.

The dispatch brief must include:

- the impact and structural complexity signals that qualified the task;
- the planning question, constraints, and non-goals;
- evidence already gathered; and
- unresolved decisions.

Return:

- escalation assessment;
- verified evidence, assumptions, and unresolved questions;
- goal and non-goals;
- system map and dependencies;
- alternatives and tradeoffs;
- recommended architecture and decomposition;
- migration, rollout, rollback, and validation strategy;
- open risks and decisions; and
- a concise handoff for Terra `Plan`, or a reason Terra should be skipped.
```

`isolated: true` disables extension tools and skills, reducing prompt overhead
and preventing external-system mutation. `isolation: off` prevents unnecessary
worktree creation for this read-only agent.

- [ ] **Step 4: Run validation and verify it passes**

Run:

```bash
mise run check-agent-tiers
```

Expected: exit zero and
`Pi agent models and defaults verified (9 agents)`.

- [ ] **Step 5: Inspect the diff for unintended default-model changes**

Run:

```bash
git diff -- pi/.pi/agent/agents/AstraPlan.md mise.toml \
  pi/.pi/agent/settings.json
```

Expected: the agent and validator change; `settings.json` has no diff.

- [ ] **Step 6: Commit the agent and validator**

```bash
git add pi/.pi/agent/agents/AstraPlan.md mise.toml
git commit -m "feat(pi): add Astra planning agent" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 2: Route Highly Complex Planning Efficiently

**Files:**

- Modify: `pi/.pi/agent/AGENTS.md:57-75`
- Modify: `pi/.pi/agent/prompts/write-plan.md:1-10`
- Modify: `pi/.pi/agent/memory/WORKFLOWS.md:18-32`
- Modify: `README.md:109-110`

- [ ] **Step 1: Replace the subagent-routing section**

Replace the `## Subagent Routing` section in `pi/.pi/agent/AGENTS.md`, through
the paragraph before `## Tool Preferences`, with:

```markdown
## Subagent Routing

Use `@tintinweb/pi-subagents` when delegation materially improves the work:

- Launch `Explore` on Luna with max reasoning before planning or debugging a
  broad, unfamiliar subsystem.
- Launch `Plan`, `reviewer`, `oracle`, or `researcher` on Terra with max
  reasoning for detailed planning, independent review, assumption checks, or
  current research.
- Automatically launch `AstraPlan` for architecture planning when a task has
  either one impact signal plus two structural complexity signals, or at least
  three structural complexity signals. Impact signals are production, data,
  security, compliance, significant cost, public-contract, hard-to-reverse, or
  difficult-rollback risk. Structural signals are three or more systems or
  contracts; migration, backfill, compatibility, cutover, or rollback work;
  conflicting requirements or multiple viable architectures; or evidence that
  spans source, history, current documentation, and ownership boundaries.
- For qualifying tasks, gather missing evidence once with `Explore` or
  `researcher`, give `AstraPlan` a curated brief and escalation justification,
  then use Terra `Plan` only to expand the architecture into file-level steps.
  Skip Terra when architecture and sequencing cannot reasonably be separated.
- Do not escalate based only on file count, prompt length, or a request for
  thoroughness. Do not ask multiple agents to recreate the same plan.
- Launch exactly one `worker` or `implementer` on Sol for approved delegated
  edits. Do not edit the same worktree concurrently in the parent.
- Launch `verifier` on Luna with max reasoning for independent validation of
  meaningful changes before claiming completion.
- Keep direct work in the Sol parent for small, clear tasks where delegation
  would add more overhead than value.

The parent remains accountable for routing, scope, decisions, reviewing actual
changes, and user-facing claims. Do not delegate Linear, Notion, Snowflake, or
Cortex mutations by default; keep preview-before-mutation approval in the
parent.
```

- [ ] **Step 2: Update the `/write-plan` prompt**

Replace `pi/.pi/agent/prompts/write-plan.md` with:

```markdown
---
description: Use Superpowers writing-plans to create an implementation plan
argument-hint: "<task/context>"
---
Use the `writing-plans` skill to create a concrete implementation plan. If the
codebase or affected subsystem is broad or unfamiliar, launch `Explore` first.
Use Terra `Plan` for a separate detailed planning pass when useful.

Automatically use `AstraPlan` first when the task meets the escalation gate in
`AGENTS.md`. Give it a curated evidence brief, then give its architecture
handoff to Terra `Plan` for file-level expansion. Skip Terra if Astra reports
that architecture and sequencing cannot reasonably be separated. Do not ask
the agents to repeat each other's work.

$ARGUMENTS
```

- [ ] **Step 3: Update durable workflow guidance**

In `pi/.pi/agent/memory/WORKFLOWS.md`, replace the existing subagent-tier
bullet that starts with `Use @tintinweb/pi-subagents` with:

```markdown
- Use `@tintinweb/pi-subagents` when delegation adds value: run Luna and Terra
  agents with max reasoning, Sol with medium reasoning, and reserve
  `AstraPlan` for the automatic high-complexity gate in `AGENTS.md`. For
  qualifying tasks, gather evidence once, use Astra for architecture, then use
  Terra only for file-level expansion unless sequencing is inseparable. The
  parent remains accountable for routing, decisions, mutations, and claims.
```

Retain the adjacent workflow bullets, including the rule requiring completed
specification and plan artifacts to be removed.

- [ ] **Step 4: Correct the README model description**

Replace the two README subagent lines with:

```markdown
# - Subagents: npm:@tintinweb/pi-subagents with model-tiered agents.
#   Sol handles general work, Luna/Terra handle specialist work, and Astra is
#   reserved for highly complex architecture planning. Use /agents to manage.
```

- [ ] **Step 5: Validate Markdown and routing consistency**

Run:

```bash
awk 'length($0) > 79 { print FILENAME ":" FNR ":" length($0) }' \
  pi/.pi/agent/AGENTS.md \
  pi/.pi/agent/prompts/write-plan.md \
  pi/.pi/agent/memory/WORKFLOWS.md \
  README.md
git diff --check
rg -n "AstraPlan|gpt-6-astra|GPT-5.6 model-tiered" \
  pi/.pi/agent/AGENTS.md \
  pi/.pi/agent/prompts/write-plan.md \
  pi/.pi/agent/memory/WORKFLOWS.md \
  pi/.pi/agent/agents/AstraPlan.md \
  README.md \
  mise.toml
```

Expected: the `awk` command and `git diff --check` produce no output. Every
routing surface mentions `AstraPlan`, and the obsolete GPT-5.6-only README text
is absent.

- [ ] **Step 6: Commit the routing documentation**

```bash
git add README.md \
  pi/.pi/agent/AGENTS.md \
  pi/.pi/agent/prompts/write-plan.md \
  pi/.pi/agent/memory/WORKFLOWS.md
git commit -m "docs(pi): route complex planning through Astra" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

### Task 3: Verify the Installed Agent and Clean Up Artifacts

**Files:**

- Verify: `pi/.pi/agent/agents/AstraPlan.md`
- Verify: `pi/.pi/agent/settings.json`
- Delete:
  `docs/superpowers/specs/2026-09-11-astra-planning-agent-design.md`
- Delete: `docs/superpowers/plans/2026-09-11-astra-planning-agent.md`

- [ ] **Step 1: Run the complete automated checks**

Run:

```bash
mise run check-agent-tiers
git diff --check
git status --short
```

Expected: model validation passes, whitespace validation is silent, and only
expected task artifacts are present.

- [ ] **Step 2: Verify the Stow link exposes the new agent**

Run:

```bash
test "$(readlink "$HOME/.pi/agent/agents")" = \
  "../../Repositories/dotfiles/pi/.pi/agent/agents"
test -f "$HOME/.pi/agent/agents/AstraPlan.md"
```

Expected: both commands exit zero. Do not run `mise run link` because the agent
directory is already linked to this repository.

- [ ] **Step 3: Perform the manual registry check**

Start a fresh Pi session, open `/agents`, and inspect `AstraPlan`.

Expected:

- the agent type is `AstraPlan`;
- the effective model is `openai-codex/gpt-6-astra`;
- thinking is `max`;
- the built-in tools are `read`, `grep`, `find`, and `bash`;
- extension tools and skills are unavailable; and
- no worktree isolation is requested.

Do not run a paid Astra smoke test unless Justin explicitly requests it.

- [ ] **Step 4: Remove the completed task artifacts**

Run:

```bash
git rm \
  docs/superpowers/specs/2026-09-11-astra-planning-agent-design.md \
  docs/superpowers/plans/2026-09-11-astra-planning-agent.md
```

Expected: both task-specific documents are staged for deletion.

- [ ] **Step 5: Verify the final diff contains no planning artifacts**

Run:

```bash
git diff --cached --check
git diff --cached --name-status
```

Expected: whitespace validation is silent and the staged diff deletes both
artifacts.

- [ ] **Step 6: Commit artifact cleanup**

```bash
git commit -m "docs(pi): remove completed Astra planning artifacts" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

- [ ] **Step 7: Verify final repository state**

Run:

```bash
mise run check-agent-tiers
git diff --check
git status --short --branch
test ! -e docs/superpowers/specs/2026-09-11-astra-planning-agent-design.md
test ! -e docs/superpowers/plans/2026-09-11-astra-planning-agent.md
test -z "$(git diff origin/gametime --name-only -- \
  docs/superpowers/specs docs/superpowers/plans)"
```

Expected: all checks exit zero, the worktree is clean, and both temporary
planning artifacts are absent from the final tree and branch diff.
