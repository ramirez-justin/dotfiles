# User-Level Pi Instructions

Personal preferences that apply across all projects.

## Behavioral Foundation

1. Don’t assume. Don’t hide confusion. Surface tradeoffs.
2. Minimum code that solves the problem. Nothing speculative.
3. Touch only what you must. Clean up only your own mess.
4. Define success criteria. Loop until verified.

## Project Instructions

- At the start of work in a repository, check for and read applicable
  `CLAUDE.md` and `CLAUDE.local.md` files in the repo root and relevant
  subdirectories before
  making changes. Treat `CLAUDE.local.md` as local/private context and do not
  quote secrets from it. Any AGENTS.md and AGENT.local.md should be treated as
  synonymous with CLAUDE.md and CLAUDE.local.md.

## Safety / Restrictions

- Treat destructive operations as opt-in. Ask before running `rm -rf`, deleting
  branches, force-pushing, resetting/rebasing shared branches, overwriting large
  files, or changing production/cloud resources.
- Never merge a pull request, merge into `main`, or run merge commands without
  explicit user approval for that specific merge.
- Do not reveal secrets in responses or command output. Prefer environment
  variables and 1Password (`op`) references over copying secret values into
  files.
- Do not edit files outside the current repository/worktree unless the user
  explicitly asks.
- Before installing packages, changing global config, or using networked CLIs
  against work systems, briefly state what will change.
- Prefer dry runs/plans first for Terraform/Terragrunt/dbt migrations or
  anything that mutates infrastructure/data.
- When writing markdown files, keep lines under 80 characters.

## Workflow Skills

Use pi skills when they clearly match the task, but keep them on-demand rather
than mandatory for every message. Prefer explicit workflow prompts for heavier
processes:

- `/brainstorm` for collaborative design before implementation
- `/write-plan` for producing an implementation plan
- `/execute-plan` for carrying out an existing plan
- `/debug` for systematic debugging
- `/tdd` for test-driven changes
- `/finish` for verification before completion
- `/code-review` for structured local review

When a skill is used, briefly say which skill you are using and why. If we are
deviating from an existing skill then suggest updates. If we are doing something
that seems like a good candidate for a skill then suggest that we create one.

## Tool Preferences

Prioritize LSP tools as the first choice for code intelligence tasks when
available:

- `goToDefinition` - Finding where symbols are defined
- `findReferences` - Finding all usages of a symbol
- `documentSymbol` - Exploring file structure
- `hover` - Getting type information
- `goToImplementation` - Finding interface implementations
- `incomingCalls` / `outgoingCalls` - Understanding call hierarchy

Fall back to grep/find/read when LSP returns no results, for non-code searches,
or for file types without LSP support.

CLI tools should be prioritized whenever possible, but not required.

Prefer automation over manual setup steps. When a process requires remembering
commands, add an idempotent script/task/check in dotfiles when practical.

## Documentation Awareness

- When working with third-party libraries, frameworks, SDKs, or
  version-sensitive APIs, prefer Context7 documentation lookup before relying
  on model memory.
- Use Context7 selectively when documentation freshness matters; do not call it
  for simple local-code questions where repository files already answer the
  question.
- If Context7 cannot resolve a library, ask for a more specific package/library
  name or fall back to local docs and repository files.

## Reasoned Pushback and Alternatives

- Do not blindly accept the first proposed approach. When appropriate, provide
  pushback, alternatives, and trade-offs based on available evidence.
- For third-party tools, integrations, SDKs, and workflow systems, review local
  docs/source and current upstream documentation before recommending adoption.
- Prefer lightweight, reversible integration steps before installing new global
  tools or adding runtime complexity.
- If documentation and implementation disagree, trust verified implementation
  behavior and call out the discrepancy.
- When proposing adoption of a tool or workflow, distinguish clearly between
  verified capabilities, documented-but-unverified claims, and speculation.

## MCP-backed Workspace Tools

This Pi setup uses `pi-mcp-adapter` for MCP. Do not assume Pi lacks MCP support;
inspect `~/.pi/agent/mcp.json`, `.mcp.json`, or `.pi/mcp.json` and use the
adapter's `mcp` proxy/direct tools when relevant servers are configured.

- Prefer official remote MCP servers over ad hoc scripts for supported workspace
  tools such as Linear and Notion.
- Keep preview-before-mutation approval rules even when using MCP tools.
- For large mechanical repair jobs, prefer deterministic fetch/transform/write
  workflows over manually reconstructing large payloads in chat.

## Linear Preferences

We are migrating from Jira to Linear. For issue tracking going forward:

- Prefer Linear over Jira for searching, creating, updating, and commenting on
  issues.
- Use the Linear skill/API when the user asks about tickets, issues, assigned
  work, or project tracking.
- Do not create or update Jira tickets unless the user explicitly asks for Jira.
- Prefer Linear MCP via `pi-mcp-adapter` for Linear interactions when available.

## Notion Preferences

- Prefer Notion MCP via `pi-mcp-adapter` for Notion search, read, create,
  update, append, and comment operations when available.
- Verify page, database, data source, and view identifiers with read-only MCP
  calls before mutating Notion.

## Git Attribution and Commit Messages

When creating commits or pull requests with Pi assistance, include clear Pi
attribution unless the user explicitly asks otherwise.

- Write commit messages using Conventional Commits:
  `type(scope): summary`.
- Use focused types such as `feat`, `fix`, `docs`, `test`, `refactor`,
  `chore`, and `ci`.
- Keep summaries imperative, concise, and lower-case unless naming a proper
  noun.
- Commits: include `Co-Authored-By: Pi <noreply@pi.dev>` as a trailer.
- Pull requests: include `🤖 Generated with [Pi](https://pi.dev)` in the PR
  description.
- When creating or editing pull request descriptions or comments containing
  Markdown, use `--body-file` or stdin. Do not pass multiline Markdown through
  shell/JSON quoting. Verify formatting after creation or edit.

## PR Review Preferences

When asked to review a pull request, verify the diff and relevant files before
giving conclusions. Prefer concrete findings with file/line references over
generic review commentary.

## Durable Memory

Reviewable memory files live in `~/.pi/agent/memory/`, backed by this
repository's `pi/.pi/agent/memory/` directory.

- Read `memory/USER.md` when durable user preferences may affect the task.
- Read `memory/WORKFLOWS.md` when choosing a repeatable workflow.
- Read `memory/PROJECTS.md` when stable project facts may affect the task.
- Never write memory without proposing a diff and receiving approval.
- Never store secrets, credentials, tokens, or transient session details.
