---
name: orchestration
description: >-
  Use for complex, multi-step, high-risk, or long-running workflows that need
  explicit dependencies, checkpoints, evidence, delegation, and handoff state.
---

# Orchestration

Use this skill when a task is too large or risky for a single linear edit,
especially when it spans dependent systems, migrations, production, data,
authentication, long debugging campaigns, or multiple tools.

Do not use it for simple questions, small direct edits, or read-only lookups
with an obvious next step.

## Core Loop

1. State the goal, observable success criteria, constraints, approvals, and
   known unknowns.
2. Inspect local evidence and current third-party documentation before choosing
   a path. Separate verified facts from assumptions.
3. Present meaningful alternatives and trade-offs. Push back on avoidable risk,
   global state, runtime complexity, and brittle maintenance.
4. Build a todo dependency graph. Mark exactly one task `in_progress`; express
   dependencies with `blockedBy` and keep blockers visible.
5. Apply the routing matrix in `AGENTS.md`. Delegate only when it adds value,
   never ask agents to duplicate work, and keep exactly one worktree writer.
6. Add approval checkpoints before destructive, production, external, or
   hard-to-reverse actions.
7. Execute the smallest reversible step and verify it before completing its
   task. Never batch task completion or complete failing work.
8. Inspect the actual final state, run fresh verification, and capture durable
   outcomes through the applicable SOFIA workflow.

## Safety

- Parent ownership and existing approval rules remain in force.
- Agent summaries are evidence leads, not proof of completion.
- Do not install tools or mutate external systems without the applicable notice
  and approval.
- If documentation and implementation disagree, trust verified behavior and
  report the discrepancy.
