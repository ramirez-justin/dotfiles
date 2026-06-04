-- Operational report views for the SOFIA daily review loop.

create or replace view memory_ops_health_summary as
select
  context,
  count(*) filter (where status = 'active') as active_memories,
  count(*) filter (where status = 'stale') as stale_memories,
  count(*) filter (where status = 'needs_review') as needs_review_memories,
  count(*) filter (where status = 'superseded') as superseded_memories,
  count(*) filter (where boot_context_eligible and status = 'active') as boot_eligible_active_memories,
  count(*) filter (
    where status in ('stale', 'needs_review') and retrieval_priority >= 70
  ) as stale_high_priority_memories,
  count(*) filter (
    where status = 'active'
      and retrieval_priority >= 60
      and not exists (
        select 1 from memory_provenance p where p.memory_id = memories.id
      )
  ) as active_high_priority_without_provenance
from memories
group by context;

create or replace view memory_ops_retrieval_usefulness_summary as
select
  retrieval_context as context,
  count(*) as total_retrievals,
  count(*) filter (where was_used is true) as used_retrievals,
  count(*) filter (where was_helpful is true) as helpful_retrievals,
  count(*) filter (where caused_confusion is true) as confusing_retrievals,
  max(created_at) as latest_retrieval_at
from memory_retrievals
where retrieval_context is not null
group by retrieval_context;

create or replace view memory_ops_pending_review_summary as
select
  context,
  count(*) filter (where status = 'pending_review') as pending_candidates,
  count(*) filter (where status = 'pending_review' and risk_level = 'high') as high_priority_candidates,
  count(*) filter (where status = 'pending_review' and risk_level = 'low' and worthiness_score < 0.5) as low_priority_candidates,
  count(*) filter (
    where status = 'pending_review'
      and not (risk_level = 'high')
      and not (risk_level = 'low' and worthiness_score < 0.5)
  ) as normal_priority_candidates,
  max(created_at) filter (where status = 'pending_review') as newest_pending_candidate_at
from memory_candidates
group by context;

grant select on table memory_ops_health_summary to service_role;
grant select on table memory_ops_retrieval_usefulness_summary to service_role;
grant select on table memory_ops_pending_review_summary to service_role;
