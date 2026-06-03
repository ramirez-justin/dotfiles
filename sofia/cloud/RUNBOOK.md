# SOFIA Cloud Runbook

SOFIA Cloud/Postgres is the canonical runtime memory source. If Pi cannot load
SOFIA boot context, do not fall back to local Obsidian files. Run the health
check and fix the failing layer.

```bash
mise run sofia-cloud:health
```

## What the health check covers

`sofia-cloud:health` checks, in order:

1. Supabase project ref resolution from `SUPABASE_SOFIA_PROJECT_REF` or
   1Password.
2. Supabase project status from `supabase projects list --output json`.
3. DNS resolution for `<project-ref>.supabase.co`.
4. Edge Function reachability without a key; expected result is HTTP `401` or
   `403`.
5. `SOFIA_MCP_ACCESS_KEY` presence.
6. Authenticated personal boot context at `/boot-context?context=personal`.

## Common failures

### 1Password authorization timeout

Symptoms:

- Health check fails at `project ref`.
- `op read ...` reports an authorization timeout.

Recovery:

1. Unlock or reauthenticate 1Password CLI.
2. Retry:

   ```bash
   mise run sofia-cloud:health
   ```

Alternative:

```bash
export SUPABASE_SOFIA_PROJECT_REF=<project-ref>
```

### Supabase project `INACTIVE`

Symptoms:

- Health check reports project status `INACTIVE`.
- DNS may return `NXDOMAIN` for `<project-ref>.supabase.co`.
- Pi boot context fails before reaching SOFIA MCP.

Recovery:

1. Restore/reactivate the SOFIA project in the Supabase dashboard.
2. Wait while status moves through `COMING_UP` or `RESTORING`.
3. Retry health until project status is `ACTIVE_HEALTHY`.

### DNS `NXDOMAIN`

Symptoms:

- Health check fails DNS for `<project-ref>.supabase.co`.
- `nslookup <project-ref>.supabase.co` reports `NXDOMAIN`.

Likely causes:

- Supabase project is inactive.
- Supabase project is still restoring.
- Project ref is wrong.

Recovery:

1. Verify the project ref:

   ```bash
   supabase projects list --output json
   ```

2. Restore/wait if project status is inactive or restoring.
3. Retry health.

### Cloudflare `521`

Symptoms:

- Edge Function or boot context check returns HTTP `521`.
- Supabase project may already have DNS records again.

Likely cause:

- Supabase/Cloudflare is reachable, but the project backend is still coming up.

Recovery:

1. Check project status.
2. Wait a few minutes if status is `COMING_UP` or `RESTORING`.
3. Retry health.

### Edge Function returns unexpected non-auth status without key

Expected unauthenticated result is HTTP `401` or `403`.

If the check returns another status:

1. Verify the function is deployed:

   ```bash
   mise run sofia-cloud:functions-list
   ```

2. Redeploy if needed:

   ```bash
   mise run sofia-cloud:deploy
   ```

### Missing or invalid `SOFIA_MCP_ACCESS_KEY`

Symptoms:

- Health check fails `SOFIA_MCP_ACCESS_KEY`.
- Authenticated boot context returns HTTP `401` or `403`.

Recovery:

1. Source Pi environment:

   ```bash
   source ~/.pi/agent/env.zsh
   ```

2. If still missing, unlock 1Password CLI and source again.
3. If invalid, update the 1Password item `op://dev_vault/SOFIA MCP/access key`
   or the Supabase Edge Function secret so they match.
4. Retry health.

### Telegram digest does not arrive

Symptoms:

- `sofia-evening-telegram-digest` is scheduled, but no Telegram message arrives.
- Manual `mise run sofia-cloud:send-daily-digest` fails.

Recovery:

1. Confirm the Edge Function has Telegram secrets:

   ```bash
   mise run sofia-cloud:set-telegram-secrets
   mise run sofia-cloud:deploy
   ```

2. Confirm the bot token and chat id by sending `/start` to the bot and
   checking:

   ```bash
   TELEGRAM_BOT_TOKEN="$(op read 'op://dev_vault/SOFIA Telegram/password')"
   curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
   ```

3. Trigger a manual send:

   ```bash
   mise run sofia-cloud:send-daily-digest
   ```

4. If the manual send works but the scheduled send does not, inspect the
   Supabase cron job and Vault secrets:

   ```sql
   select * from cron.job where jobname = 'sofia-evening-telegram-digest';
   select name from vault.decrypted_secrets where name in ('sofia_project_url', 'sofia_mcp_access_key');
   ```

5. If Vault secrets are missing, create them:

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'sofia_project_url');
   select vault.create_secret('<MCP_ACCESS_KEY>', 'sofia_mcp_access_key');
   ```

## Agent-native memory debugging

When an agent appears to know a fact, inspect the compiled boot context and its
snapshot before assuming vector search returned it:

1. Call `get_boot_context` or fetch `/boot-context?context=<context>` and note
   the `snapshot_id`, `included_memory_ids`, and `included_todo_ids`.
2. Inspect `boot_context_snapshots` for that snapshot to see the exact rendered
   markdown, source query, compiler version, and token count.
3. For a specific memory, inspect `memory_provenance` to verify source type,
   source ref/URI, capture actor, evidence snippet/summary, confidence, and
   last verification timestamp.
4. If a retrieved memory was stale or confusing, record feedback through the
   `record_memory_feedback` MCP tool so retrieval policy can be tuned later.
5. Todos/open loops should be checked in `todos`, not in `memories`.

Useful SQL shapes:

```sql
select id, generated_at, included_memory_ids, included_todo_ids, token_count
from boot_context_snapshots
where context = 'personal'
order by generated_at desc
limit 5;

select source_type, source_ref, captured_by, confidence, evidence_summary,
       last_verified_at
from memory_provenance
where memory_id = '<memory-id>'
order by created_at desc;

select id, title, status, priority, due_at
from todos
where context = 'personal' and status in ('open', 'in_progress', 'blocked')
order by priority desc, created_at desc;
```

## After recovery

Verify boot context from Pi/MCP:

```bash
mise run sofia-cloud:health
```

Then start or reload Pi. If MCP metadata is stale, reconnect or reload the
`sofia-cloud` server.

## Phase 2 lifecycle maintenance

Run lifecycle maintenance after deployments or when stale/expired memory behavior looks wrong:

```bash
# via MCP tool: run_lifecycle_maintenance
# or live smoke through Hermes once MCP tools are reloaded:
hermes --profile sofia-spike mcp test sofia-cloud
```

The Phase 2 lifecycle path:

1. Active memories with `stale_after < now()` or `expires_at < now()` are marked `stale` and removed from boot-context eligibility.
2. Default vector search excludes inactive, expired, and stale memories unless `include_archived=true` is explicitly used for audit/debugging.
3. Boot-context compilation defensively filters expired/stale rows even if maintenance has not run yet.
4. High-priority stale memories queue `pending_review` open-loop candidates with `metadata.review_type = 'stale_memory'` so Justin/agents can verify, update, supersede, or archive them.
5. Safe high-confidence reconciliation updates now create a new active memory and mark the old memory `superseded`, linked by a `memory_edges.relation = 'supersedes'` edge.

Useful SQL:

```sql
select id, title, status, retrieval_priority, stale_after, expires_at, review_reason
from memories
where status in ('stale', 'superseded')
order by updated_at desc
limit 20;

select id, candidate_text, metadata->>'source_memory_id' as source_memory_id
from memory_candidates
where status = 'pending_review'
  and metadata->>'review_type' = 'stale_memory'
order by created_at desc;

select from_memory_id, to_memory_id, relation, metadata
from memory_edges
where relation = 'supersedes'
order by created_at desc
limit 20;
```

## Cross-agent SOFIA consistency

Pi and Hermes must point at the same SOFIA Cloud project and use env/1Password secret references, not raw keys. Run:

```bash
cd ~/dev/dotfiles
mise run sofia-cloud:agent-consistency
```

For a live boot-context fetch through the linked Hermes helper:

```bash
SOFIA_AGENT_CONSISTENCY_LIVE=1 mise run sofia-cloud:agent-consistency
```

This check verifies the Supabase project ref, Pi `mcp.json`, Hermes `sofia-spike` MCP config, local-memory disabled state, lifecycle tool exposure, and optional live SOFIA Cloud boot-context markers.
