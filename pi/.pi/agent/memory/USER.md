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
- Prefer minimum code that solves the problem.
- Prefer explicit success criteria and verified outcomes.
- Prefer Linear over Jira for new issue-tracking work unless Jira is requested.
- Do not present PR URLs unless the PR has actually been created and verified.
  If only a GitHub “create PR” URL exists, label it clearly or omit it.
- Proactively consider memory updates when Justin gives behavioral corrections,
  workflow preferences, repeated-frustration feedback, or stable project
  caveats. Do not wait only for explicit “remember this” requests.
- Prefer choosing the desired end-state and building it directly over adding
  intermediate scaffolding or process overhead.
- Prefer general behavior tests over exact prompt regressions when a broader
  rule is the real requirement.
- For Terraform/Snowflake work, do not avoid plan or apply commands solely
  because they may take a long time.
- Use the installed dbt command, not uv dbt. In dbt Cloud projects,
  commands like `dbt parse` run through dbt Cloud, so do not skip them due to
  missing local `profiles.yml` or `dbt_packages/` alone.
- Treat source data correctness as unverified unless it has been validated.
- Do not assume local tools are installed; check availability before suggesting
  or using them.
