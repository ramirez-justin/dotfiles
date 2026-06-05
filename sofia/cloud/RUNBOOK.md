# SOFIA Cloud Runbook

SOFIA Cloud/Postgres is the canonical runtime memory source. If Pi cannot load
SOFIA boot context, do not fall back to local Obsidian files. Run the health
check and fix the failing layer.

```bash
mise run sofia-cloud:health
```

## What the health check covers

`sofia-cloud:health` checks, in order:

1. Supabase project ref resolution from `SUPABASE_SOFIA_PROJECT_REF` or
   1Password.
2. Supabase project status from `supabase projects list --output json`.
3. DNS resolution for `<project-ref>.supabase.co`.
4. Edge Function reachability without a key; expected result is HTTP `401` or
   `403`.
5. `SOFIA_MCP_ACCESS_KEY` presence.
6. Authenticated personal boot context at `/boot-context?context=personal`.

## Common failures

### 1Password authorization timeout

Symptoms:

- Health check fails at `project ref`.
- `op read ...` reports an authorization timeout.

Recovery:

1. Unlock or reauthenticate 1Password CLI.
2. Retry:

   ```bash
   mise run sofia-cloud:health
   ```

Alternative:

```bash
export SUPABASE_SOFIA_PROJECT_REF=<project-ref>
```

### Supabase project `INACTIVE`

Symptoms:

- Health check reports project status `INACTIVE`.
- DNS may return `NXDOMAIN` for `<project-ref>.supabase.co`.
- Pi boot context fails before reaching SOFIA MCP.

Recovery:

1. Restore/reactivate the SOFIA project in the Supabase dashboard.
2. Wait while status moves through `COMING_UP` or `RESTORING`.
3. Retry health until project status is `ACTIVE_HEALTHY`.

### DNS `NXDOMAIN`

Symptoms:

- Health check fails DNS for `<project-ref>.supabase.co`.
- `nslookup <project-ref>.supabase.co` reports `NXDOMAIN`.

Likely causes:

- Supabase project is inactive.
- Supabase project is still restoring.
- Project ref is wrong.

Recovery:

1. Verify the project ref:

   ```bash
   supabase projects list --output json
   ```

2. Restore/wait if project status is inactive or restoring.
3. Retry health.

### Cloudflare `521`

Symptoms:

- Edge Function or boot context check returns HTTP `521`.
- Supabase project may already have DNS records again.

Likely cause:

- Supabase/Cloudflare is reachable, but the project backend is still coming up.

Recovery:

1. Check project status.
2. Wait a few minutes if status is `COMING_UP` or `RESTORING`.
3. Retry health.

### Edge Function returns unexpected non-auth status without key

Expected unauthenticated result is HTTP `401` or `403`.

If the check returns another status:

1. Verify the function is deployed:

   ```bash
   mise run sofia-cloud:functions-list
   ```

2. Redeploy if needed:

   ```bash
   mise run sofia-cloud:deploy
   ```

### Missing or invalid `SOFIA_MCP_ACCESS_KEY`

Symptoms:

- Health check fails `SOFIA_MCP_ACCESS_KEY`.
- Authenticated boot context returns HTTP `401` or `403`.

Recovery:

1. Source Pi environment:

   ```bash
   source ~/.pi/agent/env.zsh
   ```

2. If still missing, unlock 1Password CLI and source again.
3. If invalid, update the 1Password item `op://dev_vault/SOFIA MCP/access key`
   or the Supabase Edge Function secret so they match.
4. Retry health.

### Telegram digest does not arrive

Symptoms:

- `sofia-evening-telegram-digest` is scheduled, but no Telegram message arrives.
- Manual `mise run sofia-cloud:send-daily-digest` fails.

Recovery:

1. Confirm the Edge Function has Telegram secrets:

   ```bash
   mise run sofia-cloud:set-telegram-secrets
   mise run sofia-cloud:deploy
   ```

2. Confirm the bot token and chat id by sending `/start` to the bot and
   checking:

   ```bash
   TELEGRAM_BOT_TOKEN="$(op read 'op://dev_vault/SOFIA Telegram/password')"
   curl -fsS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates"
   ```

3. Trigger a manual send:

   ```bash
   mise run sofia-cloud:send-daily-digest
   ```

4. If the manual send works but the scheduled send does not, inspect the
   Supabase cron job and Vault secrets:

   ```sql
   select * from cron.job where jobname = 'sofia-evening-telegram-digest';
   select name from vault.decrypted_secrets where name in ('sofia_project_url', 'sofia_mcp_access_key');
   ```

5. If Vault secrets are missing, create them:

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'sofia_project_url');
   select vault.create_secret('<MCP_ACCESS_KEY>', 'sofia_mcp_access_key');
   ```

## Agent-native memory debugging

When an agent appears to know a fact, inspect the compiled boot context and its
snapshot before assuming vector search returned it:

1. Call `get_boot_context` or fetch `/boot-context?context=<context>` and note
   the `snapshot_id`, `included_memory_ids`, and `included_todo_ids`.
2. Inspect `boot_context_snapshots` for that snapshot to see the exact rendered
   markdown, source query, compiler version, and token count.
3. For a specific memory, inspect `memory_provenance` to verify source type,
   source ref/URI, capture actor, evidence snippet/summary, confidence, and
   last verification timestamp.
4. If a retrieved memory was stale or confusing, record feedback through the
   `record_memory_feedback` MCP tool so retrieval policy can be tuned later.
5. Todos/open loops should be checked in `todos`, not in `memories`.

Useful SQL shapes:

```sql
select id, generated_at, included_memory_ids, included_todo_ids, token_count
from boot_context_snapshots
where context = 'personal'
order by generated_at desc
limit 5;

select source_type, source_ref, captured_by, confidence, evidence_summary,
       last_verified_at
from memory_provenance
where memory_id = '<memory-id>'
order by created_at desc;

select id, title, status, priority, due_at
from todos
where context = 'personal' and status in ('open', 'in_progress', 'blocked')
order by priority desc, created_at desc;
```

## After recovery

Verify boot context from Pi/MCP:

```bash
mise run sofia-cloud:health
```

Then start or reload Pi. If MCP metadata is stale, reconnect or reload the
`sofia-cloud` server.

## Phase 2 lifecycle maintenance

Run lifecycle maintenance after deployments or when stale/expired memory behavior looks wrong:

```bash
# via MCP tool: run_lifecycle_maintenance
# or live smoke through Hermes once MCP tools are reloaded:
hermes --profile sofia-spike mcp test sofia-cloud
```

The Phase 2 lifecycle path:

1. Active memories with `stale_after < now()` or `expires_at < now()` are marked `stale` and removed from boot-context eligibility.
2. Default vector search excludes inactive, expired, and stale memories unless `include_archived=true` is explicitly used for audit/debugging.
3. Boot-context compilation defensively filters expired/stale rows even if maintenance has not run yet.
4. High-priority stale memories queue `pending_review` open-loop candidates with `metadata.review_type = 'stale_memory'` so Justin/agents can verify, update, supersede, or archive them.
5. Safe high-confidence reconciliation updates now create a new active memory and mark the old memory `superseded`, linked by a `memory_edges.relation = 'supersedes'` edge.

Useful SQL:

```sql
select id, title, status, retrieval_priority, stale_after, expires_at, review_reason
from memories
where status in ('stale', 'superseded')
order by updated_at desc
limit 20;

select id, candidate_text, metadata->>'source_memory_id' as source_memory_id
from memory_candidates
where status = 'pending_review'
  and metadata->>'review_type' = 'stale_memory'
order by created_at desc;

select from_memory_id, to_memory_id, relation, metadata
from memory_edges
where relation = 'supersedes'
order by created_at desc
limit 20;
```

## Phase 3 entity graph model

Phase 3 makes projects, repos, systems, people, tools, organizations, decisions,
and related concepts first-class retrieval anchors.

Runtime behavior:

1. Candidate `entities` metadata is normalized through `entities.ts`.
2. Canonical entities get stable aliases in `entity_aliases`.
3. Promoted memories attach through `memory_entities`.
4. Todos/open loops attach through `todo_entities`.
5. Vector search accepts entity scope via `entity_id` or `entity` and filters through the graph.
6. Boot context supports scoped slices with `entity_id` or `entity`, writing a snapshot without overwriting the global compiled artifact.

Useful examples:

```bash
# entity-scoped HTTP boot-context slice
curl -fsS "$SOFIA_CLOUD_URL/boot-context?context=work&force_refresh=true&entity=TelophaseQS" \
  -H "x-sofia-key: $SOFIA_MCP_ACCESS_KEY"
```

```sql
select e.id, e.entity_type, e.name, array_agg(ea.alias order by ea.alias) as aliases
from entities e
left join entity_aliases ea on ea.entity_id = e.id
where e.status = 'active'
group by e.id
order by e.created_at desc
limit 20;

select e.name, me.relationship, m.title
from memory_entities me
join entities e on e.id = me.entity_id
join memories m on m.id = me.memory_id
where e.normalized_name = 'telophaseqs'
order by me.created_at desc;

select e.name, te.relationship, t.title, t.status
from todo_entities te
join entities e on e.id = te.entity_id
join todos t on t.id = te.todo_id
where e.normalized_name = 'telophaseqs'
order by te.created_at desc;
```

## Phase 4 retrieval policy learning

Phase 4 adds read-only retrieval telemetry reports and gated recommendations for
boot-context eligibility and retrieval priority. It does not apply policy changes
automatically.

MCP report tool after `sofia-core` deploy/reload:

```json
{
  "tool": "get_retrieval_policy_report",
  "arguments": {
    "context": "both",
    "limit": 10,
    "minimum_retrievals": 1
  }
}
```

Report sections:

1. `top_helpful` — memories with high `was_helpful` feedback rate.
2. `top_confusing` — memories with `caused_confusion` feedback.
3. `boot_unused` — boot-context memories included in snapshots with no recorded use.
4. `recommendations` — gated suggestions only:
   - `enable_boot_context`
   - `raise_priority`
   - `lower_priority`
   - `disable_boot_context`
   - `needs_review`

Useful SQL:

```sql
select memory_id, title, retrieval_count, helpful_count, confusing_count,
       helpful_rate, confusing_rate, retrieval_priority, boot_context_eligible
from memory_retrieval_policy_stats
where status = 'active'
order by confusing_rate desc, confusing_count desc
limit 20;

select memory_id, title, boot_snapshot_count, used_count, helpful_count,
       confusing_count, retrieval_priority, boot_context_eligible
from boot_context_memory_usage
where used_count = 0
order by boot_snapshot_count desc, retrieval_priority desc
limit 20;
```

If a recommendation looks right, make the actual change through an explicit
review/update path. Do not script automatic destructive policy changes from this
report.

## Phase 4.5 promotion policy tuning

Promotion routing is intentionally conservative but should not make Justin approve
boring, verified project milestones forever.

Auto-promote candidates when all are true:

1. `candidate_type` is `project_context`, `lesson`, or durable `fact`.
2. `metadata.context` is `work`.
3. `risk_level` is `low`.
4. `confidence >= 0.85` and `worthiness_score >= 0.7`.
5. Candidate text/title includes a durable outcome such as deployed, verified,
   fixed, completed, merged, pushed, applied, created, documented, proved,
   implemented, migrated, ran, or passed.
6. Metadata/entities provide provenance such as project, repo, commit, branch,
   issue, PR, or entity links.

Still require review for person/property/financial/security/secret-adjacent content,
redacted content, medium/high risk, and vague milestones without enough details.

Auto-archive transient progress when the candidate says work started/is being
investigated/is planned but has no durable outcome. These are session/task state,
not durable memory.

Reconciler parser repair: optional malformed UUID fields such as
`target_memory_id: "undefined"` are dropped, and invalid `related_memory_ids` are
filtered before schema validation. This prevents unnecessary fallback-review noise
while preserving safe review behavior for truly ambiguous reconciliations.

When clearing the existing queue using this policy, approve low-risk durable
project milestones and archive vague/transient/duplicate entries. Do not approve
secret-adjacent DSN/API-key/security candidates unless Justin explicitly approves
that specific item.

## Phase 5 task/session continuity

Phase 5 stores resumable agent work separately from durable memories. Use it for
active implementation state, verification evidence, and handoffs that a later
session should continue from.

Schema:

- `agent_sessions` — agent/session identity, context, and status.
- `task_runs` — objective, status, entity/project scope, outcome, verification.
- `task_artifacts` — commits, PRs, migrations, deployments, logs, docs, test output.
- `session_handoffs` — generated active handoff markdown with verification status.

MCP tools exposed by `sofia-core`:

- `start_task_run`
- `attach_task_artifact`
- `complete_task_run`
- `get_latest_handoffs`
- `list_active_task_runs`

Operational pattern:

1. Start a task run when beginning durable, resumable work.
2. Attach artifacts as work becomes externally verifiable: commit SHA, PR URL,
   migration name, deploy result, test output, or docs path.
3. Complete/block/cancel the task run with outcome and verification summaries.
4. Fetch latest handoffs by context/entity when resuming a project.

Boot context compilation includes active `session_handoffs` alongside memories and
todos. Scoped boot contexts include only matching entity/project handoffs; global
boot context includes recent active handoffs for the requested context.

Do not use task/session continuity as a dumping ground for transient chat logs.
Archive/complete stale handoffs once the work is no longer relevant.

## Phase 6 contradiction detection and memory QA

Phase 6 makes memory consistency explicit. Unresolved conflicts are review work,
not silent active-memory clutter.

Schema/runtime surfaces:

- `memory_contradiction_reviews` stores pending/resolved conflict review items.
- `unresolved_memory_contradictions` reports active conflicting memory pairs.
- `weak_provenance_memories` reports high-priority/boot-worthy active memories
  with no provenance rows.
- Boot-context compilation filters unresolved high-confidence contradictions so
  both sides are not shown at the same time; omitted IDs are recorded in snapshot
  metadata as `omitted_contradicted_memory_ids`.

MCP tools exposed by `sofia-core`:

- `create_contradiction_review` — queue an explicit contradiction/update/duplicate
  review between two memory IDs.
- `get_memory_qa_report` — report unresolved contradictions, weak provenance,
  and stale high-priority memories.

Operational pattern:

1. Run `get_memory_qa_report` before trusting suspicious boot context or during
   weekly SOFIA hygiene.
2. For likely conflicts, create or inspect a `memory_contradiction_reviews` row.
3. Resolve through existing reconciliation/review paths: supersede, update, merge,
   archive duplicate, or reject incorrect candidate.
4. Do not auto-resolve personal/property/financial/security conflicts; keep those
   review-only.

## Phase 7 operational dashboards and daily review loop

Phase 7 turns SOFIA maintenance into a deterministic operator routine rather than
ad hoc memory spelunking.

Schema/runtime surfaces:

- `memory_ops_health_summary` reports active/stale/needs-review/superseded memory
  counts, boot-eligible active memory counts, stale high-priority memories, and
  active high-priority memories without provenance.
- `memory_ops_retrieval_usefulness_summary` reports used/helpful/confusing
  retrieval counts by context.
- `memory_ops_pending_review_summary` reports pending candidates by derived
  review bucket using risk level and worthiness score.
- `fetchDailyDigestSnapshot` gathers pending reviews, contradiction severity,
  recent captures/redactions, stale high-priority memories, confusing retrievals,
  due todos, recent boot snapshots, and reaction-learning signals without calling an LLM.
- `formatDailyDigest` renders deterministic text suitable for Telegram or manual
  operator review.

MCP tools exposed by `sofia-core`:

- `get_daily_review_report` — return structured daily-review snapshot plus the
  deterministic digest text.
- Existing `/daily-digest` HTTP path still sends the Telegram digest using the
  same snapshot/formatter.

Operational pattern:

1. Daily: run `get_daily_review_report` or the scheduled Telegram digest. Handle
   high-priority candidates, pending contradictions, stale high-priority memories,
   confusing retrievals, due todos, and recent negative reactions first.
2. Weekly: inspect `memory_ops_health_summary`,
   `memory_ops_retrieval_usefulness_summary`, and `memory_ops_pending_review_summary`
   for pruning, provenance repair, and boot-context tuning.
3. Treat the report as advisory. Destructive fixes still go through review,
   archive, supersession, or lifecycle maintenance paths.

## Phase 8 emoji reaction learning

Phase 8 captures Telegram emoji reactions as feedback telemetry. It does not make
single reactions durable memory.

Schema/runtime surfaces:

- `reaction_events` is append-only reaction telemetry with deterministic emoji
  classification, confidence, redacted message preview, source, session/task
  links, and metadata.
- `reaction_learning_patterns` aggregates repeated 30-day reaction signals and
  marks patterns candidate-worthy only after conservative thresholds.
- `reaction_recent_negative_signals` surfaces recent negative/confusing reactions
  for daily review.
- The daily digest includes recent negative reactions and repeated patterns ready
  for review.

MCP tools exposed by `sofia-core`:

- `record_reaction_event` — append a privacy-bounded reaction event.
- `get_reaction_learning_report` — inspect recent negative signals and repeated
  patterns. Advisory only; no memory mutation.

Operational pattern:

1. Gateway/caller should send DM/user-owned reactions by default. Ignore group or
   public-chat reactions unless Justin explicitly enables that source.
2. Store only redacted previews. Never pass raw secrets or sensitive message
   bodies as reaction metadata.
3. Treat a single 👍/👎/✅/👀 as telemetry. Repeated multi-day patterns can become
   review candidates or operator follow-up, but should not auto-promote.
4. Negative/ambiguous reactions are QA signals. They can trigger review or skill
   tuning, but never destructive memory edits by themselves.

## Cross-agent SOFIA consistency

Pi and Hermes must point at the same SOFIA Cloud project and use env/1Password secret references, not raw keys. Run:

```bash
cd ~/dev/dotfiles
mise run sofia-cloud:agent-consistency
```

For a live boot-context fetch through the linked Hermes helper:

```bash
SOFIA_AGENT_CONSISTENCY_LIVE=1 mise run sofia-cloud:agent-consistency
```

This check verifies the Supabase project ref, Pi `mcp.json`, Hermes `sofia-spike` MCP config, local-memory disabled state, lifecycle tool exposure, and optional live SOFIA Cloud boot-context markers.
