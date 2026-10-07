# Workflow Memory

Durable workflow conventions for Justin's Pi sessions.

## Rules

- Store only reusable, cross-project workflow conventions. Common memory
  policy lives in `AGENTS.md` and `memory-management`.

## Conventions

- Before opening or updating a Python PR, inspect the active CI workflow and run
  its exact code-quality command from the same working directory, with the same
  tool version and final changed-file set. A subdirectory invocation or local
  pre-commit result is not equivalent evidence.
- Workflow entry points: `/brainstorm` for design, `/write-plan` for multi-step
  planning, `/execute-plan` for approved plans, `/debug` for unexpected
  behavior, `/tdd` for feature/bug-fix tests, `/finish` for final verification,
  and `/code-review` for structured review. Load matching skills as needed;
  briefly name the skill and why it applies. Scale process to the task; do not
  run the entire sequence or add ceremony to small, clear changes.
- Use Conventional Commits (`type(scope): summary`) with an imperative,
  concise, lower-case summary except proper nouns. Include
  `Co-Authored-By: Pi <noreply@pi.dev>` in commits and
  `🤖 Generated with [Pi](https://pi.dev)` in PR descriptions unless Justin
  asks otherwise.
- For PR descriptions/comments containing Markdown, use `--body-file` or
  stdin rather than multiline shell/JSON quoting; verify the posted formatting.
- PR reviews should inspect the diff and relevant files, then report concrete
  findings with file/line references rather than generic commentary.
- When reviewing PR comments, inspect both GitHub review threads and any linked
  Linear Review diff threads; GitHub APIs do not expose Linear-only findings.
- When auditing Terraform plans from a long-lived branch, distinguish real
  state drift from branch-relative differences by checking changes merged after
  the branch point. Deduplicate findings against Linear and separate
  destructive or irreversible changes from state-only moves before ticketing.
- If Cortex cannot access Snowflake, use the existing 1Password key-pair
  helper, not just saved CLI profiles. For staging, invoke
  `set_snowflake_creds staging` through interactive zsh, then use a temporary
  CLI connection to `GAMETIME-STAGING` with `SNOWFLAKE_USER`. Map the helper's
  key/passphrase variables to `SNOWFLAKE_PRIVATE_KEY_RAW` and
  `PRIVATE_KEY_PASSPHRASE` only in process memory. Verify account and role;
  never print or persist credentials. The helper needs a signed-in op session.
- Justin's `aws-me` AWS session helper is a zsh alias; from Pi shell tools,
  invoke it through interactive zsh, for example
  `zsh -ic 'aws-me -- <command>'`.
- For Astro production task logs, use the `Data Eng` 1Password item named
  `astro production starship api token` as a bearer token for the deployment's
  Airflow REST API. Never print or persist the token.
- Specs and plans may be committed while work is active. Remove task-specific
  design, specification, and implementation-plan artifacts when the work is
  complete. Before creating or finalizing a PR, verify they are absent from both
  the worktree and final diff unless Justin explicitly asks to retain them.
