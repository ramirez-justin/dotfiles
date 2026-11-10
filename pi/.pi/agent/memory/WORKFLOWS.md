# Workflow Memory

Durable workflow conventions for Justin's Pi sessions.

## Rules

- Store only reusable, cross-project workflow conventions. Common memory
  policy lives in `AGENTS.md` and `memory-management`.

## Conventions

- Before implementation, inspect CI and verify compatible test/lint tools.
  Before PRs, run exact CI commands with matching cwd, versions, and final
  changed files; pre-commit is not equivalent. Reuse fresh evidence unless
  changes or a concrete uncertainty require rerunning checks.
- Entry points: `/brainstorm` design; `/write-plan` multi-step planning;
  `/execute-plan` approved plans; `/debug` unexpected behavior; `/tdd`
  feature/bug-fix tests; `/finish` final verification; `/code-review`
  structured review. Load matching skills as needed; briefly name them and why.
  Scale to the task: no full sequence or extra ceremony for small, clear
  changes.
- Use Conventional Commits (`type(scope): summary`) with an imperative,
  concise, lower-case summary except proper nouns. Include
  `Co-Authored-By: Pi <noreply@pi.dev>` in commits and
  `🤖 Generated with [Pi](https://pi.dev)` in PR descriptions unless Justin
  asks otherwise. Approval to implement a fix covers its local commit and
  pushing it to the existing PR branch after verification; do not add separate
  approval gates. Other external mutations and destructive operations still
  require their applicable approval.
- For PR descriptions/comments containing Markdown, use `--body-file` or
  stdin rather than multiline shell/JSON quoting; verify the posted formatting.
- Inspect PR diffs and relevant files; report concrete, verified findings
  with file/line references, not generic commentary. For PRs Justin does not
  own, run the reviewer in background while the main agent gives a
  few-sentence plain-language orientation and interactively discusses intent,
  choices, tradeoffs, and alternatives. Tie findings to that discussion, not a
  long preamble. No extra explainer agent or mandatory Q&A; go straight to
  findings if the gist suffices. Separate optional alternatives from defects;
  never invent rationale.
- When reviewing or changing Airflow DAGs, trace related external code through
  the actual execution path, including notebooks, shared helpers, SDKs, and
  downstream services. Verify deployed versions, request limits, batching,
  and write behavior; parameter compatibility alone is not enough. Do not
  treat PR descriptions or stubbed tests as proof of production contracts.
  Report inaccessible external code or unverified contracts as evidence gaps.
- When reviewing PR comments, inspect both GitHub review threads and any linked
  Linear Review diff threads; GitHub APIs do not expose Linear-only findings.
- When auditing Terraform plans from a long-lived branch, distinguish real
  state drift from branch-relative differences by checking changes merged after
  the branch point. Deduplicate findings against Linear and separate
  destructive or irreversible changes from state-only moves before ticketing.
- If Cortex cannot access Snowflake, use the key-pair fallback in the
  `snowflake` skill, not saved CLI profiles alone.
- For Pi Anthropic OAuth refresh failures, tell Justin to run
  `/login anthropic` inside Pi, then retry. Don't send him to
  `claude auth login` or repeatedly retry the expired credential.
- Justin's `aws-me` AWS session helper is a zsh alias; from Pi shell tools,
  invoke it through interactive zsh, for example
  `zsh -ic 'aws-me -- <command>'`.
- For Astro production task logs, use the `Data Eng` 1Password item named
  `astro production starship api token` as a bearer token for the deployment's
  Airflow REST API. Never print or persist the token.
- Specs/plans may be committed while active. At completion, remove
  task-specific designs/specs/implementation plans. Before PR
  creation/finalization, verify absence from BOTH worktree and final diff
  unless Justin explicitly requests retention.
