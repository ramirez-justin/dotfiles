# SOFIA Cloud

Cloud-capable SOFIA core built on Supabase Postgres, pgvector, and a remote MCP Edge Function.

SOFIA Cloud/Postgres is the canonical runtime memory source. Pi startup boot context must be fetched from SOFIA Cloud; local Obsidian/Markdown files are generated or human-facing views only and must not be used as a startup fallback. If cloud boot context cannot be fetched, surface the failure instead of silently falling back to local `_agent` files.

## Runtime pieces

- `supabase/migrations/` — canonical SQL schema
- `supabase/functions/sofia-core/` — MCP + API Edge Function

## Required Supabase secrets

Set these before deployment:

```bash
supabase secrets set MCP_ACCESS_KEY=<hex-access-key>
supabase secrets set OPENROUTER_API_KEY=<provider-key>
```

Supabase provides these automatically inside Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Recommended secret handling

Keep secret values in 1Password. Store only references in notes/docs. Never paste service-role keys into SOFIA memory, events, artifacts, or chat.

## First deploy checklist

1. Create a Supabase project.
2. Link local checkout:

   ```bash
   cd sofia/cloud
   supabase link --project-ref <project-ref>
   ```

3. Push schema:

   ```bash
   supabase db push
   ```

4. Set secrets:

   ```bash
   supabase secrets set MCP_ACCESS_KEY=<generated-key>
   supabase secrets set OPENROUTER_API_KEY=<provider-key>
   ```

5. Deploy function:

   ```bash
   mise run sofia-cloud:deploy
   ```

6. MCP URL:

   ```text
   https://<project-ref>.supabase.co/functions/v1/sofia-core
   ```

   For clients that cannot set custom headers, the endpoint also accepts:

   ```text
   https://<project-ref>.supabase.co/functions/v1/sofia-core?key=<generated-key>
   ```

## Operator tasks

Reusable tasks live in the repo `mise.toml`:

```bash
mise run sofia-cloud:test
mise run sofia-cloud:check
mise run sofia-cloud:deploy
mise run sofia-cloud:functions-list
```

`sofia-cloud:deploy` and `sofia-cloud:functions-list` read the Supabase project ref from `SUPABASE_SOFIA_PROJECT_REF` when set, otherwise from the 1Password ref `op://dev_vault/Supabase SOFIA/project id`.

Legacy local-vault runtime tasks are grouped under `sofia-local:*` during the transition to cloud canonical storage.

## Pi MCP client setup

Pi uses `pi-mcp-adapter` and reads `~/.pi/agent/mcp.json` from this dotfiles repo. The SOFIA cloud server is configured with a custom header rather than putting the access key in the URL:

```json
{
  "mcpServers": {
    "sofia-cloud": {
      "url": "https://<project-ref>.supabase.co/functions/v1/sofia-core",
      "headers": {
        "x-sofia-key": "${SOFIA_MCP_ACCESS_KEY}"
      },
      "auth": false,
      "lifecycle": "lazy"
    }
  }
}
```

`~/.pi/agent/env.zsh` populates `SOFIA_MCP_ACCESS_KEY` from the 1Password ref `op://dev_vault/SOFIA MCP/access key` if it is not already set. After changing MCP config in a running Pi session, run `/reload` before using the new server.

Available tools:

- `capture_event`
- `search_memory`
- `list_recent`
- `review_candidates`
- `archive_memory`
- `get_artifact`
