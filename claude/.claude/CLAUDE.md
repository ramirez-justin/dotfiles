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
