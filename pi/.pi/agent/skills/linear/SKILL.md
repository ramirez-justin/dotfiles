---
name: linear
description: Search, read, create, update, and comment on Linear issues using the Linear API. Use when the user asks about Linear issues, teams, assigned work, or wants to create/update/comment on Linear tickets.
---

# Linear

Use `scripts/linear-api.py` from this skill directory. It requires `LINEAR_API_KEY` or `LINEAR_API_TOKEN` in the environment.

## Read-only commands

```bash
./scripts/linear-api.py viewer
./scripts/linear-api.py teams
./scripts/linear-api.py assigned --first 25
./scripts/linear-api.py search "query text" --first 25
./scripts/linear-api.py get ABC-123
```

## Mutating commands require approval

Creating, updating, and commenting are allowed, but only after explicit user approval.

Workflow:

1. Build the proposed mutation.
2. Run the command **without** `--yes` to preview the exact API payload.
3. Show the payload to the user and ask for approval.
4. Only after the user explicitly approves, rerun the same command with `--yes`.

```bash
./scripts/linear-api.py create --team-id <team-id> --title "Title" --description "Body"
./scripts/linear-api.py update ABC-123 --title "New title"
./scripts/linear-api.py comment ABC-123 --body "Comment text"
```

After approval:

```bash
./scripts/linear-api.py comment ABC-123 --body "Comment text" --yes
```

## Safety rules

- Never use `--yes` before showing the preview payload and receiving explicit approval.
- Do not invent team IDs, state IDs, or assignee IDs. Use `teams`, `viewer`, `get`, or existing issue data to verify IDs first.
- Prefer linking to Linear issue URLs in final responses.
