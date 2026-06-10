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
