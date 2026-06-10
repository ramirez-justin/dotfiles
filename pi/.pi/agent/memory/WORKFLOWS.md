# Workflow Memory

Durable workflow conventions for Justin's Pi sessions.

## Rules

- Do not store secrets or transient command output.
- Keep entries short, actionable, and easy to review in git diffs.
- Audit existing entries before appending new workflow memory.
- Prefer merging, pruning, or replacing stale entries over growing the file.
- Prefer adding automation when a manual command must be remembered.

## Conventions

- Use `/brainstorm` before creative feature or behavior changes.
- Use `/write-plan` for multi-step implementation planning.
- Use `/execute-plan` or subagent-driven execution for approved plans.
- Use `/debug` before fixing unexpected behavior or test failures.
- Use `/finish` before claiming implementation work is complete.
