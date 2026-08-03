# User Memory

Durable preferences about Justin. This file is versioned in dotfiles.

## Rules

- Do not store secrets, tokens, private keys, passphrases, or raw credentials.
- Do not store transient session details or one-off mistakes.
- Prefer stable preferences that should affect future sessions.
- Memory is Pi-owned and does not require approval before updating.
- Audit existing memory before adding entries; prune stale or duplicate facts.

## Preferences

- Prefer concise responses unless the task requires detail.
- Prefer reviewing designs and plans interactively in chat rather than being
  asked to review a file separately.
- Prefer minimum code that solves the problem.
- For small, focused changes, work directly on a feature branch; use an
  isolated worktree only when isolation materially helps or Justin requests it.
- When a worktree is needed, use a global isolated location by default (for
  example, `~/.config/superpowers/worktrees/<project>/`); do not ask Justin to
  choose implementation details unless the tradeoff affects him.
- Use Neovim rather than VS Code. Do not install or manage VS Code or its
  extensions unless explicitly requested.
- Prefer explicit success criteria and verified outcomes.
- Prefer Linear over Jira for new issue-tracking work unless Jira is requested.
- Do not present PR URLs unless the PR has actually been created and verified.
  If only a GitHub “create PR” URL exists, label it clearly or omit it.
- Proactively consider memory updates when Justin gives behavioral corrections,
  workflow preferences, repeated-frustration feedback, or stable project
  caveats. Do not wait only for explicit “remember this” requests.
- Prefer choosing the desired end-state and building it directly over adding
  intermediate scaffolding or process overhead.
- Avoid PR sprawl; fold tightly related fixes into an existing PR when the
  resulting scope remains coherent and reviewable.
- Treat implementation plans and design specs as temporary working artifacts.
  Immediately before opening or finalizing a PR, verify task-specific artifacts
  are absent unless explicitly requested; do not rely on intended cleanup.
- Prefer general behavior tests over exact prompt regressions when a broader
  rule is the real requirement.
- Do not run Terraform or Terragrunt plan/apply commands for Snowflake; they
  time out in Pi. Leave those commands for Justin to run.
- Prefer not to manage Snowflake table definitions in Terraform unless
  explicitly requested; use Terraform for grants/infrastructure around tables.
- Use the installed dbt command, not uv dbt. In dbt Cloud projects,
  commands like `dbt parse` run through dbt Cloud, so do not skip them due to
  missing local `profiles.yml` or `dbt_packages/` alone.
- Treat source data correctness as unverified unless it has been validated.
- For data pipeline table writes, prefer deterministic keys and metadata columns
  that support troubleshooting; overwrite modes should only replace rows for
  source files processed in the current run unless explicitly specified.
- Validate automated PR review feedback before applying it; avoid iterative
  churn from bots unless the suggestion is technically justified.
- When Justin shares a reviewer/bot suggestion with reservations, treat it as a
  request for technical feedback and tradeoffs, not approval to implement it.
- Do not assume local tools are installed; check availability before suggesting
  or using them.
