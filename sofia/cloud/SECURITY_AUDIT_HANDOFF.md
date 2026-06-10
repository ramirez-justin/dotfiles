# SOFIA Cloud Supabase Security Audit Handoff

Date: 2026-06-09
Branch: `main`
Repo: `~/dev/dotfiles`
Project: Supabase `SOFIA` (`avgjtkgppeeihntsyjpy`)

## Purpose

This handoff captures the security state of SOFIA Cloud after fixing the immediate Supabase public API exposure alerts, plus the remaining hardening work found during a broader audit.

SOFIA Cloud is intended to be **Edge-Function-only**:

- Direct browser/client access to database tables: **no**
- Protected Supabase Edge Function using service role: **yes**
- Secrets stored in Supabase Edge Function secrets / 1Password: **yes**
- Raw secret values in git, docs, memory, or chat: **no**

## Immediate issue already fixed

Screenshots from Supabase showed critical warnings for project `SOFIA`:

- `sensitive_columns_exposed`
- `rls_disabled_in_public`

The likely exposed table was `public.reaction_events`, added by Phase 8 reaction telemetry.

### Fix applied

Migration:

- `sofia/cloud/supabase/migrations/0013_harden_public_api_access.sql`

Commit:

- `f591936 fix(sofia-cloud): harden public API table access`

What it does:

- Enables RLS on `public.reaction_events`.
- Adds service-role-only policy for `reaction_events`.
- Enables RLS defensively on all current public base tables.
- Revokes direct `anon` / `authenticated` table and sequence privileges in `public`.
- Preserves `service_role` access for the Edge Function.
- Adds some default privilege revokes/grants, but see the remaining default-privilege issue below.

### Verification already performed

Commands/results from the live project:

- `supabase db push --workdir .`
  - Applied `0013_harden_public_api_access.sql` successfully.
- Linked project verification showed:
  - `reaction_events.rls_enabled = true`
  - no direct `anon` / `authenticated` grants on `reaction_events`
  - `service_role` retained table privileges
- `supabase db advisors --linked --workdir . --type security --output json`
  - No longer reported `rls_disabled_in_public`.
  - No longer reported `sensitive_columns_exposed`.
  - Still reported unrelated warnings listed below.
- `mise run sofia-cloud:test`
  - `93 passed | 0 failed`

## Current live Supabase posture

### Good state

Live queries showed every current public base table has RLS enabled, including:

- `events`
- `memory_candidates`
- `memories`
- `memory_versions`
- `compiled_artifacts`
- `boot_context_snapshots`
- `todos`
- `agent_sessions`
- `task_runs`
- `task_artifacts`
- `session_handoffs`
- `reaction_events`

Live query for direct `anon` / `authenticated` table grants returned no rows.

Current table policies are service-role-only, e.g.:

```sql
(auth.role() = 'service_role'::text)
```

This matches the SOFIA Cloud architecture.

### Remaining Supabase advisor warnings

Live `supabase db advisors --linked --workdir . --type security --output json` still reported:

1. `function_search_path_mutable`
   - `public.sofia_set_updated_at`
   - `public.sofia_content_fingerprint`
   - `public.match_memories`
2. `extension_in_public`
   - `vector` installed in `public`

These are distinct from the earlier critical public-table exposure.

## Findings by severity

### P1: Default privileges can recreate public exposure

Live default privilege query showed `supabase_admin` default privileges still grant future public objects to `anon` / `authenticated`:

- future tables: broad privileges to `anon` / `authenticated`
- future sequences: sequence privileges to `anon` / `authenticated`
- future functions: execute privileges to `anon` / `authenticated`

This means a future migration run as `supabase_admin` could accidentally recreate the same class of public exposure, even though current tables are safe.

#### Recommended fix

Add a migration that explicitly alters default privileges for both likely migration owner roles:

```sql
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, public;

alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated;
alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role supabase_admin in schema public revoke execute on functions from anon, authenticated, public;

alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

alter default privileges for role supabase_admin in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges for role supabase_admin in schema public grant usage, select on sequences to service_role;
alter default privileges for role supabase_admin in schema public grant execute on functions to service_role;
```

Verify with:

```bash
supabase db query --linked --workdir . --output table \
  "select defaclrole::regrole::text as owner, defaclnamespace::regnamespace::text as schema, defaclobjtype as object_type, defaclacl::text as acl from pg_default_acl where defaclnamespace = 'public'::regnamespace order by owner, object_type;"
```

### P1: Custom public functions executable by client roles

Live query found these custom functions executable by `anon` and `authenticated`:

- `public.match_memories(...)`
- `public.sofia_content_fingerprint(text)`
- `public.sofia_set_updated_at()`

`match_memories` is the important one. Current RLS/table grants likely prevent useful direct abuse, but SOFIA Cloud should not expose this RPC to client roles at all.

#### Recommended fix

Add a migration that revokes execute from client roles and grants only to `service_role`:

```sql
revoke execute on function public.match_memories(vector, double precision, integer, text, boolean, text, uuid, text) from anon, authenticated, public;
revoke execute on function public.sofia_content_fingerprint(text) from anon, authenticated, public;
revoke execute on function public.sofia_set_updated_at() from anon, authenticated, public;

grant execute on function public.match_memories(vector, double precision, integer, text, boolean, text, uuid, text) to service_role;
grant execute on function public.sofia_content_fingerprint(text) to service_role;
grant execute on function public.sofia_set_updated_at() to service_role;
```

Verify custom function grants only, excluding extension functions:

```bash
supabase db query --linked --workdir . --output table \
  "select n.nspname as schema, p.proname as function, pg_get_function_identity_arguments(p.oid) as args, r.rolname as grantee from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on has_function_privilege(r.oid, p.oid, 'EXECUTE') left join pg_depend dep on dep.objid=p.oid and dep.deptype='e' left join pg_extension ext on ext.oid=dep.refobjid where n.nspname='public' and ext.oid is null and r.rolname in ('anon','authenticated','public') order by p.proname, grantee;"
```

Expected: no rows for SOFIA custom functions.

### P1: SQL functions have mutable `search_path`

Supabase advisor reports mutable search path on:

- `sofia_set_updated_at`
- `sofia_content_fingerprint`
- `match_memories`

This is a standard Postgres hardening issue. A function without a fixed `search_path` can resolve unqualified names through caller-influenced or role-influenced paths.

#### Recommended fix

Set fixed search paths in a migration.

Likely pattern:

```sql
alter function public.sofia_set_updated_at()
  set search_path = public, pg_catalog;

alter function public.sofia_content_fingerprint(text)
  set search_path = public, extensions, pg_catalog;

alter function public.match_memories(vector, double precision, integer, text, boolean, text, uuid, text)
  set search_path = public, extensions, pg_catalog;
```

Confirm exact function identity args from live DB before writing the migration:

```bash
supabase db query --linked --workdir . --output table \
  "select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('sofia_set_updated_at','sofia_content_fingerprint','match_memories') order by 1;"
```

### P2: Query-string SOFIA key auth

`supabase/functions/sofia-core/index.ts` accepts the SOFIA access key from either:

- `x-sofia-key` header
- `?key=...` query parameter

Relevant code:

```ts
const provided = c.req.header("x-sofia-key") ||
  new URL(c.req.url).searchParams.get("key");
```

The README documents query-string key support for clients that cannot set headers.

This is convenient, but query-string secrets can leak through:

- logs
- browser history
- request telemetry
- copied URLs
- referrers in some contexts

#### Recommended fix

Deprecate query-string auth and require `x-sofia-key`.

If compatibility is needed, add a feature flag first:

```ts
const ALLOW_QUERY_KEY = Deno.env.get("SOFIA_ALLOW_QUERY_KEY") === "true";
const urlKey = ALLOW_QUERY_KEY ? new URL(c.req.url).searchParams.get("key") : null;
const provided = c.req.header("x-sofia-key") || urlKey;
```

Then set `SOFIA_ALLOW_QUERY_KEY=false` in production once clients are updated.

### P2: Key comparison uses plain string equality

The Edge Function compares the provided SOFIA key using normal string equality:

```ts
provided !== MCP_ACCESS_KEY
```

For a private, high-entropy key this is probably acceptable, but constant-time comparison is better practice.

#### Recommended fix

Implement a small constant-time comparison helper over UTF-8 bytes and use it for the SOFIA key comparison.

### P2: No failed-auth telemetry or rate limiting

The Edge Function returns `401` for missing/invalid keys, but it does not record failed auth attempts or apply throttling.

Given a 64-character random access key, brute force is impractical. Still, failed-auth telemetry would help detect scanning or leaked URLs.

#### Recommended fix

Options:

- Add a lightweight `auth_attempt_events` table with coarse timestamp/source metadata.
- Use Supabase/Cloudflare rate limits if exposed beyond trusted agent clients.
- Consider per-client keys later if multiple agents or integrations use SOFIA Cloud.

### P2: Secret redaction is incomplete

`supabase/functions/sofia-core/redact.ts` currently catches:

- private keys
- OpenAI-style `sk-...` keys
- GitHub tokens
- AWS access keys
- Slack tokens
- Bearer tokens

It does not catch several likely SOFIA/Supabase secrets:

- Supabase JWT-style anon/service role keys
- `sb_secret_...`
- Telegram bot tokens
- raw 64-character hex MCP access keys
- Postgres/pooler URLs with embedded credentials
- OpenRouter `sk-or-...` if not matched by the current generic `sk-` pattern in all cases
- `.env` assignments like `PASSWORD=...`, `API_KEY=...`, `TOKEN=...`

Because `capture_event` stores content and may send content for embedding/classification, redaction should be stronger.

#### Recommended fix

Expand redaction patterns before any database insert, embedding, or classifier call. Add tests in `redact_test.ts` for:

- Supabase JWTs or JWT-like service-role strings
- `sb_secret_...`
- Telegram `123456:ABC...` bot token shape
- 64-char hex strings when labeled as MCP/access keys
- Postgres URLs with credentials
- common `.env` assignment forms

### P2: Captured content is sent to OpenRouter

`capture_event` does this pipeline:

1. pattern-based redaction
2. embedding request to OpenRouter
3. classification request to OpenRouter
4. storage/reconciliation in Supabase

This means non-secret but private content can leave SOFIA Cloud and go to OpenRouter.

This may be acceptable for Justin's setup, but it should be documented as an explicit privacy boundary.

#### Recommended fix

Add one or more of:

- `local_only` / `no_model` capture mode
- skip embeddings/classification when redaction occurs
- skip embeddings/classification for explicit sensitive metadata/type hints
- document the privacy boundary in `README.md` / `RUNBOOK.md`

### P3: `vector` extension installed in `public`

Live Supabase advisor reports:

- `extension_in_public`: `vector` is installed in `public`

This is less urgent than the default privilege and function-grant issues. Moving `vector` can be invasive because table columns and SQL functions reference the type.

#### Recommended fix

Defer until after P1/P2 fixes. If done, use a careful migration with full local and live smoke testing. Expect to update function signatures and references if the type becomes `extensions.vector` or similar.

### P3: View security semantics

Views in `public` do not have RLS, which is normal. Current client table grants are removed, so they are not exposed to `anon` / `authenticated` right now.

Views include:

- `memory_ops_health_summary`
- `memory_ops_pending_review_summary`
- `memory_ops_retrieval_usefulness_summary`
- `reaction_learning_patterns`
- `reaction_recent_negative_signals`
- `unresolved_memory_contradictions`
- `weak_provenance_memories`

#### Recommended fix

Keep no client grants on views. For sensitive report views, consider explicit `security_invoker` where supported.

## Edge Function audit details

Reviewed files:

- `supabase/functions/sofia-core/index.ts`
- `supabase/functions/sofia-core/http.ts`
- `supabase/functions/sofia-core/db.ts`
- `supabase/functions/sofia-core/classifier.ts`
- `supabase/functions/sofia-core/redact.ts`
- `supabase/functions/sofia-core/daily_digest.ts`
- `supabase/functions/sofia-core/reactions.ts`
- `supabase/functions/sofia-core/boot_context.ts`

### Positive findings

- Central auth gate exists in `index.ts` before boot context, daily digest, MCP, and JSON-RPC handling.
- CORS is conservative: `Access-Control-Allow-Origin` is only returned for origins listed in `SOFIA_ALLOWED_ORIGINS`.
- Service-role access is only in the Edge Function via `SUPABASE_SERVICE_ROLE_KEY`.
- MCP outputs sanitize embeddings via `sanitizeRowsForMcp` / `sanitizeRowForMcp`.
- Reaction event previews pass through `redactSecrets`.
- Entity-scoped boot context has a safety invariant: missing entity returns scoped empty result rather than global fallback.

### Risks to address

- Query-string key support.
- Plain string key comparison.
- No failed-auth telemetry/rate limiting.
- Incomplete redaction.
- External model/privacy boundary for captured content.

## Useful commands

Run from `~/dev/dotfiles/sofia/cloud` unless noted.

### Supabase live advisors

```bash
supabase db advisors --linked --workdir . --type security --output json
```

### Current public relations and RLS

```bash
supabase db query --linked --workdir . --output table \
  "select c.relname as relation, case c.relkind when 'r' then 'table' when 'p' then 'partitioned_table' when 'v' then 'view' when 'm' then 'materialized_view' else c.relkind::text end as kind, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as force_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m') order by kind, relation;"
```

### Direct grants to client roles

```bash
supabase db query --linked --workdir . --output table \
  "select table_schema, table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') group by table_schema, table_name, grantee order by table_name, grantee;"
```

Expected current result: no rows.

### Policies

```bash
supabase db query --linked --workdir . --output table \
  "select tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname='public' order by tablename, policyname;"
```

### Custom function grants to client roles

```bash
supabase db query --linked --workdir . --output table \
  "select n.nspname as schema, p.proname as function, pg_get_function_identity_arguments(p.oid) as args, r.rolname as grantee from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on has_function_privilege(r.oid, p.oid, 'EXECUTE') left join pg_depend dep on dep.objid=p.oid and dep.deptype='e' left join pg_extension ext on ext.oid=dep.refobjid where n.nspname='public' and ext.oid is null and r.rolname in ('anon','authenticated','public') order by p.proname, grantee;"
```

Expected after fix: no rows for SOFIA custom functions.

### Function signatures

```bash
supabase db query --linked --workdir . --output table \
  "select p.oid::regprocedure::text as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('sofia_set_updated_at','sofia_content_fingerprint','match_memories') order by 1;"
```

### Default privileges

```bash
supabase db query --linked --workdir . --output table \
  "select defaclrole::regrole::text as owner, defaclnamespace::regnamespace::text as schema, defaclobjtype as object_type, defaclacl::text as acl from pg_default_acl where defaclnamespace = 'public'::regnamespace order by owner, object_type;"
```

### Realtime publication tables

```bash
supabase db query --linked --workdir . --output table \
  "select schemaname, tablename from pg_publication_tables where pubname='supabase_realtime' order by schemaname, tablename;"
```

### SOFIA Cloud tests

From repo root:

```bash
mise run sofia-cloud:test
```

Expected current result:

```text
93 passed | 0 failed
```

### SOFIA Cloud health

```bash
source ~/.pi/agent/env.zsh
SUPABASE_SOFIA_PROJECT_REF="$(tr -d '\n' < supabase/.temp/project-ref)" mise run sofia-cloud:health
```

Known caveat: the health check may fail the `supabase projects` step if `SUPABASE_ACCESS_TOKEN` is not available, while still showing DNS/function/authenticated boot context as OK.

## Suggested next implementation plan

1. Add migration `0014_harden_functions_and_defaults.sql`:
   - revoke default future table/sequence/function privileges for `postgres` and `supabase_admin`
   - grant future defaults only to `service_role`
   - revoke execute on custom SOFIA functions from `anon`, `authenticated`, `public`
   - grant execute on custom SOFIA functions to `service_role`
   - set fixed `search_path` on custom SOFIA functions
2. Run:
   - `supabase db push --workdir .`
   - live advisor check
   - function grant/default privilege verification queries
   - `mise run sofia-cloud:test`
   - live MCP smoke, e.g. `search_memory` or `get_boot_context`
3. Add redaction expansion and tests.
4. Feature-flag or remove query-string key auth.
5. Document OpenRouter privacy boundary and optional no-model capture path.
6. Defer moving `vector` out of `public` until after the above.

## Audit limitation

A live Edge auth probe command was blocked by the safety interlock before completion and was not retried. Health checks and earlier verification showed the Edge Function requires auth and authenticated boot context works, but this specific curl probe was not completed in the audit session.
