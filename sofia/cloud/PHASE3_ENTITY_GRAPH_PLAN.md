# SOFIA Phase 3 Entity Graph Model Implementation Plan

> **For Hermes:** Use TDD task-by-task. Write a failing focused Deno test before changing runtime code for each behavior.

**Goal:** make projects, repos, people, organizations, systems, tools, and decisions first-class retrieval anchors instead of loose candidate metadata.

**Architecture:** extend the existing `entities`, `event_entities`, and `memory_entities` foundation rather than replacing it. Add aliases, typed entity edges, todo/entity attachments, runtime helpers for canonical identity resolution, and entity-scoped retrieval/boot-context support. Keep existing memory search and boot context behavior unchanged when no entity scope is requested.

**Tech Stack:** Supabase/Postgres migrations, Deno TypeScript Edge Function runtime, `@supabase/supabase-js`, Deno tests.

---

## Existing baseline

`0001_sofia_cloud_core.sql` already created:

- `entities(id, entity_type, name, normalized_name, metadata, created_at, updated_at)`
- `event_entities(event_id, entity_id, evidence)`
- `memory_entities(memory_id, entity_id, evidence)`

Phase 3 should evolve these into stable retrieval anchors with minimal disruption:

- keep `name` as the display/canonical name for now; optionally add `canonical_name` as a generated/backfilled alias later only if needed.
- preserve `unique(entity_type, normalized_name)`.
- add missing entity types via check-constraint replacement.
- add alias and edge tables.
- add `todo_entities` because todos are now first-class.
- add runtime helper functions instead of pushing all logic into SQL.

---

## Phase 3A — Schema foundation

### Task 1: Add entity graph migration

**Objective:** create the DB structures required for canonical aliases, entity relations, and todo attachments.

**Files:**

- Create: `sofia/cloud/supabase/migrations/0007_entity_graph_model.sql`

**Step 1: Write migration**

Migration must be incremental/idempotent where practical:

```sql
-- Entity graph model: aliases, typed edges, and todo attachments.

alter table entities drop constraint if exists entities_entity_type_check;

alter table entities add constraint entities_entity_type_check
  check (entity_type in (
    'person',
    'organization',
    'project',
    'repo',
    'system',
    'tool',
    'decision',
    'place',
    'topic',
    'artifact'
  ));

alter table entities
  add column if not exists description text,
  add column if not exists external_refs jsonb not null default '{}'::jsonb,
  add column if not exists merged_into_entity_id uuid references entities(id) on delete set null,
  add column if not exists status text not null default 'active';

alter table entities drop constraint if exists entities_status_check;

alter table entities add constraint entities_status_check
  check (status in ('active', 'merged', 'archived'));

create index if not exists idx_entities_type_status
  on entities(entity_type, status, normalized_name);

create index if not exists idx_entities_external_refs
  on entities using gin(external_refs);

create table if not exists entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text not null default 'agent',
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(entity_id, normalized_alias)
);

create unique index if not exists idx_entity_aliases_type_normalized_active
  on entity_aliases(normalized_alias, entity_id);

create index if not exists idx_entity_aliases_normalized
  on entity_aliases(normalized_alias);

create table if not exists entity_edges (
  id uuid primary key default gen_random_uuid(),
  from_entity_id uuid not null references entities(id) on delete cascade,
  to_entity_id uuid not null references entities(id) on delete cascade,
  relation text not null check (relation in (
    'related_to',
    'belongs_to_project',
    'belongs_to_organization',
    'repo_for_project',
    'system_for_project',
    'tool_used_by',
    'decision_about',
    'depends_on',
    'supersedes',
    'duplicates'
  )),
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  rationale text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(from_entity_id, to_entity_id, relation),
  check (from_entity_id <> to_entity_id)
);

create index if not exists idx_entity_edges_from_relation
  on entity_edges(from_entity_id, relation);

create index if not exists idx_entity_edges_to_relation
  on entity_edges(to_entity_id, relation);

create table if not exists todo_entities (
  todo_id uuid not null references todos(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  evidence text,
  created_at timestamptz not null default now(),
  primary key (todo_id, entity_id)
);

create index if not exists idx_event_entities_entity
  on event_entities(entity_id);

create index if not exists idx_memory_entities_entity
  on memory_entities(entity_id);

create index if not exists idx_todo_entities_entity
  on todo_entities(entity_id);

alter table entity_aliases enable row level security;
alter table entity_edges enable row level security;
alter table todo_entities enable row level security;

create policy "service role manages entity_aliases" on entity_aliases
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role manages entity_edges" on entity_edges
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "service role manages todo_entities" on todo_entities
  for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select, insert, update, delete on table entity_aliases to service_role;
grant select, insert, update, delete on table entity_edges to service_role;
grant select, insert, update, delete on table todo_entities to service_role;
```

**Step 2: Verify local SQL syntax**

Run:

```bash
git diff --check -- sofia/cloud/supabase/migrations/0007_entity_graph_model.sql
mise run sofia-cloud:check
```

Expected: both pass.

---

## Phase 3B — Entity runtime helpers

### Task 2: Add failing tests for entity normalization and alias resolution

**Objective:** prove `normalizeEntityName` and `resolveEntity` behavior before implementation.

**Files:**

- Create: `sofia/cloud/supabase/functions/sofia-core/entities_test.ts`
- Create: `sofia/cloud/supabase/functions/sofia-core/entities.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/types.ts`

**Step 1: Write failing tests**

Add tests for:

1. `normalizeEntityName(" Telophase-QS ") === "telophase qs"`
2. `resolveEntity` returns an existing canonical entity by `(entity_type, normalized_name)`.
3. `resolveEntity` returns an existing entity by alias when direct canonical lookup misses.
4. `resolveEntity` inserts a new entity and alias when no match exists.

Use a fake Supabase client pattern similar to `db_test.ts`, but keep it local to `entities_test.ts`.

**Step 2: Verify RED**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test --allow-env --allow-net entities_test.ts
```

Expected: FAIL because `entities.ts` exports do not exist yet.

### Task 3: Implement entity helpers minimally

**Objective:** make the tests pass with a small helper module.

**Files:**

- Create/Modify: `sofia/cloud/supabase/functions/sofia-core/entities.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/types.ts`

**Required exports:**

```ts
export type EntityType =
  | "person"
  | "organization"
  | "project"
  | "repo"
  | "system"
  | "tool"
  | "decision"
  | "place"
  | "topic"
  | "artifact";

export type EntityInput = {
  type: string;
  name: string;
  evidence?: string;
  aliases?: string[];
  external_refs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export function normalizeEntityName(name: string): string;

export async function resolveEntity(
  supabase: SupabaseClient,
  input: EntityInput,
): Promise<string | null>;
```

Rules:

- invalid/empty type or name returns `null`.
- type aliases should map common classifier output to schema values:
  - `technology` -> `tool`
  - `broker` -> `organization`
  - `database` -> `system`
  - `repository` -> `repo`
- canonical lookup first: `entities.entity_type` + `entities.normalized_name` + `status = active`.
- alias lookup second via `entity_aliases.normalized_alias` then active `entities`.
- insert if missing:
  - `entities`: `entity_type`, `name`, `normalized_name`, `external_refs`, `metadata`, `status: active`
  - `entity_aliases`: canonical name plus provided aliases.
- do not throw for duplicate alias insert conflicts unless Supabase returns an unexpected error.

**Step 2: Verify GREEN**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test --allow-env --allow-net entities_test.ts
mise run sofia-cloud:test
```

Expected: all pass.

---

## Phase 3C — Attach memories and todos to entities

### Task 4: Add failing tests for promotion and todo entity attachments

**Objective:** prove candidate entities stop being passive metadata and become graph links.

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/db_test.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/db.ts`

**Step 1: Write failing tests**

Add tests for:

1. `promoteCandidate` resolves and inserts `memory_entities` for candidate entities.
2. `promoteExistingCandidate` resolves and inserts `memory_entities` using candidate `metadata.entities`.
3. `createTodoFromCandidate` resolves and inserts `todo_entities` for candidate entities.

Expected initial failure: calls to `memory_entities` / `todo_entities` are absent.

**Step 2: Verify RED**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test --allow-env --allow-net db_test.ts --filter "entities"
```

Expected: FAIL for missing graph attachment calls.

### Task 5: Implement entity attachment helpers in `db.ts`

**Objective:** attach resolved entity IDs during memory/todo creation without changing existing behavior when candidates have no entities.

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/db.ts`

Implementation shape:

```ts
import { resolveEntity, type EntityInput } from "./entities.ts";

async function attachMemoryEntities(
  supabase: SupabaseClient,
  memoryId: string,
  entities: EntityInput[],
): Promise<string[]>;

async function attachTodoEntities(
  supabase: SupabaseClient,
  todoId: string,
  entities: EntityInput[],
): Promise<string[]>;
```

Rules:

- skip empty entity arrays.
- call `resolveEntity` per entity.
- insert join rows with `evidence` when entity ID exists.
- use upsert/insert semantics compatible with fake tests and Supabase.
- return attached entity IDs for future boot snapshot usage.

**Step 2: Verify GREEN**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test --allow-env --allow-net db_test.ts --filter "entities"
mise run sofia-cloud:test
```

Expected: all pass.

---

## Phase 3D — Entity-scoped search and boot context

### Task 6: Add entity filter to search RPC and MCP search input

**Objective:** allow agents to search within an entity/project scope.

**Files:**

- Modify: `sofia/cloud/supabase/migrations/0007_entity_graph_model.sql`
- Modify: `sofia/cloud/supabase/functions/sofia-core/index.ts`
- Modify: search-related tests in `db_test.ts` or new `search_test.ts` if cleaner

Add or replace `match_memories` with optional parameters:

```sql
filter_entity_id uuid default null,
filter_entity_name text default null
```

Search rules:

- default behavior unchanged when no entity filter is provided.
- when `filter_entity_id` is provided, only return memories joined through `memory_entities`.
- when `filter_entity_name` is provided, resolve against `entities.normalized_name` or `entity_aliases.normalized_alias` in SQL.
- maintain stale/expired/superseded filtering from Phase 2.

Update MCP `search_memory` schema to accept optional:

```ts
entity_id?: string;
entity?: string;
```

**RED/GREEN:** add failing tests around RPC argument construction or helper behavior first, then implement.

### Task 7: Add entity-scoped boot context request

**Objective:** compile boot context for a project/entity slice without unrelated facts.

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/types.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/boot_context.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/boot_context_test.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/http.ts` if HTTP params need parsing
- Modify: `sofia/cloud/supabase/functions/sofia-core/index.ts` if MCP schema needs params

API shape:

```ts
export type BootContextRequest = {
  context: SofiaContext;
  force_refresh?: boolean;
  entity_id?: string;
  entity?: string;
};
```

Rules:

- default boot context unchanged when no entity scope is requested.
- entity-scoped boot context should:
  - include shared + requested context as before.
  - load only memories attached to the target entity.
  - load only todos attached to the target entity.
  - persist `included_entity_ids` in `boot_context_snapshots`.
  - include entity filter details in `source_query`.
- do not overwrite the default `compiled_artifacts` cache for entity-scoped requests unless a separate artifact name/key is used. Prefer always compiling scoped requests and storing only `boot_context_snapshots`.

**RED/GREEN:** add failing boot-context tests first, then implement.

---

## Phase 3E — Backfill and docs

### Task 8: Add safe metadata backfill path

**Objective:** connect existing candidate/memory metadata entities to graph rows without guessing too aggressively.

**Files:**

- Modify: `sofia/cloud/supabase/migrations/0007_entity_graph_model.sql`
- Optional runtime script: `sofia/cloud/scripts/backfill_entities_from_metadata.ts` if SQL-only backfill becomes too brittle.

Backfill rules:

- from `memory_candidates.metadata->'entities'` and `memories.metadata->'entities'` only when each item has string `type` and string `name`.
- normalize name with SQL equivalent of runtime normalization, or defer runtime script if exact parity matters.
- insert entities with `metadata.source = 'metadata_backfill'`.
- attach `memory_entities` for memories only.
- do not backfill todos unless candidate/todo metadata shape is already reliable.

### Task 9: Update roadmap/runbook

**Objective:** document how entity scopes work and mark Phase 3 status accurately.

**Files:**

- Modify: `sofia/cloud/ROADMAP.md`
- Modify: `sofia/cloud/RUNBOOK.md`

Include:

- entity tables and relationship model.
- how to search within an entity scope.
- how to request entity-scoped boot context.
- live smoke commands.
- known limitations and Phase 4 handoff.

---

## Verification and deployment

Run before commit:

```bash
mise run sofia-cloud:test
mise run sofia-cloud:check
git diff --check -- sofia/cloud
```

Deploy when tests pass:

```bash
cd sofia/cloud
supabase db push
supabase functions deploy sofia-core --project-ref avgjtkgppeeihntsyjpy
mise run sofia-cloud:health
```

Live smoke after deploy:

1. Capture or find a memory candidate with entities.
2. Promote it or use an existing promoted memory with entity attachment.
3. Confirm `search_memory` with `entity` only returns scoped memory rows.
4. Confirm `get_boot_context(force_refresh=true, entity=...)` returns `included_entity_ids` and excludes unrelated facts.
5. Confirm no secrets appear in logs or summaries.

Commit:

```bash
git add sofia/cloud
 git commit -m "feat(sofia): add entity graph retrieval anchors"
```

---

## Definition of done

- `0007_entity_graph_model.sql` is incremental and deployed.
- Entity alias resolution tests pass.
- Memory and todo attachment tests pass.
- Entity-scoped search tests pass.
- Entity-scoped boot-context tests pass.
- Existing unscoped search and boot context behavior remains compatible.
- `mise run sofia-cloud:test` passes.
- `mise run sofia-cloud:check` passes.
- `git diff --check -- sofia/cloud` passes.
- Live health passes after deploy.
- Live MCP/API smoke proves entity-scoped retrieval works.
- Roadmap/runbook updated.
- Conventional commit created with no unrelated changes.
