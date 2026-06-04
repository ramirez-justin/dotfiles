-- Contradiction detection and memory QA.

create table if not exists memory_contradiction_reviews (
  id uuid primary key default gen_random_uuid(),
  context text not null check (context in ('personal', 'work', 'shared')),
  source text not null default 'manual' check (source in ('candidate_reconciliation', 'memory_qa', 'manual', 'automation')),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected', 'resolved', 'archived')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  candidate_id uuid references memory_candidates(id) on delete set null,
  reconciliation_id uuid references memory_reconciliations(id) on delete set null,
  primary_memory_id uuid not null references memories(id) on delete cascade,
  conflicting_memory_id uuid not null references memories(id) on delete cascade,
  relation text not null default 'contradicts' check (relation in ('contradicts', 'updates', 'duplicates', 'related_to')),
  proposed_resolution text not null default 'review_required',
  rationale text not null,
  confidence numeric not null default 0 check (confidence >= 0 and confidence <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(primary_memory_id, conflicting_memory_id, relation, status)
);

create index if not exists idx_memory_contradiction_reviews_pending
  on memory_contradiction_reviews(context, severity desc, created_at desc)
  where status = 'pending_review';

create index if not exists idx_memory_contradiction_reviews_primary
  on memory_contradiction_reviews(primary_memory_id)
  where status = 'pending_review';

create index if not exists idx_memory_contradiction_reviews_conflicting
  on memory_contradiction_reviews(conflicting_memory_id)
  where status = 'pending_review';

create index if not exists idx_memory_edges_contradicts_active
  on memory_edges(from_memory_id, to_memory_id)
  where relation = 'contradicts';

create or replace view unresolved_memory_contradictions as
select
  r.id as review_id,
  r.context,
  r.severity,
  r.primary_memory_id,
  r.conflicting_memory_id,
  r.relation,
  r.confidence,
  r.proposed_resolution,
  r.rationale,
  pm.title as primary_title,
  cm.title as conflicting_title,
  r.created_at
from memory_contradiction_reviews r
join memories pm on pm.id = r.primary_memory_id
join memories cm on cm.id = r.conflicting_memory_id
where r.status = 'pending_review'
  and pm.status = 'active'
  and cm.status = 'active';

create or replace view weak_provenance_memories as
select
  m.id as memory_id,
  m.context,
  m.title,
  m.memory_type,
  m.retrieval_priority,
  m.confidence,
  m.created_at,
  count(p.id) as provenance_count
from memories m
left join memory_provenance p on p.memory_id = m.id
where m.status = 'active'
  and (m.retrieval_priority >= 60 or m.boot_context_eligible = true)
group by m.id
having count(p.id) = 0;

alter table memory_contradiction_reviews enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'memory_contradiction_reviews'
      and policyname = 'service role manages memory contradiction reviews'
  ) then
    create policy "service role manages memory contradiction reviews"
      on memory_contradiction_reviews
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;
