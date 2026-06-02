create schema if not exists vault;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Store these once per project before relying on the schedule:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'sofia_project_url');
--   select vault.create_secret('<MCP_ACCESS_KEY>', 'sofia_mcp_access_key');
--
-- The Edge Function itself reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from
-- Supabase Edge Function secrets. The cron job only needs to invoke the
-- protected /daily-digest endpoint.
do $$
begin
  perform cron.unschedule('sofia-evening-telegram-digest');
exception
  when others then null;
end $$;

select cron.schedule(
  'sofia-evening-telegram-digest',
  '30 23 * * *', -- 23:30 UTC: evening in Justin's Eastern time zone.
  $$
  select
    net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sofia_project_url') || '/functions/v1/sofia-core/daily-digest',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sofia-key', (select decrypted_secret from vault.decrypted_secrets where name = 'sofia_mcp_access_key')
      ),
      body := jsonb_build_object('scheduled_at', now(), 'source', 'pg_cron'),
      timeout_milliseconds := 10000
    ) as request_id;
  $$
);
