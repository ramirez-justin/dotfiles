# SOFIA Cloud Phase 1–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first cloud-capable SOFIA core: Supabase/Postgres schema, remote MCP capture/search/review tools, and a synchronous memory-worthiness pipeline with redaction, candidate extraction, hybrid auto-promotion, review queue, provenance, and rollback.

**Architecture:** Supabase Postgres is the canonical store. A single Edge Function (`sofia-core`) exposes remote MCP tools and shares pure TypeScript modules for redaction, routing, metadata validation, and classifier parsing. `capture_event` writes raw events, extracts candidate memories, routes them through the hybrid auto-promotion/review policy, and persists durable memories with version rows when safe.

**Tech Stack:** Supabase Postgres + pgvector, Supabase Edge Functions (Deno/TypeScript), MCP SDK, Hono, Zod, OpenRouter-compatible LLM/embedding APIs, SQL migrations, Deno tests.

---

## Preconditions / Accounts

You do **not** need to create accounts before reviewing this plan.

Before deployment execution reaches Task 8, you will need:

1. **Supabase project** named something like `sofia-cloud`.
2. **OpenRouter API key** or another OpenAI-compatible provider key for embeddings + classifier calls.
3. **MCP access key** generated locally with:

   ```bash
   openssl rand -hex 32
   ```

4. Optional but recommended: store all three in 1Password first, then set Supabase secrets from those values.

Local file/schema work can start before accounts exist. Cloud deployment and end-to-end MCP testing require the Supabase project.

## Scope boundaries

This plan implements only Phase 1 + Phase 2:

- Cloud core schema
- event ingestion
- redaction
- candidate extraction/classification
- hybrid promotion/review routing
- durable memories + versions
- remote MCP tools for capture/search/review/profile/artifact retrieval

This plan does **not** implement:

- Telegram/WhatsApp/Signal adapters
- Obsidian compiled artifact exporter
- graph/wiki compiler
- importers
- dashboard

Those belong to later plans after the cloud core is validated.

## File structure

### Created files

| Path | Responsibility |
|---|---|
| `sofia/cloud/README.md` | Operator notes: local/dev/deploy commands and secret setup |
| `sofia/cloud/supabase/migrations/0001_sofia_cloud_core.sql` | Tables, indexes, RLS, grants, helper RPCs |
| `sofia/cloud/supabase/functions/sofia-core/deno.json` | Deno imports/tasks for the Edge Function |
| `sofia/cloud/supabase/functions/sofia-core/index.ts` | Hono + MCP server entrypoint |
| `sofia/cloud/supabase/functions/sofia-core/types.ts` | Shared TypeScript types/enums |
| `sofia/cloud/supabase/functions/sofia-core/redact.ts` | Secret redaction before event insert |
| `sofia/cloud/supabase/functions/sofia-core/classifier.ts` | LLM classifier call + strict JSON parsing |
| `sofia/cloud/supabase/functions/sofia-core/router.ts` | Hybrid auto-promotion/review routing policy |
| `sofia/cloud/supabase/functions/sofia-core/db.ts` | Supabase DB helper functions |
| `sofia/cloud/supabase/functions/sofia-core/format.ts` | MCP response formatting |
| `sofia/cloud/supabase/functions/sofia-core/redact_test.ts` | Deno unit tests for redaction |
| `sofia/cloud/supabase/functions/sofia-core/router_test.ts` | Deno unit tests for routing thresholds |
| `sofia/cloud/supabase/functions/sofia-core/classifier_test.ts` | Deno unit tests for classifier JSON parsing |

### Modified files

| Path | Change |
|---|---|
| `sofia/docs/plans/2026-05-01-sofia-cloud-roadmap.md` | Add link to this implementation plan |

---

## Task 1: Add cloud folder skeleton and operator README

**Files:**

- Create: `sofia/cloud/README.md`
- Create directories:
  - `sofia/cloud/supabase/migrations/`
  - `sofia/cloud/supabase/functions/sofia-core/`

- [ ] **Step 1: Create directories**

```bash
mkdir -p sofia/cloud/supabase/migrations
mkdir -p sofia/cloud/supabase/functions/sofia-core
```

- [ ] **Step 2: Write `sofia/cloud/README.md`**

```markdown
# SOFIA Cloud

Cloud-capable SOFIA core built on Supabase Postgres, pgvector, and a remote MCP Edge Function.

## Runtime pieces

- `supabase/migrations/` — canonical SQL schema
- `supabase/functions/sofia-core/` — MCP + API Edge Function

## Required Supabase secrets

Set these before deployment:

```bash
supabase secrets set MCP_ACCESS_KEY=<hex-access-key>
supabase secrets set OPENROUTER_API_KEY=<provider-key>
```

Supabase provides these automatically inside Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Recommended secret handling

Keep secret values in 1Password. Store only references in notes/docs. Never paste service-role keys into SOFIA memory, events, artifacts, or chat.

## First deploy checklist

1. Create a Supabase project.
2. Link local checkout:

   ```bash
   supabase link --project-ref <project-ref>
   ```

3. Push schema:

   ```bash
   supabase db push
   ```

4. Set secrets:

   ```bash
   supabase secrets set MCP_ACCESS_KEY=<generated-key>
   supabase secrets set OPENROUTER_API_KEY=<provider-key>
   ```

5. Deploy function:

   ```bash
   supabase functions deploy sofia-core --no-verify-jwt
   ```

6. MCP URL:

   ```text
   https://<project-ref>.supabase.co/functions/v1/sofia-core?key=<generated-key>
   ```
```

- [ ] **Step 3: Verify files**

```bash
find sofia/cloud -maxdepth 4 -type d | sort
```

Expected output includes:

```text
sofia/cloud
sofia/cloud/supabase/functions
sofia/cloud/supabase/functions/sofia-core
sofia/cloud/supabase
sofia/cloud/supabase/migrations
```

- [ ] **Step 4: Commit**

```bash
git add sofia/cloud/README.md
git commit -m "sofia-cloud: scaffold cloud core workspace"
```

---

## Task 2: Add Supabase schema migration

**Files:**

- Create: `sofia/cloud/supabase/migrations/0001_sofia_cloud_core.sql`

- [ ] **Step 1: Write migration**

Create `sofia/cloud/supabase/migrations/0001_sofia_cloud_core.sql` with:

```sql
create extension if not exists vector;
create extension if not exists pgcrypto;

create or replace function sofia_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  context text not null check (context in ('personal', 'work', 'shared')),
  source text not null,
  source_ref text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  content_fingerprint text,
  sensitivity text not null default 'normal'
    check (sensitivity in ('normal', 'private', 'secret_redacted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_events_content_fingerprint
  on events (content_fingerprint)
  where content_fingerprint is not null;

create index if not exists idx_events_context_created_at
  on events (context, created_at desc);

create index if not exists idx_events_metadata
  on events using gin (metadata);

create index if not exists idx_events_embedding
  on events using hnsw (embedding vector_cosine_ops);

create table if not exists memory_candidates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  context text not null check (context in ('personal', 'work', 'shared')),
  candidate_type text not null check (candidate_type in (
    'fact',
    'preference',
    'decision',
    'lesson',
    'gotcha',
    'project_context',
    'person_context',
    'operating_rule',
    'todo',
    'open_loop'
  )),
  candidate_text text not null,
  worthiness_score real not null check (worthiness_score >= 0 and worthiness_score <= 1),
  confidence real not null check (confidence >= 0 and confidence <= 1),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  recommended_action text not null check (recommended_action in ('auto_promote', 'review', 'archive', 'reject')),
  reasoning text,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'auto_promoted', 'approved', 'rejected', 'archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_memory_candidates_status_context
  on memory_candidates (status, context, created_at desc);

create index if not exists idx_memory_candidates_event
  on memory_candidates (event_id);

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  context text not null check (context in ('personal', 'work', 'shared')),
  memory_type text not null check (memory_type in (
    'fact',
    'preference',
    'decision',
    'lesson',
    'gotcha',
    'project_context',
    'person_context',
    'operating_rule'
  )),
  title text not null,
  body text not null,
  embedding vector(1536),
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  status text not null default 'active'
    check (status in ('active', 'superseded', 'archived', 'rejected')),
  created_from_candidate_id uuid references memory_candidates(id),
  current_version int not null default 1 check (current_version > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_memories_context_type_status
  on memories (context, memory_type, status, created_at desc);

create index if not exists idx_memories_embedding
  on memories using hnsw (embedding vector_cosine_ops);

create table if not exists memory_versions (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references memories(id) on delete cascade,
  version int not null check (version > 0),
  title text not null,
  body text not null,
  change_reason text,
  created_by text not null default 'system',
  created_at timestamptz not null default now(),
  unique(memory_id, version)
);

create table if not exists entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('person', 'project', 'place', 'system', 'topic', 'organization', 'artifact')),
  name text not null,
  normalized_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entity_type, normalized_name)
);

create table if not exists event_entities (
  event_id uuid not null references events(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  evidence text,
  created_at timestamptz not null default now(),
  primary key (event_id, entity_id)
);

create table if not exists memory_entities (
  memory_id uuid not null references memories(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  evidence text,
  created_at timestamptz not null default now(),
  primary key (memory_id, entity_id)
);

create table if not exists memory_edges (
  id uuid primary key default gen_random_uuid(),
  from_memory_id uuid not null references memories(id) on delete cascade,
  to_memory_id uuid not null references memories(id) on delete cascade,
  relation text not null check (relation in ('supports', 'contradicts', 'supersedes', 'depends_on', 'related_to', 'evolved_into')),
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  rationale text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(from_memory_id, to_memory_id, relation),
  check (from_memory_id <> to_memory_id)
);

create table if not exists compiled_artifacts (
  id uuid primary key default gen_random_uuid(),
  artifact_name text not null,
  context text not null check (context in ('personal', 'work', 'shared')),
  content text not null,
  content_type text not null default 'text/markdown',
  source_query jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(artifact_name, context)
);

create table if not exists classifier_outcomes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references memory_candidates(id) on delete cascade,
  model text not null,
  candidate_type text not null,
  worthiness_score real not null,
  confidence real not null,
  risk_level text not null,
  routed_action text not null,
  user_accepted boolean,
  user_correction jsonb,
  created_at timestamptz not null default now()
);

create or replace function sofia_content_fingerprint(p_content text)
returns text as $$
  select encode(digest(lower(trim(regexp_replace(p_content, '\s+', ' ', 'g'))), 'sha256'), 'hex');
$$ language sql immutable;

create or replace function match_memories(
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 10,
  filter_context text default null,
  include_archived boolean default false
)
returns table (
  id uuid,
  context text,
  memory_type text,
  title text,
  body text,
  similarity float,
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
    m.created_at
  from memories m
  where m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) > match_threshold
    and (filter_context is null or m.context = filter_context)
    and (include_archived or m.status = 'active')
  order by m.embedding <=> query_embedding
  limit match_count;
end;
$$;

create trigger trg_events_updated_at
  before update on events
  for each row execute function sofia_set_updated_at();

create trigger trg_memory_candidates_updated_at
  before update on memory_candidates
  for each row execute function sofia_set_updated_at();

create trigger trg_memories_updated_at
  before update on memories
  for each row execute function sofia_set_updated_at();

create trigger trg_entities_updated_at
  before update on entities
  for each row execute function sofia_set_updated_at();

create trigger trg_compiled_artifacts_updated_at
  before update on compiled_artifacts
  for each row execute function sofia_set_updated_at();

alter table events enable row level security;
alter table memory_candidates enable row level security;
alter table memories enable row level security;
alter table memory_versions enable row level security;
alter table entities enable row level security;
alter table event_entities enable row level security;
alter table memory_entities enable row level security;
alter table memory_edges enable row level security;
alter table compiled_artifacts enable row level security;
alter table classifier_outcomes enable row level security;

create policy "service role manages events" on events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages memory_candidates" on memory_candidates for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages memories" on memories for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages memory_versions" on memory_versions for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages entities" on entities for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages event_entities" on event_entities for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages memory_entities" on memory_entities for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages memory_edges" on memory_edges for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages compiled_artifacts" on compiled_artifacts for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service role manages classifier_outcomes" on classifier_outcomes for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

grant select, insert, update, delete on table events to service_role;
grant select, insert, update, delete on table memory_candidates to service_role;
grant select, insert, update, delete on table memories to service_role;
grant select, insert, update, delete on table memory_versions to service_role;
grant select, insert, update, delete on table entities to service_role;
grant select, insert, update, delete on table event_entities to service_role;
grant select, insert, update, delete on table memory_entities to service_role;
grant select, insert, update, delete on table memory_edges to service_role;
grant select, insert, update, delete on table compiled_artifacts to service_role;
grant select, insert, update, delete on table classifier_outcomes to service_role;
```

- [ ] **Step 2: Validate SQL file has no destructive statements**

```bash
rg -n "drop table|truncate|delete from" sofia/cloud/supabase/migrations/0001_sofia_cloud_core.sql
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add sofia/cloud/supabase/migrations/0001_sofia_cloud_core.sql
git commit -m "sofia-cloud: add core memory schema migration"
```

---

## Task 3: Add Deno function dependencies and shared types

**Files:**

- Create: `sofia/cloud/supabase/functions/sofia-core/deno.json`
- Create: `sofia/cloud/supabase/functions/sofia-core/types.ts`

- [ ] **Step 1: Write `deno.json`**

```json
{
  "imports": {
    "@hono/mcp": "jsr:@hono/mcp@0.1.0",
    "@modelcontextprotocol/sdk/": "npm:@modelcontextprotocol/sdk@^1.17.0/",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@^2.45.0",
    "hono": "jsr:@hono/hono@^4.6.0",
    "zod": "npm:zod@^3.23.8"
  },
  "tasks": {
    "test": "deno test --allow-env --allow-net=api.openrouter.ai",
    "check": "deno check index.ts"
  },
  "compilerOptions": {
    "lib": ["deno.ns", "dom", "dom.iterable"]
  }
}
```

- [ ] **Step 2: Write `types.ts`**

```ts
export type SofiaContext = "personal" | "work" | "shared";

export type EventSensitivity = "normal" | "private" | "secret_redacted";

export type CandidateType =
  | "fact"
  | "preference"
  | "decision"
  | "lesson"
  | "gotcha"
  | "project_context"
  | "person_context"
  | "operating_rule"
  | "todo"
  | "open_loop";

export type MemoryType = Exclude<CandidateType, "todo" | "open_loop">;

export type RiskLevel = "low" | "medium" | "high";
export type RecommendedAction = "auto_promote" | "review" | "archive" | "reject";
export type CandidateStatus = "pending_review" | "auto_promoted" | "approved" | "rejected" | "archived";

export type RedactionResult = {
  content: string;
  redacted: boolean;
  labels: string[];
};

export type CandidateInput = {
  candidate_type: CandidateType;
  candidate_text: string;
  title: string;
  worthiness_score: number;
  confidence: number;
  risk_level: RiskLevel;
  recommended_action: RecommendedAction;
  reasoning: string;
  entities: Array<{ type: string; name: string; evidence?: string }>;
  metadata: Record<string, unknown>;
};

export type RouteDecision = {
  action: RecommendedAction;
  status: CandidateStatus;
  shouldPromote: boolean;
  reason: string;
};

export type CaptureEventInput = {
  content: string;
  context: SofiaContext;
  source: string;
  source_ref?: string;
  type_hint?: string;
  metadata?: Record<string, unknown>;
};
```

- [ ] **Step 3: Run Deno check**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno check types.ts
```

Expected: `Check file:///.../types.ts` and exit 0.

- [ ] **Step 4: Commit**

```bash
git add sofia/cloud/supabase/functions/sofia-core/deno.json sofia/cloud/supabase/functions/sofia-core/types.ts
git commit -m "sofia-cloud: add edge function deps and core types"
```

---

## Task 4: Implement and test redaction

**Files:**

- Create: `sofia/cloud/supabase/functions/sofia-core/redact.ts`
- Create: `sofia/cloud/supabase/functions/sofia-core/redact_test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { redactSecrets } from "./redact.ts";

Deno.test("redactSecrets redacts OpenAI-style keys", () => {
  const result = redactSecrets("key is " + "s" + "k-" + "testabcdefghijklmnopqrstuvwxyz123456");
  assertEquals(result.redacted, true);
  assertEquals(result.content.includes("s" + "k-" + "test"), false);
  assertEquals(result.content.includes("[REDACTED_SECRET:openai_key]"), true);
  assertEquals(result.labels, ["openai_key"]);
});

Deno.test("redactSecrets redacts bearer tokens", () => {
  const result = redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz.1234567890");
  assertEquals(result.redacted, true);
  assertEquals(result.content, "Authorization: Bearer [REDACTED_SECRET:bearer_token]");
});

Deno.test("redactSecrets redacts private keys", () => {
  const result = redactSecrets("-----BEGIN " + "PRIVATE " + "KEY-----\nabc\n-----END " + "PRIVATE " + "KEY-----");
  assertEquals(result.redacted, true);
  assertEquals(result.content, "[REDACTED_SECRET:private_key]");
});

Deno.test("redactSecrets leaves normal text unchanged", () => {
  const result = redactSecrets("SOFIA should use Supabase as a cloud target.");
  assertEquals(result.redacted, false);
  assertEquals(result.labels, []);
  assertEquals(result.content, "SOFIA should use Supabase as a cloud target.");
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test redact_test.ts
```

Expected: failure because `redact.ts` does not exist.

- [ ] **Step 3: Implement `redact.ts`**

```ts
import type { RedactionResult } from "./types.ts";

const PATTERNS: Array<{ label: string; regex: RegExp; replacement: string }> = [
  {
    label: "private_key",
    regex: new RegExp("-----BEGIN [A-Z ]*" + "PRIVATE " + "KEY-----[\\s\\S]*?-----END [A-Z ]*" + "PRIVATE " + "KEY-----", "g"),
    replacement: "[REDACTED_SECRET:private_key]",
  },
  {
    label: "openai_key",
    regex: new RegExp("\\b" + "s" + "k-" + "[A-Za-z0-9_-]{20,}\\b", "g"),
    replacement: "[REDACTED_SECRET:openai_key]",
  },
  {
    label: "github_token",
    regex: new RegExp("\\b" + "gh" + "[pousr]_[A-Za-z0-9_]{20,}\\b", "g"),
    replacement: "[REDACTED_SECRET:github_token]",
  },
  {
    label: "aws_access_key",
    regex: new RegExp("\\b" + "AK" + "IA[0-9A-Z]{16}\\b", "g"),
    replacement: "[REDACTED_SECRET:aws_access_key]",
  },
  {
    label: "slack_token",
    regex: new RegExp("\\b" + "xo" + "x[baprs]-[A-Za-z0-9-]{20,}\\b", "g"),
    replacement: "[REDACTED_SECRET:slack_token]",
  },
  {
    label: "bearer_token",
    regex: /Bearer\s+[A-Za-z0-9._~+/=-]{24,}/g,
    replacement: "Bearer [REDACTED_SECRET:bearer_token]",
  },
];

export function redactSecrets(input: string): RedactionResult {
  let content = input;
  const labels: string[] = [];

  for (const pattern of PATTERNS) {
    if (pattern.regex.test(content)) {
      labels.push(pattern.label);
      pattern.regex.lastIndex = 0;
      content = content.replace(pattern.regex, pattern.replacement);
    }
    pattern.regex.lastIndex = 0;
  }

  return {
    content,
    redacted: labels.length > 0,
    labels,
  };
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
deno test redact_test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add sofia/cloud/supabase/functions/sofia-core/redact.ts sofia/cloud/supabase/functions/sofia-core/redact_test.ts
git commit -m "sofia-cloud: add secret redaction for event ingestion"
```

---

## Task 5: Implement and test routing policy

**Files:**

- Create: `sofia/cloud/supabase/functions/sofia-core/router.ts`
- Create: `sofia/cloud/supabase/functions/sofia-core/router_test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { routeCandidate } from "./router.ts";
import type { CandidateInput } from "./types.ts";

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    candidate_type: "decision",
    candidate_text: "SOFIA should use Supabase as the first cloud runtime.",
    title: "Use Supabase first",
    worthiness_score: 0.9,
    confidence: 0.9,
    risk_level: "low",
    recommended_action: "auto_promote",
    reasoning: "Explicit durable architecture decision.",
    entities: [],
    metadata: {},
    ...overrides,
  };
}

Deno.test("routeCandidate auto-promotes high-confidence low-risk decisions", () => {
  const result = routeCandidate(candidate());
  assertEquals(result.shouldPromote, true);
  assertEquals(result.action, "auto_promote");
  assertEquals(result.status, "auto_promoted");
});

Deno.test("routeCandidate sends medium confidence to review", () => {
  const result = routeCandidate(candidate({ confidence: 0.7 }));
  assertEquals(result.shouldPromote, false);
  assertEquals(result.action, "review");
  assertEquals(result.status, "pending_review");
});

Deno.test("routeCandidate never auto-promotes person_context", () => {
  const result = routeCandidate(candidate({ candidate_type: "person_context", worthiness_score: 0.99, confidence: 0.99 }));
  assertEquals(result.shouldPromote, false);
  assertEquals(result.action, "review");
});

Deno.test("routeCandidate never auto-promotes redacted candidates", () => {
  const result = routeCandidate(candidate({ metadata: { redacted: true } }));
  assertEquals(result.shouldPromote, false);
  assertEquals(result.action, "review");
});

Deno.test("routeCandidate archives low-worthiness candidates", () => {
  const result = routeCandidate(candidate({ worthiness_score: 0.3, confidence: 0.9 }));
  assertEquals(result.shouldPromote, false);
  assertEquals(result.action, "archive");
  assertEquals(result.status, "archived");
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test router_test.ts
```

Expected: failure because `router.ts` does not exist.

- [ ] **Step 3: Implement `router.ts`**

```ts
import type { CandidateInput, RecommendedAction, RouteDecision } from "./types.ts";

const AUTO_THRESHOLDS: Record<string, number | null> = {
  fact: 0.85,
  preference: 0.8,
  decision: 0.85,
  lesson: 0.8,
  gotcha: 0.8,
  project_context: 0.85,
  person_context: null,
  operating_rule: 0.9,
  todo: null,
  open_loop: null,
};

const REVIEW_THRESHOLDS: Record<string, number> = {
  fact: 0.7,
  preference: 0.6,
  decision: 0.65,
  lesson: 0.6,
  gotcha: 0.6,
  project_context: 0.65,
  person_context: 0.7,
  operating_rule: 0.7,
  todo: 0.5,
  open_loop: 0.5,
};

export function routeCandidate(candidate: CandidateInput): RouteDecision {
  const redacted = candidate.metadata?.redacted === true;

  if (redacted) {
    return review("redacted content requires human review");
  }

  if (candidate.risk_level !== "low") {
    return review(`${candidate.risk_level} risk requires human review`);
  }

  if (candidate.worthiness_score < 0.5) {
    return {
      action: "archive",
      status: "archived",
      shouldPromote: false,
      reason: "worthiness score below archive threshold",
    };
  }

  const autoThreshold = AUTO_THRESHOLDS[candidate.candidate_type];
  if (
    autoThreshold !== null &&
    candidate.worthiness_score >= autoThreshold &&
    candidate.confidence >= 0.8 &&
    candidate.recommended_action === "auto_promote"
  ) {
    return {
      action: "auto_promote",
      status: "auto_promoted",
      shouldPromote: true,
      reason: `meets ${candidate.candidate_type} auto-promotion threshold`,
    };
  }

  const reviewThreshold = REVIEW_THRESHOLDS[candidate.candidate_type] ?? 0.7;
  if (candidate.worthiness_score >= reviewThreshold) {
    return review("candidate meets review threshold but not auto-promotion policy");
  }

  return {
    action: "archive",
    status: "archived",
    shouldPromote: false,
    reason: "candidate did not meet review threshold",
  };
}

function review(reason: string): RouteDecision {
  return {
    action: "review" satisfies RecommendedAction,
    status: "pending_review",
    shouldPromote: false,
    reason,
  };
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
deno test router_test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add sofia/cloud/supabase/functions/sofia-core/router.ts sofia/cloud/supabase/functions/sofia-core/router_test.ts
git commit -m "sofia-cloud: add hybrid memory candidate routing policy"
```

---

## Task 6: Implement classifier parser and LLM wrapper

**Files:**

- Create: `sofia/cloud/supabase/functions/sofia-core/classifier.ts`
- Create: `sofia/cloud/supabase/functions/sofia-core/classifier_test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseClassifierResponse } from "./classifier.ts";

Deno.test("parseClassifierResponse parses valid candidate JSON", () => {
  const parsed = parseClassifierResponse(JSON.stringify({
    candidates: [
      {
        candidate_type: "decision",
        candidate_text: "SOFIA should use Supabase first.",
        title: "Use Supabase first",
        worthiness_score: 0.91,
        confidence: 0.88,
        risk_level: "low",
        recommended_action: "auto_promote",
        reasoning: "Explicit durable decision.",
        entities: [{ type: "system", name: "SOFIA" }],
        metadata: { source_kind: "architecture" }
      }
    ]
  }));

  assertEquals(parsed.length, 1);
  assertEquals(parsed[0].candidate_type, "decision");
  assertEquals(parsed[0].worthiness_score, 0.91);
});

Deno.test("parseClassifierResponse rejects unknown candidate types", () => {
  assertRejects(
    async () => parseClassifierResponse(JSON.stringify({
      candidates: [{
        candidate_type: "vibe",
        candidate_text: "bad",
        title: "Bad",
        worthiness_score: 0.9,
        confidence: 0.9,
        risk_level: "low",
        recommended_action: "auto_promote",
        reasoning: "bad",
        entities: [],
        metadata: {}
      }]
    })),
    Error,
    "invalid classifier response",
  );
});

Deno.test("parseClassifierResponse clamps no numeric fields and rejects out-of-range values", () => {
  assertRejects(
    async () => parseClassifierResponse(JSON.stringify({
      candidates: [{
        candidate_type: "decision",
        candidate_text: "bad",
        title: "Bad",
        worthiness_score: 1.5,
        confidence: 0.9,
        risk_level: "low",
        recommended_action: "auto_promote",
        reasoning: "bad",
        entities: [],
        metadata: {}
      }]
    })),
    Error,
    "invalid classifier response",
  );
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test classifier_test.ts
```

Expected: failure because `classifier.ts` does not exist.

- [ ] **Step 3: Implement `classifier.ts`**

```ts
import { z } from "zod";
import type { CandidateInput, CaptureEventInput } from "./types.ts";

const CandidateSchema = z.object({
  candidate_type: z.enum([
    "fact",
    "preference",
    "decision",
    "lesson",
    "gotcha",
    "project_context",
    "person_context",
    "operating_rule",
    "todo",
    "open_loop",
  ]),
  candidate_text: z.string().min(1),
  title: z.string().min(1),
  worthiness_score: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  risk_level: z.enum(["low", "medium", "high"]),
  recommended_action: z.enum(["auto_promote", "review", "archive", "reject"]),
  reasoning: z.string().min(1),
  entities: z.array(z.object({
    type: z.string().min(1),
    name: z.string().min(1),
    evidence: z.string().optional(),
  })).default([]),
  metadata: z.record(z.unknown()).default({}),
});

const ClassifierResponseSchema = z.object({
  candidates: z.array(CandidateSchema),
});

export function parseClassifierResponse(raw: string): CandidateInput[] {
  try {
    const json = JSON.parse(raw);
    const parsed = ClassifierResponseSchema.parse(json);
    return parsed.candidates;
  } catch (error) {
    throw new Error(`invalid classifier response: ${String(error)}`);
  }
}

export async function classifyEvent(input: CaptureEventInput, apiKey: string): Promise<CandidateInput[]> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: `You are SOFIA's memory-worthiness classifier. Extract zero or more durable memory candidates from the user's event. Return only JSON with a top-level candidates array. Each candidate must include candidate_type, candidate_text, title, worthiness_score, confidence, risk_level, recommended_action, reasoning, entities, and metadata. Auto-promotion is only appropriate for explicit, low-risk, durable memories. Secrets, sensitive content, inferred identity claims, and person_context require review.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            context: input.context,
            source: input.source,
            type_hint: input.type_hint ?? null,
            metadata: input.metadata ?? {},
            content: input.content,
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`classifier request failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("classifier response missing message content");
  }
  return parseClassifierResponse(content);
}

export async function embedText(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`embedding request failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("embedding response missing vector");
  }
  return embedding.map(Number);
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
deno test classifier_test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add sofia/cloud/supabase/functions/sofia-core/classifier.ts sofia/cloud/supabase/functions/sofia-core/classifier_test.ts
git commit -m "sofia-cloud: add memory-worthiness classifier wrapper"
```

---

## Task 7: Add database helper functions

**Files:**

- Create: `sofia/cloud/supabase/functions/sofia-core/db.ts`

- [ ] **Step 1: Write `db.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CandidateInput, CaptureEventInput, CandidateStatus, EventSensitivity, MemoryType, RouteDecision } from "./types.ts";

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

export async function insertEvent(
  supabase: SupabaseClient,
  input: CaptureEventInput,
  content: string,
  sensitivity: EventSensitivity,
  embedding: number[] | null,
  redactionLabels: string[],
): Promise<string> {
  const { data, error } = await supabase
    .from("events")
    .insert({
      context: input.context,
      source: input.source,
      source_ref: input.source_ref ?? null,
      content,
      embedding,
      sensitivity,
      metadata: {
        ...(input.metadata ?? {}),
        type_hint: input.type_hint ?? null,
        redaction_labels: redactionLabels,
      },
    })
    .select("id")
    .single();

  if (error) throw new Error(`insert event failed: ${error.message}`);
  return data.id as string;
}

export async function insertCandidate(
  supabase: SupabaseClient,
  eventId: string,
  context: string,
  candidate: CandidateInput,
  route: RouteDecision,
): Promise<string> {
  const { data, error } = await supabase
    .from("memory_candidates")
    .insert({
      event_id: eventId,
      context,
      candidate_type: candidate.candidate_type,
      candidate_text: candidate.candidate_text,
      worthiness_score: candidate.worthiness_score,
      confidence: candidate.confidence,
      risk_level: candidate.risk_level,
      recommended_action: route.action,
      reasoning: `${candidate.reasoning}\n\nRouting: ${route.reason}`,
      status: route.status satisfies CandidateStatus,
      metadata: {
        ...candidate.metadata,
        title: candidate.title,
        entities: candidate.entities,
      },
    })
    .select("id")
    .single();

  if (error) throw new Error(`insert candidate failed: ${error.message}`);
  return data.id as string;
}

export async function promoteCandidate(
  supabase: SupabaseClient,
  candidateId: string,
  candidate: CandidateInput,
  embedding: number[] | null,
): Promise<string> {
  const memoryType = candidate.candidate_type as MemoryType;
  const { data: memory, error: memoryError } = await supabase
    .from("memories")
    .insert({
      context: candidate.metadata.context ?? "personal",
      memory_type: memoryType,
      title: candidate.title,
      body: candidate.candidate_text,
      embedding,
      confidence: candidate.confidence,
      status: "active",
      created_from_candidate_id: candidateId,
      current_version: 1,
      metadata: candidate.metadata,
    })
    .select("id")
    .single();

  if (memoryError) throw new Error(`promote memory failed: ${memoryError.message}`);

  const memoryId = memory.id as string;
  const { error: versionError } = await supabase.from("memory_versions").insert({
    memory_id: memoryId,
    version: 1,
    title: candidate.title,
    body: candidate.candidate_text,
    change_reason: "initial auto-promotion from memory candidate",
    created_by: "sofia-pipeline",
  });

  if (versionError) throw new Error(`insert memory version failed: ${versionError.message}`);
  return memoryId;
}
```

- [ ] **Step 2: Type-check**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno check db.ts
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add sofia/cloud/supabase/functions/sofia-core/db.ts
git commit -m "sofia-cloud: add database helper functions for events and memories"
```

---

## Task 8: Implement remote MCP server and capture pipeline

**Files:**

- Create: `sofia/cloud/supabase/functions/sofia-core/format.ts`
- Create: `sofia/cloud/supabase/functions/sofia-core/index.ts`

- [ ] **Step 1: Write `format.ts`**

```ts
export function textResponse(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    isError,
  };
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
```

- [ ] **Step 2: Write `index.ts`**

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { z } from "zod";
import { redactSecrets } from "./redact.ts";
import { classifyEvent, embedText } from "./classifier.ts";
import { routeCandidate } from "./router.ts";
import { createServiceClient, insertCandidate, insertEvent, promoteCandidate } from "./db.ts";
import { formatJson, textResponse } from "./format.ts";
import type { CaptureEventInput, SofiaContext } from "./types.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const supabase = createServiceClient();

const server = new McpServer({ name: "sofia-cloud", version: "0.1.0" });

server.registerTool(
  "capture_event",
  {
    title: "Capture SOFIA Event",
    description: "Capture raw material into SOFIA. The memory pipeline will redact secrets, extract memory candidates, auto-promote high-confidence low-risk memories, and queue uncertain candidates for review.",
    inputSchema: {
      content: z.string().min(1).describe("Raw content to capture"),
      context: z.enum(["personal", "work", "shared"]).default("personal"),
      source: z.string().default("mcp"),
      source_ref: z.string().optional(),
      type_hint: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (input) => {
    try {
      const capture = input as CaptureEventInput;
      const redacted = redactSecrets(capture.content);
      const eventEmbedding = redacted.redacted ? null : await embedText(redacted.content, OPENROUTER_API_KEY);
      const eventId = await insertEvent(
        supabase,
        capture,
        redacted.content,
        redacted.redacted ? "secret_redacted" : "normal",
        eventEmbedding,
        redacted.labels,
      );

      const classifierInput: CaptureEventInput = {
        ...capture,
        content: redacted.content,
        metadata: { ...(capture.metadata ?? {}), redacted: redacted.redacted },
      };
      const candidates = await classifyEvent(classifierInput, OPENROUTER_API_KEY);

      const results = [];
      for (const candidate of candidates) {
        candidate.metadata = { ...candidate.metadata, context: capture.context, redacted: redacted.redacted };
        const route = routeCandidate(candidate);
        const candidateId = await insertCandidate(supabase, eventId, capture.context, candidate, route);
        let memoryId: string | null = null;
        if (route.shouldPromote && candidate.candidate_type !== "todo" && candidate.candidate_type !== "open_loop") {
          const memoryEmbedding = await embedText(candidate.candidate_text, OPENROUTER_API_KEY);
          memoryId = await promoteCandidate(supabase, candidateId, candidate, memoryEmbedding);
        }
        results.push({ candidateId, memoryId, type: candidate.candidate_type, title: candidate.title, route });
      }

      return textResponse(formatJson({ eventId, redacted: redacted.redacted, candidates: results }));
    } catch (error) {
      return textResponse(`capture_event failed: ${(error as Error).message}`, true);
    }
  },
);

server.registerTool(
  "search_memory",
  {
    title: "Search SOFIA Memory",
    description: "Search promoted durable SOFIA memories by meaning.",
    inputSchema: {
      query: z.string().min(1),
      context: z.enum(["personal", "work", "shared", "both"]).default("both"),
      limit: z.number().int().min(1).max(20).default(10),
      threshold: z.number().min(0).max(1).default(0.5),
    },
  },
  async ({ query, context, limit, threshold }) => {
    try {
      const embedding = await embedText(query, OPENROUTER_API_KEY);
      const { data, error } = await supabase.rpc("match_memories", {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: limit,
        filter_context: context === "both" ? null : context,
        include_archived: false,
      });
      if (error) return textResponse(`search failed: ${error.message}`, true);
      return textResponse(formatJson(data ?? []));
    } catch (error) {
      return textResponse(`search_memory failed: ${(error as Error).message}`, true);
    }
  },
);

server.registerTool(
  "list_recent",
  {
    title: "List Recent SOFIA Items",
    description: "List recent events, candidates, or durable memories.",
    inputSchema: {
      kind: z.enum(["events", "candidates", "memories"]).default("memories"),
      context: z.enum(["personal", "work", "shared", "both"]).default("both"),
      limit: z.number().int().min(1).max(50).default(10),
    },
  },
  async ({ kind, context, limit }) => {
    const table = kind === "candidates" ? "memory_candidates" : kind;
    let query = supabase.from(table).select("*").order("created_at", { ascending: false }).limit(limit);
    if (context !== "both") query = query.eq("context", context as SofiaContext);
    const { data, error } = await query;
    if (error) return textResponse(`list_recent failed: ${error.message}`, true);
    return textResponse(formatJson(data ?? []));
  },
);

server.registerTool(
  "review_candidates",
  {
    title: "Review SOFIA Memory Candidates",
    description: "List or update memory candidates awaiting review.",
    inputSchema: {
      action: z.enum(["list", "approve", "reject", "archive"]).default("list"),
      candidate_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(20).default(10),
    },
  },
  async ({ action, candidate_id, limit }) => {
    if (action === "list") {
      const { data, error } = await supabase
        .from("memory_candidates")
        .select("*")
        .eq("status", "pending_review")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return textResponse(`review list failed: ${error.message}`, true);
      return textResponse(formatJson(data ?? []));
    }

    if (!candidate_id) return textResponse("candidate_id is required for approve/reject/archive", true);
    const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "archived";
    const { data, error } = await supabase
      .from("memory_candidates")
      .update({ status })
      .eq("id", candidate_id)
      .select("*")
      .single();
    if (error) return textResponse(`review update failed: ${error.message}`, true);
    return textResponse(formatJson(data));
  },
);

server.registerTool(
  "get_artifact",
  {
    title: "Get SOFIA Compiled Artifact",
    description: "Fetch a compiled artifact such as USER.md, SOUL.md, or context memory.",
    inputSchema: {
      artifact_name: z.string(),
      context: z.enum(["personal", "work", "shared"]).default("personal"),
    },
  },
  async ({ artifact_name, context }) => {
    const { data, error } = await supabase
      .from("compiled_artifacts")
      .select("content, generated_at, metadata")
      .eq("artifact_name", artifact_name)
      .eq("context", context)
      .maybeSingle();
    if (error) return textResponse(`get_artifact failed: ${error.message}`, true);
    if (!data) return textResponse(`No artifact found for ${context}/${artifact_name}`);
    return textResponse(data.content as string);
  },
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sofia-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();
app.options("*", (c) => c.text("ok", 200, corsHeaders));

app.all("*", async (c) => {
  const provided = c.req.header("x-sofia-key") || new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json({ error: "Invalid or missing SOFIA access key" }, 401, corsHeaders);
  }

  if (!c.req.header("accept")?.includes("text/event-stream")) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-ignore duplex is required for streaming body in Deno.
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
```

- [ ] **Step 3: Type-check**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno check index.ts
```

Expected: exit 0.

- [ ] **Step 4: Run all Deno tests**

```bash
deno test
```

Expected: redaction/router/classifier tests pass.

- [ ] **Step 5: Commit**

```bash
git add sofia/cloud/supabase/functions/sofia-core/format.ts sofia/cloud/supabase/functions/sofia-core/index.ts
git commit -m "sofia-cloud: add remote MCP server and synchronous capture pipeline"
```

---

## Task 9: Fix approval flow so `approve` promotes candidates

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/index.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/db.ts`

- [ ] **Step 1: Add `promoteExistingCandidate` to `db.ts`**

Append this function to `db.ts`:

```ts
export async function promoteExistingCandidate(
  supabase: SupabaseClient,
  candidateId: string,
  embedding: number[] | null,
): Promise<string> {
  const { data: candidate, error: candidateError } = await supabase
    .from("memory_candidates")
    .select("*")
    .eq("id", candidateId)
    .single();

  if (candidateError) throw new Error(`load candidate failed: ${candidateError.message}`);

  const candidateType = candidate.candidate_type as string;
  if (candidateType === "todo" || candidateType === "open_loop") {
    throw new Error(`${candidateType} candidates are not promoted to durable memories`);
  }

  const title = (candidate.metadata?.title as string | undefined) ?? candidateType;
  const { data: memory, error: memoryError } = await supabase
    .from("memories")
    .insert({
      context: candidate.context,
      memory_type: candidateType,
      title,
      body: candidate.candidate_text,
      embedding,
      confidence: candidate.confidence,
      status: "active",
      created_from_candidate_id: candidateId,
      current_version: 1,
      metadata: candidate.metadata ?? {},
    })
    .select("id")
    .single();

  if (memoryError) throw new Error(`promote existing candidate failed: ${memoryError.message}`);

  const memoryId = memory.id as string;
  const { error: versionError } = await supabase.from("memory_versions").insert({
    memory_id: memoryId,
    version: 1,
    title,
    body: candidate.candidate_text,
    change_reason: "human-approved promotion from review queue",
    created_by: "review_candidates",
  });

  if (versionError) throw new Error(`insert approved memory version failed: ${versionError.message}`);

  const { error: updateError } = await supabase
    .from("memory_candidates")
    .update({ status: "approved" })
    .eq("id", candidateId);

  if (updateError) throw new Error(`mark candidate approved failed: ${updateError.message}`);
  return memoryId;
}
```

- [ ] **Step 2: Modify `index.ts` import**

Change:

```ts
import { createServiceClient, insertCandidate, insertEvent, promoteCandidate } from "./db.ts";
```

To:

```ts
import { createServiceClient, insertCandidate, insertEvent, promoteCandidate, promoteExistingCandidate } from "./db.ts";
```

- [ ] **Step 3: Modify `review_candidates` approve branch**

In the `review_candidates` handler, replace the post-`candidate_id` update block with:

```ts
if (action === "approve") {
  const { data: candidate, error: loadError } = await supabase
    .from("memory_candidates")
    .select("candidate_text")
    .eq("id", candidate_id)
    .single();
  if (loadError) return textResponse(`load candidate failed: ${loadError.message}`, true);
  const embedding = await embedText(candidate.candidate_text as string, OPENROUTER_API_KEY);
  const memoryId = await promoteExistingCandidate(supabase, candidate_id, embedding);
  return textResponse(formatJson({ candidate_id, memoryId, status: "approved" }));
}

const status = action === "reject" ? "rejected" : "archived";
const { data, error } = await supabase
  .from("memory_candidates")
  .update({ status })
  .eq("id", candidate_id)
  .select("*")
  .single();
if (error) return textResponse(`review update failed: ${error.message}`, true);
return textResponse(formatJson(data));
```

- [ ] **Step 4: Type-check**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno check index.ts
```

Expected: exit 0.

- [ ] **Step 5: Run tests**

```bash
deno test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add sofia/cloud/supabase/functions/sofia-core/db.ts sofia/cloud/supabase/functions/sofia-core/index.ts
git commit -m "sofia-cloud: promote approved review candidates"
```

---

## Task 10: Account/deployment preflight

**Files:**

- No repository files changed.

- [ ] **Step 1: Create Supabase project**

Create a Supabase project named `sofia-cloud` in the nearest region.

Record these references in 1Password, not in repo files:

```text
Project ref
Project URL
Database password
MCP access key
OpenRouter API key
```

- [ ] **Step 2: Generate MCP access key**

```bash
openssl rand -hex 32
```

Expected: 64 hex characters.

- [ ] **Step 3: Link project**

From `/Users/justinramirez/dev/dotfiles`:

```bash
supabase link --project-ref <project-ref>
```

Expected: CLI prompts for DB password and completes linking.

- [ ] **Step 4: Set secrets**

```bash
supabase secrets set MCP_ACCESS_KEY=<generated-key>
supabase secrets set OPENROUTER_API_KEY=<openrouter-key>
```

Expected: both commands report success.

- [ ] **Step 5: No commit**

No files changed. Do not commit secrets.

---

## Task 11: Push schema and deploy Edge Function

**Files:**

- No repository files changed unless Supabase CLI creates local metadata. Review before commit.

- [ ] **Step 1: Push database schema**

```bash
supabase db push
```

Expected: migration `0001_sofia_cloud_core.sql` applies successfully.

- [ ] **Step 2: Deploy function**

```bash
supabase functions deploy sofia-core --no-verify-jwt --project-ref <project-ref>
```

Expected: function deploys successfully and appears in Supabase dashboard.

- [ ] **Step 3: Check deployed function list**

```bash
supabase functions list --project-ref <project-ref>
```

Expected: `sofia-core` listed as active.

- [ ] **Step 4: No commit unless Supabase created safe config files**

Run:

```bash
git status --short
```

If Supabase generated local config files, inspect them for secrets before committing.

---

## Task 12: End-to-end MCP smoke test

**Files:**

- No repository files changed.

- [ ] **Step 1: Build MCP URL**

```text
https://<project-ref>.supabase.co/functions/v1/sofia-core?key=<mcp-access-key>
```

- [ ] **Step 2: Connect in one AI client**

Use a remote MCP connector and paste the full URL with `?key=`.

- [ ] **Step 3: Capture explicit durable decision**

Prompt the AI client:

```text
Use SOFIA capture_event to save this: Decision: SOFIA Cloud should use Supabase/Postgres as the first cloud runtime because it gives us Postgres, pgvector, Edge Functions, secrets, and remote MCP patterns in one platform.
```

Expected:

- response includes an `eventId`
- at least one candidate
- likely auto-promotion if classifier confidence is high

- [ ] **Step 4: Search memory**

Prompt:

```text
Use SOFIA search_memory to find what I decided about Supabase.
```

Expected: returns the promoted memory or, if not auto-promoted, no durable memory yet.

- [ ] **Step 5: Review queue if needed**

Prompt:

```text
Use SOFIA review_candidates action=list.
```

If the Supabase decision is pending review, approve it:

```text
Use SOFIA review_candidates action=approve for candidate <candidate-id>.
```

Then rerun search.

---

## Task 13: Link implementation plan from roadmap

**Files:**

- Modify: `sofia/docs/plans/2026-05-01-sofia-cloud-roadmap.md`

- [ ] **Step 1: Add implementation link**

Under `## Design docs`, add:

```markdown
## Implementation plans

- [Phase 1–2 Implementation](2026-05-01-sofia-cloud-phase-1-2-implementation.md)
```

- [ ] **Step 2: Verify link target exists**

```bash
test -f sofia/docs/plans/2026-05-01-sofia-cloud-phase-1-2-implementation.md && echo ok
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add sofia/docs/plans/2026-05-01-sofia-cloud-roadmap.md sofia/docs/plans/2026-05-01-sofia-cloud-phase-1-2-implementation.md
git commit -m "sofia-cloud: add phase 1-2 implementation plan"
```

---

## Self-review checklist

- **Spec coverage:** Implements Cloud Core tables, Memory Pipeline redaction/classification/routing, and initial MCP capture/search/review tools.
- **Deferred intentionally:** chat adapters, compiled Obsidian exporter, graph/wiki compiler, importers.
- **Secret safety:** No secret values in files. Supabase secrets are runtime-only. Redaction runs before event insert.
- **Tool-count discipline:** MCP exposes five tools, not low-level CRUD.
- **Rollback:** Every promoted memory gets a `memory_versions` row.

## Execution options

Plan complete and saved to `sofia/docs/plans/2026-05-01-sofia-cloud-phase-1-2-implementation.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
