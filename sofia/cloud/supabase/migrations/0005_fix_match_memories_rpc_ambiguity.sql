-- Remove the pre-agent-native match_memories overload so PostgREST RPC can
-- resolve calls unambiguously after 0004 adds activation_trigger_filter.

drop function if exists match_memories(vector(1536), float, int, text, boolean);

-- Recreate the agent-native signature in case this migration is replayed after
-- a partial/manual repair. Keeping this definition here makes 0005 idempotent
-- and documents the single supported RPC shape.
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
