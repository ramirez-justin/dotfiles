---
name: notion
description: Search, read, create, update, append content to, and comment on Notion pages/databases using the Notion API. Use when the user asks to find, inspect, create, or modify Notion content.
---

# Notion

Use `scripts/notion-api.py` from this skill directory. It requires `NOTION_API_KEY` or `NOTION_TOKEN` in the environment.

## Read-only commands

```bash
./scripts/notion-api.py search "query" --page-size 10
./scripts/notion-api.py page <page-id>
./scripts/notion-api.py block-children <block-or-page-id>
./scripts/notion-api.py database-query <database-id>
```

Optional filters/sorts are raw Notion JSON:

```bash
./scripts/notion-api.py search "roadmap" --filter '{"property":"object","value":"page"}'
```

## Mutating commands require approval

Creating, updating, appending blocks, and commenting are allowed, but only after explicit user approval.

Workflow:

1. Build the proposed mutation.
2. Run the command **without** `--yes` to preview the exact API payload.
3. Show the payload to the user and ask for approval.
4. Only after the user explicitly approves, rerun the same command with `--yes`.

```bash
./scripts/notion-api.py create-page --parent '{"database_id":"..."}' --properties '{...}'
./scripts/notion-api.py update-page <page-id> --properties '{...}'
./scripts/notion-api.py append-blocks <block-id> --children '[...]'
./scripts/notion-api.py comment <page-id> --text "Comment text"
```

After approval:

```bash
./scripts/notion-api.py comment <page-id> --text "Comment text" --yes
```

## Safety rules

- Never use `--yes` before showing the preview payload and receiving explicit approval.
- Use the Notion API's exact JSON shapes for properties and blocks.
- Verify page/database IDs with read-only calls before mutating.
- If a page or database is not accessible, tell the user the Notion integration may need to be granted access to it.
