-- Task/session continuity: explicit agent work state, artifacts, and handoffs.

create table if not exists agent_sessions (
  id uuid primary key default gen_random_uuid(),
  context text not null check (context in ('personal', 'work', 'shared')),
  agent_name text not null default 'agent',
  session_ref text,
  status text not null default 'active' check (status in ('active', 'ended', 'abandoned')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_agent_sessions_context_status_started
  on agent_sessions(context, status, started_at desc);
create index if not exists idx_agent_sessions_session_ref
  on agent_sessions(session_ref) where session_ref is not null;

create table if not exists task_runs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references agent_sessions(id) on delete cascade,
  context text not null check (context in ('personal', 'work', 'shared')),
  entity_id uuid references entities(id) on delete set null,
  title text not null,
  objective text,
  status text not null default 'in_progress' check (status in ('in_progress', 'blocked', 'completed', 'cancelled')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  outcome_summary text,
  verification_summary text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_task_runs_context_status_started
  on task_runs(context, status, started_at desc);
create index if not exists idx_task_runs_entity_status_started
  on task_runs(entity_id, status, started_at desc) where entity_id is not null;
create index if not exists idx_task_runs_session
  on task_runs(session_id, started_at desc);

create table if not exists task_artifacts (
  id uuid primary key default gen_random_uuid(),
  task_run_id uuid not null references task_runs(id) on delete cascade,
  artifact_type text not null check (artifact_type in ('commit', 'pr', 'issue', 'migration', 'deployment', 'test_output', 'log', 'doc', 'file', 'url', 'note')),
  title text not null,
  uri text,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_artifacts_task_created
  on task_artifacts(task_run_id, created_at desc);

create table if not exists session_handoffs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references agent_sessions(id) on delete cascade,
  task_run_id uuid not null references task_runs(id) on delete cascade,
  context text not null check (context in ('personal', 'work', 'shared')),
  entity_id uuid references entities(id) on delete set null,
  title text not null,
  handoff_markdown text not null,
  status text not null default 'active' check (status in ('active', 'superseded', 'archived')),
  verification_status text not null default 'unknown' check (verification_status in ('unknown', 'passed', 'failed', 'blocked', 'not_run')),
  artifact_ids uuid[] not null default '{}'::uuid[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_session_handoffs_context_status_created
  on session_handoffs(context, status, created_at desc);
create index if not exists idx_session_handoffs_entity_status_created
  on session_handoffs(entity_id, status, created_at desc) where entity_id is not null;
create index if not exists idx_session_handoffs_task_created
  on session_handoffs(task_run_id, created_at desc);

alter table boot_context_snapshots
  add column if not exists included_handoff_ids uuid[] not null default '{}'::uuid[];

alter table todos
  add column if not exists task_run_id uuid references task_runs(id) on delete set null;

create index if not exists idx_todos_task_run
  on todos(task_run_id) where task_run_id is not null;

alter table agent_sessions enable row level security;
alter table task_runs enable row level security;
alter table task_artifacts enable row level security;
alter table session_handoffs enable row level security;
