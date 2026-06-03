-- Agent-native SOFIA memory graph/lifecycle foundation.

alter table memories drop constraint if exists memories_status_check;

alter table memories add constraint memories_status_check
  check (status in (
    'active',
    'superseded',
    'archived',
    'rejected',
    'stale',
    'needs_review'
  ));

alter table memories
  add column if not exists superseded_by_memory_id uuid references memories(id) on delete set null,
  add column if not exists stale_after timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists review_reason text,
  add column if not exists retrieval_priority int not null default 50,
  add column if not exists boot_context_eligible boolean not null default true,
  add column if not exists activation_triggers text[] not null default '{}',
  add column if not exists expires_at timestamptz;

create index if not exists idx_memories_boot_policy
  on memories(context, status, boot_context_eligible, retrieval_priority desc);

create index if not exists idx_memories_activation_triggers
  on memories using gin(activation_triggers);

create index if not exists idx_memories_expires_at
  on memories(expires_at);

create table if not exists memory_provenance (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid references memories(id) on delete cascade,
  candidate_id uuid references memory_candidates(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  source_type text not null check (source_type in (
    'session',
    'user_statement',
    'agent_capture',
    'automation',
    'repo',
    'issue',
    'pr',
    'doc',
    'email',
    'calendar',
    'external_api',
    'manual_review'
  )),
  source_uri text,
  source_ref text,
  captured_by text not null default 'agent',
  captured_by_agent text,
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  evidence_quote text,
  evidence_summary text,
  evidence_hash text,
  observed_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_memory_provenance_memory
  on memory_provenance(memory_id);

create index if not exists idx_memory_provenance_source
  on memory_provenance(source_type, source_ref);

create index if not exists idx_memory_provenance_last_verified
  on memory_provenance(last_verified_at desc);

alter table memory_edges drop constraint if exists memory_edges_relation_check;

alter table memory_edges add constraint memory_edges_relation_check
  check (relation in (
    'supports',
    'contradicts',
    'updates',
    'supersedes',
    'depends_on',
    'related_to',
    'belongs_to_project',
    'belongs_to_entity',
    'derived_from',
    'duplicates',
    'invalidates',
    'evolved_into'
  ));

create table if not exists boot_context_snapshots (
  id uuid primary key default gen_random_uuid(),
  context text not null check (context in ('personal', 'work', 'shared')),
  generated_at timestamptz not null default now(),
  included_memory_ids uuid[] not null default '{}'::uuid[],
  included_entity_ids uuid[] not null default '{}'::uuid[],
  included_todo_ids uuid[] not null default '{}'::uuid[],
  markdown text not null,
  token_count int,
  compiler_version text not null default 'unknown',
  source_query jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_boot_context_snapshots_context_generated
  on boot_context_snapshots(context, generated_at desc);

create table if not exists todos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'done', 'cancelled', 'deferred')),
  owner text,
  context text not null check (context in ('personal', 'work', 'shared')),
  project_entity_id uuid references entities(id) on delete set null,
  source_event_id uuid references events(id) on delete set null,
  source_candidate_id uuid references memory_candidates(id) on delete set null,
  source_memory_id uuid references memories(id) on delete set null,
  due_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  priority int not null default 50,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_todos_context_status_priority
  on todos(context, status, priority desc, created_at desc);

create index if not exists idx_todos_project_status
  on todos(project_entity_id, status, priority desc);

create table if not exists todo_dependencies (
  todo_id uuid not null references todos(id) on delete cascade,
  depends_on_todo_id uuid not null references todos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (todo_id, depends_on_todo_id),
  check (todo_id <> depends_on_todo_id)
);

create table if not exists memory_retrievals (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid references memories(id) on delete cascade,
  session_id text,
  agent_name text,
  tool_name text,
  query text,
  query_embedding vector(1536),
  retrieval_context text check (retrieval_context in ('personal', 'work', 'shared')),
  activation_trigger text,
  rank int,
  similarity real,
  returned_in_boot_context boolean not null default false,
  was_used boolean,
  was_helpful boolean,
  caused_confusion boolean,
  feedback text,
  created_at timestamptz not null default now()
);

create index if not exists idx_memory_retrievals_memory_created
  on memory_retrievals(memory_id, created_at desc);

create index if not exists idx_memory_retrievals_session
  on memory_retrievals(session_id);

create index if not exists idx_memory_retrievals_feedback
  on memory_retrievals(was_used, was_helpful, caused_confusion);

alter table memory_reconciliations
  add column if not exists severity text not null default 'normal'
    check (severity in ('low', 'normal', 'high')),
  add column if not exists reviewer_prompt text,
  add column if not exists resolution_notes text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by text;

alter table memory_provenance enable row level security;
alter table boot_context_snapshots enable row level security;
alter table todos enable row level security;
alter table todo_dependencies enable row level security;
alter table memory_retrievals enable row level security;

create policy "service role manages memory_provenance" on memory_provenance
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role manages boot_context_snapshots" on boot_context_snapshots
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role manages todos" on todos
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role manages todo_dependencies" on todo_dependencies
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role manages memory_retrievals" on memory_retrievals
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create trigger trg_todos_updated_at
  before update on todos
  for each row execute function sofia_set_updated_at();

grant select, insert, update, delete on table memory_provenance to service_role;
grant select, insert, update, delete on table boot_context_snapshots to service_role;
grant select, insert, update, delete on table todos to service_role;
grant select, insert, update, delete on table todo_dependencies to service_role;
grant select, insert, update, delete on table memory_retrievals to service_role;

update memories
set retrieval_priority = case memory_type
    when 'operating_rule' then 90
    when 'preference' then 75
    when 'decision' then 70
    when 'project_context' then 65
    when 'lesson' then 60
    when 'gotcha' then 60
    else 50
  end
where retrieval_priority = 50;

insert into memory_provenance (
  memory_id,
  candidate_id,
  event_id,
  source_type,
  source_ref,
  captured_by,
  confidence,
  evidence_summary
)
select
  m.id,
  m.created_from_candidate_id,
  c.event_id,
  case
    when c.metadata->>'source_type' in (
      'session', 'user_statement', 'agent_capture', 'automation', 'repo',
      'issue', 'pr', 'doc', 'email', 'calendar', 'external_api',
      'manual_review'
    ) then c.metadata->>'source_type'
    else 'agent_capture'
  end,
  e.source_ref,
  coalesce(nullif(c.metadata->>'captured_by', ''), 'agent'),
  m.confidence,
  c.reasoning
from memories m
left join memory_candidates c on c.id = m.created_from_candidate_id
left join events e on e.id = c.event_id
where not exists (
  select 1 from memory_provenance p where p.memory_id = m.id
);

drop function if exists match_memories(vector(1536), float, int, text, boolean);

create or replace function match_memories(
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 10,
  filter_context text default null,
  include_archived boolean default false,
  activation_trigger_filter text default null
)
returns table (
  id uuid,
  context text,
  memory_type text,
  title text,
  body text,
  similarity float,
  retrieval_priority int,
  confidence real,
  status text,
  last_verified_at timestamptz,
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
    m.retrieval_priority,
    m.confidence,
    m.status,
    m.last_verified_at,
    m.created_at
  from memories m
  where m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) > match_threshold
    and (filter_context is null or m.context = filter_context)
    and (include_archived or m.status = 'active')
    and (m.expires_at is null or m.expires_at > now())
    and (
      activation_trigger_filter is null
      or activation_trigger_filter = any(m.activation_triggers)
    )
  order by
    m.embedding <=> query_embedding,
    m.retrieval_priority desc,
    m.created_at desc
  limit match_count;
end;
$$;
