# Astra Planning Agent Design

## Goal

Add GPT-6 Astra to the Pi subagent workflow without changing the model used by
general sessions. Use Astra automatically for the portions of highly complex
planning where its additional reasoning is valuable, while leaving routine and
detailed implementation planning to GPT-5.6 Terra.

## Non-goals

- Do not make Astra the default Pi model.
- Do not replace the existing Terra `Plan` agent.
- Do not send routine planning work to Astra.
- Do not build a routing extension or deterministic workflow engine.
- Do not let multiple agents independently produce the same plan.

## Architecture

Create a distinct global agent named `AstraPlan`. It is a read-only planning
agent specialized in architecture, decomposition, cross-system tradeoffs,
migrations, and rollout strategy.

For qualifying work, planning follows this sequence:

1. The parent records why the task meets the Astra escalation gate.
2. `Explore` or `Researcher` gathers missing evidence when needed.
3. `AstraPlan` receives a curated brief and produces an architecture blueprint.
4. Terra `Plan` expands that blueprint into file-level implementation steps.
5. The parent owns decisions and ensures agents do not duplicate work.

When architecture and implementation sequencing cannot reasonably be
separated, `AstraPlan` may produce the complete plan and Terra is skipped.

## Escalation Gate

The parent invokes `AstraPlan` automatically when either condition is met:

- one impact signal and at least two structural complexity signals; or
- at least three structural complexity signals.

Impact signals are:

- production, data-correctness, security, compliance, or significant cost risk;
- a public contract or hard-to-reverse architecture decision; or
- a change whose safe rollback is difficult or uncertain.

Structural complexity signals are:

- three or more systems, repositories, or external contracts;
- migration, backfill, compatibility, phased cutover, or rollback work;
- conflicting requirements or at least two viable architectures; or
- evidence that must be reconciled across source, history, current
  documentation, and ownership boundaries.

A large file count, long prompt, or request for thoroughness does not qualify
by itself. If the gate is not met, the parent uses Terra `Plan` when a separate
planning agent is still valuable.

Automatic escalation is instruction-driven: the parent evaluates the gate and
launches the agent without waiting for an explicit user request. No runtime
classifier or routing extension is added.

## Agent Contract

`AstraPlan` uses `openai-codex/gpt-6-astra` with maximum reasoning. It remains
planning-only and must not edit files or implement changes.

The agent receives the built-in `read`, `grep`, `find`, and `bash` tools.
`bash` is restricted by policy to read-only inspection. Extension tools are
disabled so the agent cannot mutate external systems and does not pay the
context cost of unrelated tool definitions.

The agent has a bounded limit of 20 turns. The dispatch brief must include:

- the escalation gate signals;
- the planning question and constraints;
- evidence already gathered by other agents or the parent; and
- decisions that remain unresolved.

The agent should decline work that does not meet the gate and recommend Terra
`Plan`. Its output should separate verified evidence, assumptions, unresolved
questions, and decisions requiring approval.

The normal output is an architecture blueprint containing:

- goal and non-goals;
- system boundaries and dependencies;
- alternatives and tradeoffs;
- recommended architecture and decomposition;
- migration, rollout, and rollback strategy;
- validation strategy; and
- open risks and decisions.

## Efficiency Rules

- Gather evidence once and pass a curated brief forward.
- Do not ask Terra to recreate Astra's architectural analysis.
- Do not ask Astra to expand routine file-level steps that Terra can produce.
- Skip agents whose specialty is not needed for the task.
- Skip Terra after Astra when architecture and sequencing are inseparable.
- Keep the Sol parent responsible for routing and synthesis.

These rules avoid repeating the broad discovery performed by the initial Astra
planning experiment, which was too expensive for a normal routing pattern.

## Configuration Changes

- Add `pi/.pi/agent/agents/AstraPlan.md`.
- Update `pi/.pi/agent/AGENTS.md` with the automatic gate and hybrid handoff.
- Update `pi/.pi/agent/prompts/write-plan.md` with the same routing rule.
- Update `pi/.pi/agent/memory/WORKFLOWS.md` so injected workflow guidance is
  consistent with the authoritative instructions.
- Extend `mise.toml` validation to recognize Astra, verify the agent contract,
  and ensure the default remains Sol with medium reasoning.
- Update `README.md` so it no longer describes every subagent as GPT-5.6.
- Leave `pi/.pi/agent/settings.json` and the existing `Plan.md` unchanged.

## Validation

Automated validation must confirm:

- the agent file exists and selects `openai-codex/gpt-6-astra`;
- Astra uses maximum reasoning and the expected turn limit;
- only the intended built-in tools are enabled;
- extension tools are disabled;
- the general default remains `openai-codex/gpt-5.6-sol` with medium
  reasoning;
- all agent-tier checks pass; and
- the Astra model exists in Pi's offline model catalog.

Manual validation should confirm that a fresh Pi session lists `AstraPlan` with
the expected model, reasoning level, and tools. A paid smoke test is optional
and should not run as part of routine validation.

## Risks and Rollback

The primary risks are unnecessary Astra cost, duplicated planning, policy-only
read restrictions on `bash`, and model catalog drift. The strict gate, curated
handoff, bounded turns, disabled extension tools, and validation checks
mitigate these risks.

Rollback consists of removing `AstraPlan.md` and reverting its routing and
validation references. The existing Terra `Plan` agent and Sol default remain
unchanged throughout, so rollback does not require a model migration.
