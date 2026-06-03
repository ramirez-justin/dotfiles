-- Phase 2: memory lifecycle automation.
-- Keep default retrieval and boot-context source queries away from expired/stale knowledge.

create index if not exists idx_memories_lifecycle_due
  on memories(status, retrieval_priority desc, stale_after, expires_at)
  where status = 'active';

create index if not exists idx_memory_candidates_stale_review_source
  on memory_candidates((metadata->>'source_memory_id'))
  where metadata->>'review_type' = 'stale_memory';

create index if not exists idx_memory_edges_supersession
  on memory_edges(from_memory_id, to_memory_id, relation)
  where relation in ('supersedes', 'updates');

drop function if exists match_memories(vector(1536), float, int, text, boolean, text);

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
    and (include_archived or m.stale_after is null or m.stale_after > now())
    and (include_archived or m.expires_at is null or m.expires_at > now())
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
