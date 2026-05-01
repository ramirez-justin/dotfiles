# SOFIA Cloud

Cloud-capable SOFIA core built on Supabase Postgres, pgvector, and a remote MCP Edge Function.

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
   supabase functions deploy sofia-core --no-verify-jwt
   ```

6. MCP URL:

   ```text
   https://<project-ref>.supabase.co/functions/v1/sofia-core?key=<generated-key>
   ```
