---
name: linear
description: Search, read, create, update, and comment on Linear issues using Linear MCP. Use when the user asks about tickets, issues, assigned work, or project tracking.
---

# Linear

Prefer Linear MCP through `pi-mcp-adapter`. This Pi setup uses `pi-mcp-adapter`; do not assume Pi lacks MCP support.

Before Linear work, check MCP availability with the `mcp` proxy:

```text
mcp({})
mcp({ connect: "linear" })
mcp({ server: "linear" })
```

Current preferred server config is the official Linear remote MCP server at `https://mcp.linear.app/mcp` with OAuth via the adapter.

## Common MCP tools

Use tool discovery for exact schemas:

```text
mcp({ describe: "linear_get_issue" })
mcp({ describe: "linear_list_issues" })
mcp({ describe: "linear_save_issue" })
mcp({ describe: "linear_list_comments" })
mcp({ describe: "linear_save_comment" })
```

Typical operations:

- Read issue: `linear_get_issue`
- Search/list issues: `linear_list_issues`
- Create/update issue: `linear_save_issue`
- Read comments: `linear_list_comments`
- Create/update comment: `linear_save_comment`

## Mutation approval workflow

Creating, updating, and commenting are allowed, but only after explicit user approval.

1. Build the proposed mutation as structured JSON.
2. Show the exact proposed payload to the user.
3. Ask for explicit approval.
4. Only after approval, call the mutating MCP tool.

Example preview before calling `linear_save_issue`:

```json
{
  "tool": "linear_save_issue",
  "args": {
    "id": "DAT-123",
    "description": "Line 1\n\n- Line 2"
  }
}
```

## Markdown formatting rules

- Use MCP structured arguments for normal Linear writes.
- Do not pass multiline Markdown through shell-escaped command arguments.
- For MCP descriptions/comments, provide literal newlines in the string. Linear's MCP schema says: "Do not escape the string — use literal newlines and special characters, not escape sequences."
- For very large mechanical repair jobs, prefer a deterministic local transform that fetches current content, changes only the target bytes, and writes it back after approval. Do not manually reconstruct huge descriptions in chat.

## Safety rules

- Never mutate Linear before showing the proposed payload and receiving explicit approval.
- Do not invent team IDs, state IDs, assignee IDs, or labels. Verify with Linear MCP reads first.
- Prefer linking to Linear issue URLs in final responses.
