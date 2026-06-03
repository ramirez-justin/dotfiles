-- Entity graph model: aliases, typed edges, and todo attachments.

alter table entities drop constraint if exists entities_entity_type_check;

alter table entities add constraint entities_entity_type_check
  check (entity_type in (
    'person',
    'organization',
    'project',
    'repo',
    'system',
    'tool',
    'decision',
    'place',
    'topic',
    'artifact'
  ));

alter table entities
  add column if not exists description text,
  add column if not exists external_refs jsonb not null default '{}'::jsonb,
  add column if not exists merged_into_entity_id uuid references entities(id) on delete set null,
  add column if not exists status text not null default 'active';

alter table entities drop constraint if exists entities_status_check;

alter table entities add constraint entities_status_check
  check (status in ('active', 'merged', 'archived'));

create index if not exists idx_entities_type_status
  on entities(entity_type, status, normalized_name);

create index if not exists idx_entities_external_refs
  on entities using gin(external_refs);

create table if not exists entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text not null default 'agent',
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(entity_id, normalized_alias)
);

create index if not exists idx_entity_aliases_normalized
  on entity_aliases(normalized_alias);

create table if not exists entity_edges (
  id uuid primary key default gen_random_uuid(),
  from_entity_id uuid not null references entities(id) on delete cascade,
  to_entity_id uuid not null references entities(id) on delete cascade,
  relation text not null check (relation in (
    'related_to',
    'belongs_to_project',
    'belongs_to_organization',
    'repo_for_project',
    'system_for_project',
    'tool_used_by',
    'decision_about',
    'depends_on',
    'supersedes',
    'duplicates'
  )),
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  rationale text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(from_entity_id, to_entity_id, relation),
  check (from_entity_id <> to_entity_id)
);

create index if not exists idx_entity_edges_from_relation
  on entity_edges(from_entity_id, relation);

create index if not exists idx_entity_edges_to_relation
  on entity_edges(to_entity_id, relation);

create table if not exists todo_entities (
  todo_id uuid not null references todos(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  evidence text,
  created_at timestamptz not null default now(),
  primary key (todo_id, entity_id)
);

create index if not exists idx_event_entities_entity
  on event_entities(entity_id);

create index if not exists idx_memory_entities_entity
  on memory_entities(entity_id);

create index if not exists idx_todo_entities_entity
  on todo_entities(entity_id);

alter table entity_aliases enable row level security;
alter table entity_edges enable row level security;
alter table todo_entities enable row level security;

drop policy if exists "service role manages entity_aliases" on entity_aliases;
create policy "service role manages entity_aliases" on entity_aliases
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service role manages entity_edges" on entity_edges;
create policy "service role manages entity_edges" on entity_edges
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service role manages todo_entities" on todo_entities;
create policy "service role manages todo_entities" on todo_entities
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select, insert, update, delete on table entity_aliases to service_role;
grant select, insert, update, delete on table entity_edges to service_role;
grant select, insert, update, delete on table todo_entities to service_role;

insert into entity_aliases (entity_id, alias, normalized_alias, source, confidence, metadata)
select id, name, normalized_name, 'migration_backfill', 1.0, jsonb_build_object('migration', '0007_entity_graph_model')
from entities
where normalized_name is not null
on conflict (entity_id, normalized_alias) do nothing;

drop function if exists match_memories(vector(1536), float, int, text, boolean, text);
drop function if exists match_memories(vector(1536), float, int, text, boolean, text, uuid, text);

create or replace function match_memories(
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 10,
  filter_context text default null,
  include_archived boolean default false,
  activation_trigger_filter text default null,
  filter_entity_id uuid default null,
  filter_entity_name text default null
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
declare
  resolved_entity_id uuid;
  normalized_filter_entity_name text;
begin
  if filter_entity_id is not null then
    resolved_entity_id := filter_entity_id;
  elsif filter_entity_name is not null and btrim(filter_entity_name) <> '' then
    normalized_filter_entity_name := lower(btrim(regexp_replace(regexp_replace(filter_entity_name, '[-_/]+', ' ', 'g'), '[^a-zA-Z0-9\s]', '', 'g')));
    normalized_filter_entity_name := regexp_replace(normalized_filter_entity_name, '\s+', ' ', 'g');

    select e.id into resolved_entity_id
    from entities e
    where e.status = 'active'
      and e.normalized_name = normalized_filter_entity_name
    order by e.created_at desc
    limit 1;

    if resolved_entity_id is null then
      select e.id into resolved_entity_id
      from entity_aliases ea
      join entities e on e.id = ea.entity_id
      where e.status = 'active'
        and ea.normalized_alias = normalized_filter_entity_name
      order by ea.created_at desc
      limit 1;
    end if;
  end if;

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
    and (include_archived or m.stale_after is null or m.stale_after > now())
    and (include_archived or m.expires_at is null or m.expires_at > now())
    and (
      activation_trigger_filter is null
      or activation_trigger_filter = any(m.activation_triggers)
    )
    and (
      filter_entity_id is null and (filter_entity_name is null or btrim(filter_entity_name) = '')
      or exists (
        select 1
        from memory_entities me
        where me.memory_id = m.id
          and me.entity_id = resolved_entity_id
      )
    )
  order by
    m.embedding <=> query_embedding,
    m.retrieval_priority desc,
    m.created_at desc
  limit match_count;
end;
$$;
