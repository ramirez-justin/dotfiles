# Hermes SOFIA Spike Global Instructions

This file adapts Justin's Pi global instructions for Hermes. It is intentionally secret-free and should stay compatible with Pi's workflow expectations.

## Project Instructions

- At the start of work in a repository, check applicable `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and private/local variants if present before making changes.
- Treat local/private instruction files as confidential context; do not quote secrets from them.
- Prefer repo-local instructions over this global adapter when they conflict.

## Safety / Restrictions

- Treat destructive operations as opt-in. Ask before running `rm -rf`, deleting branches, force-pushing, resetting/rebasing shared branches, overwriting large files, or changing production/cloud resources.
- Never merge a pull request, merge into `main`, or run merge commands without asking Justin first.
- Do not reveal secrets in responses or command output. Prefer environment variables, `op://` references, and local-only `.env` files over copied secret values.
- Do not edit files outside the current repository/worktree unless Justin explicitly asks.
- Prefer dry runs/plans first for Terraform/Terragrunt/dbt migrations or anything that mutates infrastructure/data.

## Workflow Parity with Pi

Pi had explicit prompts for brainstorm, write-plan, execute-plan, debug, tdd, finish, and code-review. In Hermes, use matching skills/slash commands where available:

- brainstorming / design: load an appropriate planning or ideation skill.
- writing plans: use `writing-plans` or `plan`.
- executing plans: use `subagent-driven-development` when parallel agents are useful.
- debugging: use `systematic-debugging`.
- TDD: use `test-driven-development`.
- finish/verification: verify with real commands and tool output before saying done.
- code review: use `github-code-review` or `requesting-code-review` depending on context.

## Tool Preferences

- Prefer LSP tools for code intelligence when available; fall back to file search/read when LSP is unavailable or not useful.
- Prefer CLI tools and deterministic scripts for mechanical transformations.
- Use Context7 MCP for third-party library/framework docs when freshness matters.

## SOFIA — Boot Context and Memory Surface

SOFIA Cloud is the primary durable memory surface for this profile. Every fresh
session must have SOFIA boot context before substantive work begins. Load the
`sofia-cloud-memory` skill for SOFIA memory access, boot context diagnostics,
and secret-safe troubleshooting.

Normal launches should use `mise run hermes:sofia:run`, which loads SOFIA boot
context into `HERMES_EPHEMERAL_SYSTEM_PROMPT` before Hermes starts. If a session
was started directly with `hermes --profile sofia-spike` and no SOFIA boot
context is visible in the system prompt, call SOFIA Cloud MCP `get_boot_context`
immediately. If boot context cannot be loaded, stop and report the failure
instead of falling back to Hermes local memory.

## SOFIA — Proactive Capture

When SOFIA Cloud MCP is configured, stay alert for memory-worthy moments and capture them with `capture_event`.

Capture:
- durable decisions and the reasoning behind them,
- lessons/gotchas/root causes worth remembering,
- stable facts about people, projects, systems, and canonical sources,
- stated preferences and workflow/process changes.

Do not capture:
- routine progress updates,
- transient task state,
- secrets, credentials, or sensitive raw values,
- borderline memories where noise is more likely than future value.

At wrap-up, if captures happened or Justin asks to review memory, call `review_candidates` and summarize pending candidates.

## Commit Message Preferences

Use Conventional Commits: `type(scope): summary` when a scope helps, otherwise `type: summary`. Keep the subject imperative and concise.
