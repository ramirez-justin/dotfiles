# SOFIA Cloud Runbook

SOFIA Cloud/Postgres is the canonical runtime memory source. If Pi cannot load SOFIA boot context, do not fall back to local Obsidian files. Run the health check and fix the failing layer.

```bash
mise run sofia-cloud:health
```

## What the health check covers

`sofia-cloud:health` checks, in order:

1. Supabase project ref resolution from `SUPABASE_SOFIA_PROJECT_REF` or 1Password.
2. Supabase project status from `supabase projects list --output json`.
3. DNS resolution for `<project-ref>.supabase.co`.
4. Edge Function reachability without a key; expected result is HTTP `401` or `403`.
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
3. If invalid, update the 1Password item `op://dev_vault/SOFIA MCP/access key` or the Supabase Edge Function secret so they match.
4. Retry health.

## After recovery

Verify boot context from Pi/MCP:

```bash
mise run sofia-cloud:health
```

Then start or reload Pi. If MCP metadata is stale, reconnect or reload the `sofia-cloud` server.
