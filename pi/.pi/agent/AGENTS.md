# User-Level Pi Instructions

Personal preferences that apply across all projects.

## Project Instructions

- At the start of work in a repository, check for and read applicable `CLAUDE.md` and `CLAUDE.local.md` files in the repo root and relevant subdirectories before making changes. Treat `CLAUDE.local.md` as local/private context and do not quote secrets from it.

## Safety / Restrictions

- Treat destructive operations as opt-in. Ask before running `rm -rf`, deleting branches, force-pushing, resetting/rebasing shared branches, overwriting large files, or changing production/cloud resources.
- Never merge a pull request, merge into `main`, or run merge commands without explicit user approval for that specific merge.
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

## Documentation Awareness

- When working with third-party libraries, frameworks, SDKs, or version-sensitive APIs, prefer Context7 documentation lookup before relying on model memory.
- Use Context7 selectively when documentation freshness matters; do not call it for simple local-code questions where repository files already answer the question.
- If Context7 cannot resolve a library, ask for a more specific package/library name or fall back to local docs and repository files.

## Reasoned Pushback and Alternatives

- Do not blindly accept the first proposed approach. When appropriate, provide pushback, alternatives, and trade-offs based on available evidence.
- For third-party tools, integrations, SDKs, and workflow systems, review local docs/source and current upstream documentation before recommending adoption.
- Prefer lightweight, reversible integration steps before installing new global tools or adding runtime complexity.
- If documentation and implementation disagree, trust verified implementation behavior and call out the discrepancy.

## MCP-backed Workspace Tools

- This Pi setup uses `pi-mcp-adapter`; do not assume Pi lacks MCP support. Inspect `~/.pi/agent/mcp.json`, `.mcp.json`, or `.pi/mcp.json` and use the adapter's `mcp` proxy/direct tools when relevant servers are configured.
- Prefer official remote MCP servers over ad hoc scripts for supported workspace tools such as Notion.
- Keep preview-before-mutation approval rules even when using MCP tools.
- For large mechanical repair jobs, prefer deterministic fetch/transform/write workflows over manually reconstructing large payloads in chat.

## Notion Preferences

- Prefer Notion MCP via `pi-mcp-adapter` for Notion search, read, create, update, append, and comment operations when available.
- Verify page, database, data source, and view identifiers with read-only MCP calls before mutating Notion.

## PR Review Preferences

When asked to review a pull request, verify the diff and relevant files before giving conclusions. Prefer concrete findings with file/line references over generic review commentary.

## SOFIA — Proactive Capture

When the SOFIA second-brain context block is present in the system prompt
(look for "SOFIA — your second brain context"), capture memory-worthy
moments yourself with the `sofia-capture` workflow. Don't wait to be asked.

**What to journal** (the bar: still useful in 3+ weeks):

- **Decisions** — "we chose X because Y," especially when Y is non-obvious
- **Lessons / gotchas** — things-that-burned-us, surprising failures, root causes worth remembering
- **Durable facts** — stable-for-months info about people, projects, systems, integrations
- **Stated preferences** — working style, tooling taste, what the user explicitly does or doesn't want
- **Recurring patterns** — anything the user keeps rediscovering

**What NOT to journal:**

- Routine file edits, command output, code that explains itself
- Anything still in flux mid-conversation — wait until the decision settles
- Sensitive data (secrets, credentials, PII) — see SOUL hard rules

**How to call it:**

- Load/use `/skill:sofia-capture` for user-facing or inferred capture, including "all done" / wrap-up flows.
- Use `/skill:sofia-journal` only as the low-level append primitive when an exact/simple journal write is needed.
- Default `--type note`. Use `--type decision` for explicit choices, `--type todo` only when the user names a follow-up.
- Pass `--context personal` or `--context work` when the active context is unambiguous and differs from the auto-detected default.
- Body should be terse — a paragraph or a few bullets, not a transcript replay. Lead with the _what_, then a brief _why_. `/skill:sofia-promote` curates from these later, so quality > volume.

**Cadence:** at most one journal entry per discrete moment. Don't journal the
same decision twice in a session. If a moment feels borderline, skip it —
under-journaling is cheaper than noise.
