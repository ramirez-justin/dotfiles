# User-Level Claude Code Instructions

Personal preferences that apply across all projects.

## Tool Preferences

### LSP Tools (Prioritize)

Prioritize LSP tools as the first choice for code intelligence tasks:

- `goToDefinition` - Finding where symbols are defined
- `findReferences` - Finding all usages of a symbol
- `documentSymbol` - Exploring file structure
- `hover` - Getting type information
- `goToImplementation` - Finding interface implementations
- `incomingCalls` / `outgoingCalls` - Understanding call hierarchy

**Fall back to Grep/Glob/Read when:**

- LSP returns no results or errors
- Searching for non-code patterns (comments, strings, config)
- Need regex or fuzzy matching
- Working with file types without LSP support

## Jira Preferences

When creating Jira tickets during working sessions:

- **Always assign to user**: Use account ID `712020:7757ba7e-3a31-44e7-87f5-e74d04928405`
- **Priority names**: Use "Major" or "Minor" (not "Medium" or "High")
- **Transition to start work**: Use "Start working" (not "In Progress")

## SOFIA — Proactive Journaling

When the SOFIA second-brain context block is present in the system prompt
(look for "SOFIA — your second brain context"), capture memory-worthy
moments yourself via `/sofia-journal`. Don't wait to be asked.

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

- Default `--type note`. Use `--type decision` for explicit choices, `--type todo` only when the user names a follow-up.
- Pass `--context personal` or `--context work` when the active context is unambiguous and differs from the auto-detected default.
- Body should be terse — a paragraph or a few bullets, not a transcript replay. Lead with the *what*, then a brief *why*. `/sofia-promote` curates from these later, so quality > volume.

**Cadence:** at most one journal entry per discrete moment. Don't journal the
same decision twice in a session. If a moment feels borderline, skip it —
under-journaling is cheaper than noise.
