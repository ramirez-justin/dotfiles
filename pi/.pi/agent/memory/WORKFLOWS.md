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
  When delegating implementation, keep exactly one writer and use
  `implementer` or `worker` only after scope or plan approval.
- Use `/debug` before fixing unexpected behavior or test failures.
  Use `scout` for broad unfamiliar systems and `oracle` only when stuck or
  assumptions need challenge.
- Use `/finish` before claiming implementation work is complete. For
  non-trivial changes, consider `verifier` for independent evidence.
- Use read-only subagents lightly: `reviewer` for non-trivial code review
  second opinions, `scout` or `planner` for broad planning, and `researcher`
  when external/current docs materially matter. The parent remains accountable
  for final decisions, mutations, and user-facing claims.
- Do not use subagents by default for Linear, Notion, Snowflake, or Cortex
  mutations. Keep preview-before-mutation approval in the parent session.
- If Cortex cannot access the needed Snowflake account, Snowflake CLI key-pair
  access via 1Password may be used as a fallback. Never print or persist
  private keys, passphrases, tokens, or decrypted credential material.
- Justin's `aws-me` AWS session helper is a zsh alias; from Pi shell tools,
  invoke it through interactive zsh, for example
  `zsh -ic 'aws-me -- <command>'`.
