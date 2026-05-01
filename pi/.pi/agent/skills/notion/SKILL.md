---
name: notion
description: Search, read, create, update, append content to, and comment on Notion pages/databases using Notion MCP. Use when the user asks to find, inspect, create, or modify Notion content.
---

# Notion

Prefer Notion MCP through `pi-mcp-adapter`. This Pi setup uses `pi-mcp-adapter`; do not assume Pi lacks MCP support.

Before Notion work, check MCP availability with the `mcp` proxy:

```text
mcp({})
mcp({ connect: "notion" })
mcp({ server: "notion" })
```

Current preferred server config is the official Notion remote MCP server at `https://mcp.notion.com/mcp` with OAuth via the adapter.

## Common MCP tools

Use tool discovery for exact schemas before mutating:

```text
mcp({ server: "notion" })
mcp({ describe: "notion_notion-search" })
mcp({ describe: "notion_notion-fetch" })
mcp({ describe: "notion_notion-create-pages" })
mcp({ describe: "notion_notion-update-page" })
mcp({ describe: "notion_notion-create-comment" })
```

Typical operations:

- Search workspace content and connected sources: `notion_notion-search`
- Fetch pages, databases, data sources, and page content: `notion_notion-fetch`
- Create pages: `notion_notion-create-pages`
- Update page properties/content: `notion_notion-update-page`
- Move or duplicate pages: `notion_notion-move-pages`, `notion_notion-duplicate-page`
- Create comments or read discussions: `notion_notion-create-comment`, `notion_notion-get-comments`
- Query database views: `notion_notion-query-database-view`
- Create/update databases and views: `notion_notion-create-database`, `notion_notion-update-data-source`, `notion_notion-create-view`, `notion_notion-update-view`
- Read Notion-enhanced Markdown syntax before content writes: `notion_get_enhanced_markdown_specification`

## Mutation approval workflow

Creating, updating, moving, duplicating, appending/replacing content, archiving/deleting, and commenting are allowed, but only after explicit user approval.

1. Build the proposed mutation as structured JSON.
2. Show the exact proposed payload to the user.
3. Ask for explicit approval.
4. Only after approval, call the mutating MCP tool.

Example preview before a Notion MCP mutation:

```json
{
  "tool": "notion_notion-update-page",
  "args": {
    "page_id": "<verified-page-id>",
    "command": "update_content",
    "content_updates": [
      {
        "old_str": "Existing text",
        "new_str": "Existing text\n\nNew text"
      }
    ]
  }
}
```

## Markdown, blocks, and large content

- Use MCP structured arguments for Notion reads/writes.
- Do not pass multiline Markdown or Notion block JSON through shell-escaped command arguments.
- Before writing page content, fetch `notion_get_enhanced_markdown_specification`; do not guess Notion-flavored Markdown syntax.
- Before updating page content, fetch the page first and use `update_content` with exact `old_str`/`new_str` snippets when possible instead of replacing whole pages.
- If `replace_content` would delete child pages or databases, show the list of affected items and get explicit confirmation before allowing deletion.
- Verify page, database, data source, view, user, and block IDs with read-only MCP calls before mutating.
- If a page or database is not accessible, tell the user the Notion integration may need to be granted access to it.
- For very large mechanical repair jobs, prefer a deterministic local transform that fetches current content, changes only the target bytes, and writes it back after approval. Do not manually reconstruct huge pages or block trees in chat.

## Safety rules

- Never mutate Notion before showing the proposed payload and receiving explicit approval.
- Do not invent page IDs, database IDs, data source IDs, view URLs, property schemas, user IDs, or block IDs. Verify with Notion MCP reads first.
- Prefer linking to Notion page URLs in final responses when available.
