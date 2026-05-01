create extension if not exists vector;
create extension if not exists pgcrypto;

create or replace function sofia_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  context text not null check (context in ('personal', 'work', 'shared')),
  source text not null,
  source_ref text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  content_fingerprint text,
  sensitivity text not null default 'normal'
    check (sensitivity in ('normal', 'private', 'secret_redacted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_events_content_fingerprint
  on events (content_fingerprint)
  where content_fingerprint is not null;

create index if not exists idx_events_context_created_at
  on events (context, created_at desc);

create index if not exists idx_events_metadata
  on events using gin (metadata);

create index if not exists idx_events_embedding
  on events using hnsw (embedding vector_cosine_ops);

create table if not exists memory_candidates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  context text not null check (context in ('personal', 'work', 'shared')),
  candidate_type text not null check (candidate_type in (
    'fact',
    'preference',
    'decision',
    'lesson',
    'gotcha',
    'project_context',
    'person_context',
    'operating_rule',
    'todo',
    'open_loop'
  )),
  candidate_text text not null,
  worthiness_score real not null check (worthiness_score >= 0 and worthiness_score <= 1),
  confidence real not null check (confidence >= 0 and confidence <= 1),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  recommended_action text not null check (recommended_action in ('auto_promote', 'review', 'archive', 'reject')),
  reasoning text,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'auto_promoted', 'approved', 'rejected', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_memory_candidates_status_context
  on memory_candidates (status, context, created_at desc);

create index if not exists idx_memory_candidates_event
  on memory_candidates (event_id);

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  context text not null check (context in ('personal', 'work', 'shared')),
  memory_type text not null check (memory_type in (
    'fact',
    'preference',
    'decision',
    'lesson',
    'gotcha',
    'project_context',
    'person_context',
    'operating_rule'
  )),
  title text not null,
  body text not null,
  embedding vector(1536),
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  status text not null default 'active'
    check (status in ('active', 'superseded', 'archived', 'rejected')),
  created_from_candidate_id uuid references memory_candidates(id),
  current_version int not null default 1 check (current_version > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_memories_context_type_status
  on memories (context, memory_type, status, created_at desc);

create index if not exists idx_memories_embedding
  on memories using hnsw (embedding vector_cosine_ops);

create table if not exists memory_versions (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references memories(id) on delete cascade,
  version int not null check (version > 0),
  title text not null,
  body text not null,
  change_reason text,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  unique(memory_id, version)
);

create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('person', 'project', 'place', 'system', 'topic', 'organization', 'artifact')),
  name text not null,
  normalized_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entity_type, normalized_name)
);

create table if not exists event_entities (
  event_id uuid not null references events(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  evidence text,
  created_at timestamptz not null default now(),
  primary key (event_id, entity_id)
);

create table if not exists memory_entities (
  memory_id uuid not null references memories(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  evidence text,
  created_at timestamptz not null default now(),
  primary key (memory_id, entity_id)
);

create table if not exists memory_edges (
  id uuid primary key default gen_random_uuid(),
  from_memory_id uuid not null references memories(id) on delete cascade,
  to_memory_id uuid not null references memories(id) on delete cascade,
  relation text not null check (relation in ('supports', 'contradicts', 'supersedes', 'depends_on', 'related_to', 'evolved_into')),
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  rationale text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(from_memory_id, to_memory_id, relation),
  check (from_memory_id <> to_memory_id)
);

create table if not exists compiled_artifacts (
  id uuid primary key default gen_random_uuid(),
  artifact_name text not null,
  context text not null check (context in ('personal', 'work', 'shared')),
  content text not null,
  content_type text not null default 'text/markdown',
  source_query jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(artifact_name, context)
);

create table if not exists classifier_outcomes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references memory_candidates(id) on delete cascade,
  model text not null,
  candidate_type text not null,
  worthiness_score real not null,
  confidence real not null,
  risk_level text not null,
  routed_action text not null,
  user_accepted boolean,
  user_correction jsonb,
  created_at timestamptz not null default now()
);

create or replace function sofia_content_fingerprint(p_content text)
returns text as $$
  select encode(digest(lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))), 'sha256'), 'hex');
$$ language sql immutable;

create or replace function match_memories(
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 10,
  filter_context text default null,
  include_archived boolean default false
)
returns table (
  id uuid,
  context text,
  memory_type text,
  title text,
  body text,
  similarity float,
  created_at timestamptz
)
language plpgsql
as $$
begin
  return query
  select
    m.id,
    m.context,
    m.memory_type,
    m.title,
    m.body,
    1 - (m.embedding <=> query_embedding) as similarity,
    m.created_at
  from memories m
  where m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) > match_threshold
    and (filter_context is null or m.context = filter_context)
    and (include_archived or m.status = 'active')
  order by m.embedding <=> query_embedding
  limit match_count;
end;
$$;

create trigger trg_events_updated_at
  before update on events
  for each row execute function sofia_set_updated_at();

create trigger trg_memory_candidates_updated_at
  before update on memory_candidates
  for each row execute function sofia_set_updated_at();

create trigger trg_memories_updated_at
  before update on memories
  for each row execute function sofia_set_updated_at();

create trigger trg_entities_updated_at
  before update on entities
  for each row execute function sofia_set_updated_at();

create trigger trg_compiled_artifacts_updated_at
  before update on compiled_artifacts
  for each row execute function sofia_set_updated_at();

alter table events enable row level security;
alter table memory_candidates enable row level security;
alter table memories enable row level security;
alter table memory_versions enable row level security;
alter table entities enable row level security;
alter table event_entities enable row level security;
alter table memory_entities enable row level security;
alter table memory_edges enable row level security;
alter table compiled_artifacts enable row level security;
alter table classifier_outcomes enable row level security;

create policy "service role manages events" on events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages memory_candidates" on memory_candidates for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages memories" on memories for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages memory_versions" on memory_versions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages entities" on entities for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages event_entities" on event_entities for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages memory_entities" on memory_entities for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages memory_edges" on memory_edges for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages compiled_artifacts" on compiled_artifacts for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages classifier_outcomes" on classifier_outcomes for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

grant select, insert, update, delete on table events to service_role;
grant select, insert, update, delete on table memory_candidates to service_role;
grant select, insert, update, delete on table memories to service_role;
grant select, insert, update, delete on table memory_versions to service_role;
grant select, insert, update, delete on table entities to service_role;
grant select, insert, update, delete on table event_entities to service_role;
grant select, insert, update, delete on table memory_entities to service_role;
grant select, insert, update, delete on table memory_edges to service_role;
grant select, insert, update, delete on table compiled_artifacts to service_role;
grant select, insert, update, delete on table classifier_outcomes to service_role;
