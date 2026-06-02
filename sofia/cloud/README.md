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

Telegram daily digests also require these Edge Function secrets:

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=<telegram-bot-token>
supabase secrets set TELEGRAM_CHAT_ID=<telegram-chat-id>
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
mise run sofia-cloud:health
mise run sofia-cloud:set-telegram-secrets
mise run sofia-cloud:send-daily-digest
```

`sofia-cloud:deploy`, `sofia-cloud:functions-list`, `sofia-cloud:health`, and the Telegram tasks read the Supabase project ref from `SUPABASE_SOFIA_PROJECT_REF` when set, otherwise from the 1Password ref `op://dev_vault/Supabase SOFIA/project id`.

If Pi cannot fetch SOFIA boot context, run:

```bash
mise run sofia-cloud:health
```

Then follow `sofia/cloud/RUNBOOK.md` for the failing layer.

Legacy local-vault runtime tasks are grouped under `sofia-local:*` during the transition to cloud canonical storage.

## SOUL and operating instructions

`sofia/cloud/SOUL.md` defines Sofia's character: voice, posture, values, and privacy posture. It is included in SOFIA Cloud boot context so Pi sessions get the same personality layer as durable memory.

Keep responsibilities separate:

- `SOUL.md` — who Sofia is and how Sofia should feel to work with.
- SOFIA Cloud memories — durable facts, preferences, decisions, and lessons.
- `AGENTS.md` and skills — procedures, tool rules, workflow gates, and implementation guidance.

If `SOUL.md` changes, tell Justin. It is Sofia's soul, and he should know.

## Telegram evening digest

SOFIA can send a deterministic evening digest to Justin through Telegram. This v1 digest does not use OpenRouter or any model. It reads SOFIA Cloud database state, formats a short message, and calls Telegram Bot API `sendMessage`.

Digest contents:

- pending memory review count
- top 3 pending candidate titles
- recent capture count for the last 24 hours
- redaction count for the last 24 hours
- scheduled function health line

### Telegram bot setup

Telegram's bot documentation recommends creating bots through [@BotFather](https://t.me/botfather). The bot token is a secret: anyone with the token has full control of the bot.

1. In Telegram, message `@BotFather`.
2. Run `/newbot` and follow the prompts.
3. Copy the bot token into 1Password at `op://dev_vault/SOFIA Telegram/bot token`.
4. Open the new bot chat and send `/start`.
5. Read the chat id:

   ```bash
   TELEGRAM_BOT_TOKEN="$(op read 'op://dev_vault/SOFIA Telegram/bot token')"
   curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
   ```

   In the JSON response, use `message.chat.id` for the private chat with Justin.

6. Save that chat id in 1Password at `op://dev_vault/SOFIA Telegram/chat id`.
7. Set Edge Function secrets:

   ```bash
   mise run sofia-cloud:set-telegram-secrets
   ```

8. Deploy and test-send:

   ```bash
   mise run sofia-cloud:deploy
   mise run sofia-cloud:send-daily-digest
   ```

### Schedule setup

The migration `supabase/migrations/0003_daily_digest_schedule.sql` installs a `pg_cron` + `pg_net` job named `sofia-evening-telegram-digest` for `23:30 UTC` daily, which lands in Justin's evening Eastern time.

Before the job can invoke the protected endpoint, store the project URL and SOFIA access key in Supabase Vault:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'sofia_project_url');
select vault.create_secret('<MCP_ACCESS_KEY>', 'sofia_mcp_access_key');
```

Then push migrations:

```bash
cd sofia/cloud
supabase db push
```

Manual endpoint shape:

```bash
curl -X POST \
  -H "content-type: application/json" \
  -H "x-sofia-key: <MCP_ACCESS_KEY>" \
  https://<project-ref>.supabase.co/functions/v1/sofia-core/daily-digest
```

## Memory reconciliation

SOFIA can reconcile new memory candidates against active memories before promotion when enabled with:

```bash
SOFIA_RECONCILIATION_ENABLED=true
```

When disabled, capture uses the legacy route-and-promote behavior. When enabled, SOFIA archives exact duplicates, promotes genuinely new low-risk memories, versions safe high-confidence updates, and sends conflicts, merges, sensitive updates, and uncertain changes to the existing candidate review queue.

Reconciliation decisions are stored in `memory_reconciliations` and should be inspected through `review_candidates` when a candidate is pending review.

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
