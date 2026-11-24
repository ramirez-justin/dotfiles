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

## Test Scope and Approval

- Do not test what the compiler or type checker already enforces. Runtime
  validation at an external boundary is a separate behavior worth testing.
- Add tests only to protect observable behavior, a contract, or a concrete
  regression. Do not chase coverage or duplicate implementation details.
- Prefer a few focused flows and distinct edge cases. Extend an existing test
  when it fits; avoid repeating assertions that catch the same failure.
- Before changing the suite, state which behavior is at risk and what existing
  tests miss. Get explicit approval for new test files or for a dedicated test
  step that names those files. Feature approval alone does not authorize them.
  Respect any stricter repository rules for editing existing tests.
- Show that a new regression test fails for the expected reason before the fix
  and passes after it. For new behavior or when replay is impractical, use a
  targeted mutation or controlled reversal. Report any verification gap.

## Issue Tracking Preferences

- Prefer Linear for new issue-tracking work.
- Do not create or update Jira issues unless the user explicitly requests Jira.

When Jira is explicitly requested:

- **Always assign to user**: Use account ID
  `712020:7757ba7e-3a31-44e7-87f5-e74d04928405`.
- **Priority names**: Use "Major" or "Minor" (not "Medium" or "High").
- **Transition to start work**: Use "Start working" (not "In Progress").

## PR Review Preferences

When the user asks to review a pull request in natural language ("review PR N",
"look at this PR", "what do you think of this diff", "re-review after the
push"), always invoke the `workflow:reviewing-prs-with-verification` skill
before responding. Do not fall back to the built-in `/review` slash command
unless the user explicitly types `/review`.
