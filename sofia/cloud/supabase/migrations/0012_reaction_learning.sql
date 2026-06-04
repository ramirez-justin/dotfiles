-- Reaction learning telemetry for SOFIA Cloud.

create table if not exists reaction_events (
  id uuid primary key default gen_random_uuid(),
  context text not null check (context in ('personal', 'work', 'shared')),
  platform text not null default 'telegram',
  actor_id text,
  actor_handle text,
  chat_id text,
  message_id text not null,
  emoji text not null,
  sentiment text not null check (sentiment in ('positive', 'negative', 'neutral')),
  category text not null,
  learning_signal text not null check (learning_signal in (
    'positive_preference',
    'negative_preference',
    'confirmation',
    'attention_requested',
    'neutral_telemetry'
  )),
  confidence real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  message_preview text,
  source text not null default 'reaction_event',
  source_ref text,
  session_id uuid references agent_sessions(id) on delete set null,
  task_run_id uuid references task_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_reaction_events_context_created
  on reaction_events (context, created_at desc);

create index if not exists idx_reaction_events_signal_context
  on reaction_events (learning_signal, context, created_at desc);

create index if not exists idx_reaction_events_message
  on reaction_events (platform, chat_id, message_id);

create or replace view reaction_learning_patterns as
select
  context,
  coalesce(metadata->>'skill', metadata->>'response_type', category) as context_key,
  emoji,
  sentiment,
  category,
  learning_signal,
  count(*)::int as count,
  count(distinct created_at::date)::int as distinct_days,
  max(created_at) as latest_at,
  (count(*) >= 3 and count(distinct created_at::date) >= 2 and learning_signal <> 'neutral_telemetry') as candidate_worthy
from reaction_events
where created_at >= now() - interval '30 days'
group by context, context_key, emoji, sentiment, category, learning_signal;

create or replace view reaction_recent_negative_signals as
select
  id,
  context,
  platform,
  chat_id,
  message_id,
  emoji,
  category,
  learning_signal,
  message_preview,
  created_at
from reaction_events
where sentiment = 'negative'
  and created_at >= now() - interval '7 days'
order by created_at desc;
