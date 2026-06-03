-- Retrieval policy learning: read-only telemetry views for report/debug tooling.
-- Policy recommendations are intentionally advisory; mutation remains gated by review.

create or replace view memory_retrieval_policy_stats as
select
  m.id as memory_id,
  m.context,
  m.memory_type,
  m.title,
  m.status,
  m.retrieval_priority,
  m.boot_context_eligible,
  count(r.id)::int as retrieval_count,
  count(r.id) filter (where r.was_used is true)::int as used_count,
  count(r.id) filter (where r.was_helpful is true)::int as helpful_count,
  count(r.id) filter (where r.caused_confusion is true)::int as confusing_count,
  coalesce(
    count(r.id) filter (where r.was_helpful is true)::float / nullif(count(r.id), 0),
    0
  ) as helpful_rate,
  coalesce(
    count(r.id) filter (where r.caused_confusion is true)::float / nullif(count(r.id), 0),
    0
  ) as confusing_rate,
  max(r.created_at) as last_retrieved_at
from memories m
left join memory_retrievals r on r.memory_id = m.id
group by
  m.id,
  m.context,
  m.memory_type,
  m.title,
  m.status,
  m.retrieval_priority,
  m.boot_context_eligible;

comment on view memory_retrieval_policy_stats is
  'Read-only SOFIA retrieval telemetry aggregation used to recommend, not apply, boot-context and priority policy changes.';

create or replace view boot_context_memory_usage as
with snapshot_memory as (
  select
    s.id as snapshot_id,
    s.context,
    s.generated_at,
    unnest(s.included_memory_ids) as memory_id
  from boot_context_snapshots s
), snapshot_counts as (
  select
    memory_id,
    context,
    count(*)::int as boot_snapshot_count,
    max(generated_at) as last_boot_included_at
  from snapshot_memory
  group by memory_id, context
)
select
  sc.memory_id,
  sc.context,
  m.title,
  m.memory_type,
  m.retrieval_priority,
  m.boot_context_eligible,
  sc.boot_snapshot_count,
  sc.last_boot_included_at,
  coalesce(count(r.id) filter (where r.was_used is true), 0)::int as used_count,
  coalesce(count(r.id) filter (where r.was_helpful is true), 0)::int as helpful_count,
  coalesce(count(r.id) filter (where r.caused_confusion is true), 0)::int as confusing_count
from snapshot_counts sc
join memories m on m.id = sc.memory_id
left join memory_retrievals r on r.memory_id = sc.memory_id
group by
  sc.memory_id,
  sc.context,
  m.title,
  m.memory_type,
  m.retrieval_priority,
  m.boot_context_eligible,
  sc.boot_snapshot_count,
  sc.last_boot_included_at;

comment on view boot_context_memory_usage is
  'Read-only diagnostic view showing boot-context memories with later retrieval feedback/usefulness signals.';

grant select on table memory_retrieval_policy_stats to service_role;
grant select on table boot_context_memory_usage to service_role;
