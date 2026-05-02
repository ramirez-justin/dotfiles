create table if not exists memory_reconciliations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references memory_candidates(id) on delete cascade,
  context text not null check (context in ('personal', 'work', 'shared')),
  action text not null check (action in (
    'promote_new',
    'archive_duplicate',
    'update_existing',
    'review_update',
    'review_merge',
    'review_conflict'
  )),
  status text not null check (status in (
    'auto_applied',
    'pending_review',
    'approved',
    'rejected',
    'archived'
  )),
  target_memory_id uuid references memories(id) on delete set null,
  related_memory_ids uuid[] not null default '{}'::uuid[],
  proposed_title text,
  proposed_body text,
  confidence real not null check (confidence >= 0 and confidence <= 1),
  rationale text,
  policy_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(candidate_id)
);

create index if not exists idx_memory_reconciliations_candidate
  on memory_reconciliations(candidate_id);

create index if not exists idx_memory_reconciliations_status_context
  on memory_reconciliations(status, context, created_at desc);

create index if not exists idx_memory_reconciliations_target
  on memory_reconciliations(target_memory_id);

create trigger trg_memory_reconciliations_updated_at
  before update on memory_reconciliations
  for each row execute function sofia_set_updated_at();

alter table memory_reconciliations enable row level security;

create policy "service role manages memory_reconciliations" on memory_reconciliations
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
