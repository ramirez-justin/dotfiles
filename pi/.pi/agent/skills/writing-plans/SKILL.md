---
name: writing-plans
description: >-
  Use when a multi-step build request has a design or requirements and needs
  a concrete implementation plan before execution in the local Pi workflow.
---

# Writing Plans

Announce that you are using the local writing-plans skill.
Use selected Superpowers engineering practices, not its execution handoff.
Do not use this workflow for a trivial edit or to invent an unapproved design.

## Gather Context

- Read repository instructions, the design, and relevant source and tests.
- Resolve material ambiguity before planning. Keep scope minimal; do not add
  speculative features or unrelated restructuring.
- Follow the planning escalation gate in `AGENTS.md`. Use `Explore` for broad,
  unfamiliar code; use `AstraPlan` only when the gate qualifies, with a curated
  evidence brief. Use Terra `Plan` for useful file-level expansion, not to
  recreate an architecture or duplicate an earlier planning pass.

## Write the Plan

Save to `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`, unless the user
specified another location. Plans and task-specific specs are temporary;
remove them before finalizing unless the user explicitly asks to retain them.
Keep Markdown lines under 80 characters.

Start with the goal, approved design or spec reference, architecture, relevant
stack, constraints, and observable success criteria. State that execution uses
the local executing-plans workflow, not upstream orchestration.

Break work into independently testable deliverables with checkbox steps:

- Name concrete create, modify, and test paths, plus relevant symbols or lines.
- Explain responsibilities, dependencies, and exact interfaces between tasks.
- Include actual code for code steps and concrete test cases with expected
  behavior. Do not leave placeholders, undefined symbols, vague validation,
  or instructions to copy unspecified details from another task.
- Use small actions: write the failing test, confirm its intended failure,
  implement the minimum change, and rerun the test. Use the
  `test-driven-development` skill for feature and bug-fix work.
- For documentation or configuration, specify deterministic checks rather
  than inventing irrelevant unit tests.
- Give exact verification commands, working directories, and expected results.
  Include integration checks and cleanup of temporary plans/specs.
- Do not prescribe commits, external mutations, or destructive operations
  without the required authorization.

## Self-Review

Before presenting the plan, check every requirement against a task, resolve
missing coverage, scan for placeholders, and verify consistent paths, names,
interfaces, and test expectations. Fix defects before handing off.

## Mandatory Simplicity Checkpoint

Before presenting a plan for approval or starting execution, load
`../ponytail-review/SKILL.md` and run its plan checkpoint. Supply the complete
newline-preserved UTF-8 plan and SHA-256 identity. Freeze writes and launch
`simplifier` with `run_in_background: false` and `isolated: true`.

Wait for a completed lifecycle result and validate all report sections and
identity fields. Retry once on failure; a second failure blocks approval or
execution unless the user explicitly waives the checkpoint. Fix and reassess
blocking findings or reject them with recorded technical evidence. Rerun after
any plan content change; do not reuse a report for a changed artifact.

## Approval and Automatic Handoff

Summarize the plan in chat so the user need not review a file separately.
Ask for plan approval only if approval is not already established. Approval
must cover the work being planned; do not treat new scope as pre-approved.

Once an approved build request is ready, automatically load
`../executing-plans/SKILL.md` and continue. Never ask the user to select
subagent-driven versus inline execution or other internal execution mechanics.
If the user requested planning only, stop after delivering the plan; that is
not authorization to build.
