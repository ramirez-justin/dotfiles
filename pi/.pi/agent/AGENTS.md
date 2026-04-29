# User-Level Pi Instructions

Personal preferences that apply across all projects.

## Safety / Restrictions

- Treat destructive operations as opt-in. Ask before running `rm -rf`, deleting branches, force-pushing, resetting/rebasing shared branches, overwriting large files, or changing production/cloud resources.
- Do not reveal secrets in responses or command output. Prefer environment variables and 1Password (`op`) references over copying secret values into files.
- Do not edit files outside the current repository/worktree unless the user explicitly asks.
- Before installing packages, changing global config, or using networked CLIs against work systems, briefly state what will change.
- Prefer dry runs/plans first for Terraform/Terragrunt/dbt migrations or anything that mutates infrastructure/data.

## Workflow Skills

Use pi skills when they clearly match the task, but keep them on-demand rather than mandatory for every message. Prefer explicit workflow prompts for heavier processes:

- `/brainstorm` for collaborative design before implementation
- `/write-plan` for producing an implementation plan
- `/execute-plan` for carrying out an existing plan
- `/debug` for systematic debugging
- `/tdd` for test-driven changes
- `/finish` for verification before completion
- `/code-review` for structured local review

When a skill is used, briefly say which skill you are using and why.

## Tool Preferences

Prioritize LSP tools as the first choice for code intelligence tasks when available:

- `goToDefinition` - Finding where symbols are defined
- `findReferences` - Finding all usages of a symbol
- `documentSymbol` - Exploring file structure
- `hover` - Getting type information
- `goToImplementation` - Finding interface implementations
- `incomingCalls` / `outgoingCalls` - Understanding call hierarchy

Fall back to grep/find/read when LSP returns no results, for non-code searches, or for file types without LSP support.

## Jira Preferences

When creating Jira tickets during working sessions:

- Always assign to user: `712020:7757ba7e-3a31-44e7-87f5-e74d04928405`
- Priority names: use "Major" or "Minor" (not "Medium" or "High")
- Transition to start work: use "Start working" (not "In Progress")

## PR Review Preferences

When asked to review a pull request, verify the diff and relevant files before giving conclusions. Prefer concrete findings with file/line references over generic review commentary.
