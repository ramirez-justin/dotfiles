-- Harden SOFIA Cloud public-schema API exposure.
--
-- SOFIA is accessed through the protected Edge Function using the Supabase
-- service role. No public/anon/authenticated client should read or mutate the
-- underlying Postgres tables directly through PostgREST.

-- Fix the Phase 8 table that was created without RLS.
alter table if exists public.reaction_events enable row level security;

-- Keep the service-role-only access pattern used by the rest of SOFIA Cloud.
drop policy if exists "service role manages reaction_events" on public.reaction_events;
create policy "service role manages reaction_events"
  on public.reaction_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select, insert, update, delete on table public.reaction_events to service_role;

-- Defense in depth: make every current public base table RLS-protected. This is
-- idempotent and catches any table missed by an earlier migration.
do $$
declare
  table_record record;
begin
  for table_record in
    select format('%I.%I', n.nspname, c.relname) as qualified_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format('alter table %s enable row level security', table_record.qualified_name);
  end loop;
end $$;

-- SOFIA Cloud has no direct browser/client API. Remove direct table/view access
-- from Supabase's public API roles; Edge Functions continue to use service_role.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

-- Preserve service-role access for all current public relations/sequences.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Keep future public-schema relations private by default for client roles when
-- migrations run as the project owner.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
