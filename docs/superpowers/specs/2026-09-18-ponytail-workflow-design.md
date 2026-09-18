# Ponytail Workflow Integration Design

## Goal

Make Ponytail's balanced simplicity discipline a dependable part of the local
Pi development workflow. Apply it during design, planning, implementation, and
review without allowing minimum line count to override correctness or clarity.

## Non-goals

- Install Ponytail's runtime hooks or plugin machinery.
- Copy every upstream command or mode.
- Replace correctness, security, performance, or verification reviews.
- Require a separate subagent call for typo-level or similarly trivial edits.
- Automatically apply suggested simplifications.

## Source Alignment

The design adapts the core behavior from
[`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail):

1. Determine whether the work needs to exist.
2. Reuse an existing repository solution when possible.
3. Prefer the standard library.
4. Prefer native platform capabilities.
5. Prefer an already-installed dependency.
6. Prefer a direct solution over a new abstraction.
7. Only then write the smallest complete implementation.

As in Ponytail, the ladder runs after the agent understands the task and traces
the relevant code flow. Simplicity must not remove required validation, tests,
security, accessibility, observability, operational safety, or maintainability.

The mandatory specialist checkpoints are a local extension. Upstream
`ponytail-review` is normally invoked explicitly; this workflow makes the
independent simplicity pass deterministic.

## Architecture

### Always-on baseline

Add the balanced ladder to the global Pi instructions in
`pi/.pi/agent/AGENTS.md`. The rule applies to every coding task, including
small direct changes that do not enter a formal planning or review workflow.

Repeat the operational parts in agent contracts where enforcement matters:

- planning agents must justify new machinery and reject speculative steps;
- writer agents must use the first viable rung and avoid unrelated cleanup;
- review agents must keep correctness review distinct from simplification.

### Focused review skill

Add `pi/.pi/agent/skills/ponytail-review/SKILL.md` as an explicit, read-only
review workflow. It examines a plan or diff only for unnecessary complexity
and reports concrete deletions or replacements. It does not apply fixes.

The skill must exclude correctness, security, performance, and test adequacy
from its findings and direct those concerns to the normal review process.

### Simplifier agent

Add `pi/.pi/agent/agents/simplifier.md` as a read-only specialist. It accepts
either a plan or a diff and checks the Ponytail ladder against verified
repository context.

Its report contains:

- blocking unnecessary complexity;
- non-blocking reductions worth considering;
- rejected simplifications that would weaken requirements;
- verification performed and evidence gaps;
- a clear "lean already" result when nothing should change.

Findings must identify concrete files, lines, plan steps, or dependencies. The
agent must not optimize for line count alone.

## Mandatory Checkpoints

The specialist pass is required at these workflow boundaries:

1. `writing-plans` runs `simplifier` on every generated implementation plan
   before approval or execution.
2. `executing-plans` runs `simplifier` on the final diff before independent
   verification and completion.
3. `/code-review` runs `simplifier` alongside the correctness-focused reviewer.

A corrected artifact must be reassessed when a simplifier finding causes a
material plan or implementation change. The parent validates findings before
acting and may reject a suggestion with technical evidence.

Small edits that bypass these formal workflows still receive the always-on
ladder through global and writer instructions.

## Files

Create:

- `pi/.pi/agent/agents/simplifier.md`
- `pi/.pi/agent/skills/ponytail-review/SKILL.md`

Modify:

- `pi/.pi/agent/AGENTS.md`
- `pi/.pi/agent/agents/Plan.md`
- `pi/.pi/agent/agents/AstraPlan.md`
- `pi/.pi/agent/agents/worker.md`
- `pi/.pi/agent/agents/implementer.md`
- `pi/.pi/agent/agents/reviewer.md`
- `pi/.pi/agent/skills/writing-plans/SKILL.md`
- `pi/.pi/agent/skills/executing-plans/SKILL.md`
- `pi/.pi/agent/prompts/code-review.md`

No upstream Ponytail package or runtime hook is installed.

## Validation

- Validate skill frontmatter and prohibited placeholders.
- Run `mise run check-agent-tiers`.
- Check Markdown line lengths for all changed files.
- Inspect the final diff for deterministic checkpoint wording.
- Confirm the specialist cannot edit files and does not replace normal review.
- Run the new process against its own plan and final diff.
