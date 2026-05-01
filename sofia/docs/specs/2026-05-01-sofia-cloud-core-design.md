# SOFIA Cloud Core — Design

- **Status:** draft
- **Date:** 2026-05-01
- **Scope:** canonical cloud data layer for SOFIA vNext
- **Reference architecture:** OB1 / Open Brain patterns, adapted for SOFIA's context-aware memory model

## Summary

SOFIA Cloud Core moves SOFIA from a vault-first local memory layer toward a durable Postgres-backed memory operating system. The database becomes the canonical store for raw events, candidate memories, durable memories, entities, edges, and compiled artifacts. Obsidian remains valuable, but primarily as a compiled/readable surface rather than the only source of truth.

The first cloud target is **Supabase** because it provides Postgres, pgvector, Edge Functions, secrets, RLS, and remote MCP deployment patterns in one platform. The schema should remain portable to local Postgres so SOFIA can run locally or in cloud with minimal redesign.

## Goals

- Establish a canonical structured store for SOFIA memory.
- Support automatic memory-worthiness classification and promotion.
- Preserve provenance from every durable memory back to raw source events.
- Enable rollback/versioning for promoted memories.
- Support remote MCP, chat adapters, and automation workers.
- Compile SOFIA artifacts (`SOUL.md`, `USER.md`, context memory, topic pages) from structured memory.
- Keep secrets out of memory and artifacts.

## Non-goals

- Replacing all existing SOFIA v1 vault workflows immediately.
- Building every OB1 recipe or extension.
- Bidirectional Obsidian sync in the first iteration.
- Multi-user SaaS support beyond schema choices that do not block it later.
- Complex permissioning beyond single-user + service-role runtime in the first version.

## Architecture

```text
Capture sources
  Pi / Claude Code / ChatGPT / Cursor / Obsidian / chat / importers
        ↓
SOFIA Cloud API / MCP / workers
        ↓
Supabase Postgres + pgvector
        ↓
compiled artifacts + search + review queues
        ↓
Obsidian, AI boot context, chat, dashboards
```

## Canonical data model

### `events`

Append-only raw captured material. This is the lossless source layer.

Examples:

- manual “remember this” captures
- session summaries
- pre-compact/session-end summaries
- chat messages to SOFIA
- imported notes
- meeting debriefs
- transcript chunks

Core fields:

```sql
id uuid primary key default gen_random_uuid(),
context text not null check (context in ('personal', 'work', 'shared')),
source text not null,
source_ref text,
content text not null,
metadata jsonb not null default '{}',
embedding vector(1536),
content_fingerprint text,
sensitivity text not null default 'normal'
  check (sensitivity in ('normal', 'private', 'secret_redacted')),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

### `memory_candidates`

Potential durable memories extracted from events.

Core fields:

```sql
id uuid primary key default gen_random_uuid(),
event_id uuid references events(id) on delete cascade,
context text not null,
candidate_type text not null,
candidate_text text not null,
worthiness_score real not null,
confidence real not null,
risk_level text not null check (risk_level in ('low', 'medium', 'high')),
recommended_action text not null
  check (recommended_action in ('auto_promote', 'review', 'archive', 'reject')),
reasoning text,
status text not null default 'pending_review'
  check (status in ('pending_review', 'auto_promoted', 'approved', 'rejected', 'archived')),
metadata jsonb not null default '{}',
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

### `memories`

Promoted durable memory.

Memory types:

```text
fact
preference
decision
lesson
gotcha
project_context
person_context
operating_rule
```

Core fields:

```sql
id uuid primary key default gen_random_uuid(),
context text not null check (context in ('personal', 'work', 'shared')),
memory_type text not null,
title text not null,
body text not null,
confidence real not null default 1.0,
status text not null default 'active'
  check (status in ('active', 'superseded', 'archived', 'rejected')),
created_from_candidate_id uuid references memory_candidates(id),
current_version int not null default 1,
metadata jsonb not null default '{}',
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

### `memory_versions`

Audit and rollback table.

```sql
id uuid primary key default gen_random_uuid(),
memory_id uuid not null references memories(id) on delete cascade,
version int not null,
title text not null,
body text not null,
change_reason text,
created_by text not null default 'system',
created_at timestamptz not null default now(),
unique(memory_id, version)
```

### `entities`

Canonical entities across events and memories.

Entity types:

```text
person
project
place
system
topic
organization
artifact
```

### `event_entities` / `memory_entities`

Join tables with evidence metadata.

### `memory_edges`

Typed relationships among memories/entities.

Relations:

```text
supports
contradicts
supersedes
depends_on
related_to
evolved_into
```

### `compiled_artifacts`

Generated outputs for agents and humans.

Artifact names:

```text
SOUL.md
USER.md
memory/shared.md
memory/personal.md
memory/work.md
topics/<slug>.md
plans/<slug>.md
weekly-review/<date>.md
```

Core fields:

```sql
id uuid primary key default gen_random_uuid(),
artifact_name text not null,
context text not null,
content text not null,
content_type text not null default 'text/markdown',
source_query jsonb not null default '{}',
generated_at timestamptz not null default now(),
metadata jsonb not null default '{}'
```

## Search

Search should combine:

1. vector search over `events.content`, `memory_candidates.candidate_text`, and `memories.body`
2. Postgres full-text search
3. structured filters: context, type, entity, source, date range, status

Default user-facing search should prioritize durable memories, then candidates, then raw events.

## Secrets model

SOFIA must store references, never secret values.

- Local: 1Password CLI refs (`op://...`) and environment variables.
- Cloud: Supabase secrets for runtime values.
- Database: optional `secret_refs` metadata table only.
- Memory/artifacts/events: redacted before storage.

Redaction happens before event insertion.

## Migration posture

SOFIA v1 vault remains usable during migration.

Initial import path:

```text
SOFIA vault files
→ events
→ memory candidates
→ review/auto-promote
→ compiled artifacts back to vault
```

Do not bulk-create durable memories directly from existing markdown without provenance.

## Open questions

- Should cloud SOFIA be single-user only at first, or include `user_id` columns everywhere from day one?
- Which embedding provider/model should be first: OpenRouter `text-embedding-3-small`, direct OpenAI, or local-compatible abstraction?
- Should compiled Obsidian artifacts be write-only/generated, or should human edits be imported back later?
- How much of existing SOFIA v1 memory should seed durable `memories` directly vs candidates?

## Recommendation

Use Supabase as the first cloud runtime, with a schema that can also run on local Postgres. Build SOFIA Cloud as an opinionated memory OS on top of Postgres, not as a direct OB1 migration.
