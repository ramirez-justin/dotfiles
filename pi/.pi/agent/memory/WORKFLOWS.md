# Workflow Memory

Durable workflow conventions for Justin's Pi sessions.

## Rules

- Do not store secrets or transient command output.
- Keep entries short, actionable, and easy to review in git diffs.
- Audit existing entries before appending new workflow memory.
- Prefer merging, pruning, or replacing stale entries over growing the file.
- Prefer adding automation when a manual command must be remembered.
- Before opening or updating a Python PR, inspect the active CI workflow and run
  its exact code-quality command from the same working directory, with the same
  tool version and final changed-file set. A subdirectory invocation or local
  pre-commit result is not equivalent evidence.

## Conventions

- Use `/brainstorm` before creative feature or behavior changes.
- Use `/write-plan` for multi-step implementation planning.
- Use `/execute-plan` or subagent-driven execution for approved plans. If
  delegating edits, use exactly one `implementer` or `worker` after approval;
  the parent must not edit concurrently and must review the actual diff.
- Use `/debug` before fixing unexpected behavior or test failures. Launch
  `Explore` for broad unfamiliar systems and `oracle` only when stuck or when
  assumptions need challenge.
- Use `/finish` before claiming implementation work is complete. Launch
  `verifier` for independent evidence on meaningful changes.
- Use `@tintinweb/pi-subagents` when delegation adds value: run Luna and Terra
  agents with max reasoning, and keep Sol at medium. Use `Explore` for quick
  context; `Plan`, `reviewer`, `oracle`, or `researcher` for hard reasoning;
  and one `worker`/`implementer` for approved writes. Keep small, clear tasks
  in the Sol parent. The parent remains accountable for scope, decisions,
  mutations, and user-facing claims.
- Do not use subagents by default for Linear, Notion, Snowflake, or Cortex
  mutations. Keep preview-before-mutation approval in the parent session.
- If Cortex cannot access the needed Snowflake account, Snowflake CLI key-pair
  access via 1Password may be used as a fallback. Never print or persist
  private keys, passphrases, tokens, or decrypted credential material.
- Justin's `aws-me` AWS session helper is a zsh alias; from Pi shell tools,
  invoke it through interactive zsh, for example
  `zsh -ic 'aws-me -- <command>'`.
- Immediately before creating or finalizing a PR, verify task-specific design,
  specification, and implementation-plan artifacts are absent from both the
  worktree and the final diff, unless Justin explicitly asks to retain them.
