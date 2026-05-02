# SOFIA Memory Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SOFIA Cloud memory reconciliation so candidates are compared with active memories before promotion, allowing duplicates to be archived, safe updates to version existing memories, and ambiguous changes to go through review.

**Architecture:** Add a first-class reconciliation module, table, and DB helpers. The capture pipeline embeds candidates, retrieves related memories, runs structured reconciliation behind a feature flag, applies policy, persists audit state, and then promotes, archives, updates, or queues review. Existing candidate review remains the single review surface and learns to apply proposed updates.

**Tech Stack:** Supabase Postgres + pgvector migrations, Deno TypeScript Edge Function, MCP tools, OpenRouter chat/embeddings, existing `deno task test` and `deno task check`.

---

## File map

- Create `sofia/cloud/supabase/migrations/0002_memory_reconciliations.sql` — schema for reconciliation rows and supporting indexes/RLS policy.
- Create `sofia/cloud/supabase/functions/sofia-core/reconcile.ts` — relationship parsing, deterministic action mapping, policy decisions, and structured reconciler prompt/parser.
- Create `sofia/cloud/supabase/functions/sofia-core/reconcile_test.ts` — unit tests for parser, mapping, policy, and fallback decisions.
- Modify `sofia/cloud/supabase/functions/sofia-core/types.ts` — reconciliation relationship/action/status/result types and similar memory DTO.
- Modify `sofia/cloud/supabase/functions/sofia-core/db.ts` — related-memory search, reconciliation persistence, candidate archiving, memory version update, review approval behavior.
- Modify `sofia/cloud/supabase/functions/sofia-core/db_test.ts` — fake Supabase coverage for versioning and reconciliation-aware review approval.
- Modify `sofia/cloud/supabase/functions/sofia-core/index.ts` — feature-flagged capture flow and review/list output integration.
- Modify `sofia/cloud/supabase/functions/sofia-core/deno.json` only if a new task alias is needed; otherwise leave unchanged.
- Modify `sofia/cloud/README.md` — document the feature flag and reconciliation review behavior.

---

## Task 1: Add reconciliation schema

**Files:**

- Create: `sofia/cloud/supabase/migrations/0002_memory_reconciliations.sql`

- [ ] **Step 1: Create the migration**

Create `sofia/cloud/supabase/migrations/0002_memory_reconciliations.sql` with:

```sql
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
```

- [ ] **Step 2: Verify migration syntax locally**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno task check
```

Expected: `Check index.ts` and exit 0. This does not apply SQL, but verifies the Edge Function still checks before DB code changes.

- [ ] **Step 3: Commit schema**

```bash
git add sofia/cloud/supabase/migrations/0002_memory_reconciliations.sql
git commit -m "Add memory reconciliation schema"
```

---

## Task 2: Define reconciliation types and pure policy engine

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/types.ts`
- Create: `sofia/cloud/supabase/functions/sofia-core/reconcile.ts`
- Create: `sofia/cloud/supabase/functions/sofia-core/reconcile_test.ts`

- [ ] **Step 1: Add failing type/policy tests**

Create `sofia/cloud/supabase/functions/sofia-core/reconcile_test.ts`:

```ts
import assert from "node:assert/strict";
import {
  applyReconciliationPolicy,
  mapRelationshipToAction,
  parseReconcilerResponse,
} from "./reconcile.ts";
import type { CandidateInput, ReconciliationJudgment } from "./types.ts";

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    candidate_type: "preference",
    candidate_text:
      "Justin prefers direct local merge after verification when solo.",
    title: "Justin merge preference",
    worthiness_score: 0.9,
    confidence: 0.9,
    risk_level: "low",
    recommended_action: "auto_promote",
    reasoning: "Durable workflow preference.",
    entities: [],
    metadata: {},
    ...overrides,
  };
}

function judgment(
  overrides: Partial<ReconciliationJudgment> = {},
): ReconciliationJudgment {
  return {
    relationship: "updates_existing",
    target_memory_id: "11111111-1111-1111-1111-111111111111",
    related_memory_ids: ["11111111-1111-1111-1111-111111111111"],
    proposed_title: "Justin workflow preference",
    proposed_body:
      "Justin prefers direct local merge after verification when solo.",
    confidence: 0.94,
    rationale: "Candidate refines an existing workflow preference.",
    ...overrides,
  };
}

Deno.test("mapRelationshipToAction maps duplicates to archive", () => {
  assert.equal(mapRelationshipToAction("exact_duplicate"), "archive_duplicate");
  assert.equal(mapRelationshipToAction("same_fact"), "archive_duplicate");
});

Deno.test("mapRelationshipToAction maps updates and conflicts", () => {
  assert.equal(mapRelationshipToAction("new_memory"), "promote_new");
  assert.equal(mapRelationshipToAction("updates_existing"), "review_update");
  assert.equal(mapRelationshipToAction("refinement"), "review_update");
  assert.equal(
    mapRelationshipToAction("contradicts_existing"),
    "review_conflict",
  );
  assert.equal(mapRelationshipToAction("merge_with_existing"), "review_merge");
  assert.equal(mapRelationshipToAction("uncertain"), "review_update");
});

Deno.test("policy auto-applies safe high-confidence preference updates", () => {
  const result = applyReconciliationPolicy(candidate(), judgment());
  assert.equal(result.action, "update_existing");
  assert.equal(result.status, "auto_applied");
  assert.match(result.policy_reason, /safe high-confidence update/);
});

Deno.test("policy requires review for financial or property details", () => {
  const result = applyReconciliationPolicy(
    candidate({
      candidate_type: "fact",
      candidate_text: "Brookdale loan balance is about $110k.",
      title: "Brookdale loan balance",
    }),
    judgment({ confidence: 0.98 }),
  );
  assert.equal(result.action, "review_update");
  assert.equal(result.status, "pending_review");
  assert.match(result.policy_reason, /sensitive domain/);
});

Deno.test("policy requires review for person context", () => {
  const result = applyReconciliationPolicy(
    candidate({ candidate_type: "person_context" }),
    judgment({ confidence: 0.99 }),
  );
  assert.equal(result.action, "review_update");
  assert.equal(result.status, "pending_review");
});

Deno.test("policy archives exact duplicates", () => {
  const result = applyReconciliationPolicy(
    candidate(),
    judgment({ relationship: "exact_duplicate", confidence: 0.96 }),
  );
  assert.equal(result.action, "archive_duplicate");
  assert.equal(result.status, "auto_applied");
});

Deno.test("parseReconcilerResponse parses strict JSON", () => {
  const parsed = parseReconcilerResponse(
    JSON.stringify({
      relationship: "same_fact",
      target_memory_id: "11111111-1111-1111-1111-111111111111",
      related_memory_ids: ["11111111-1111-1111-1111-111111111111"],
      confidence: 0.93,
      rationale: "No meaningful change.",
    }),
  );
  assert.equal(parsed.relationship, "same_fact");
  assert.equal(parsed.confidence, 0.93);
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test reconcile_test.ts
```

Expected: FAIL because `reconcile.ts` and reconciliation types do not exist.

- [ ] **Step 3: Add reconciliation types**

Append these exports to `sofia/cloud/supabase/functions/sofia-core/types.ts`:

```ts
export type ReconciliationRelationship =
  | "new_memory"
  | "exact_duplicate"
  | "same_fact"
  | "refinement"
  | "updates_existing"
  | "contradicts_existing"
  | "merge_with_existing"
  | "uncertain";

export type ReconciliationAction =
  | "promote_new"
  | "archive_duplicate"
  | "update_existing"
  | "review_update"
  | "review_merge"
  | "review_conflict";

export type ReconciliationStatus =
  | "auto_applied"
  | "pending_review"
  | "approved"
  | "rejected"
  | "archived";

export type SimilarMemory = {
  id: string;
  context: SofiaContext;
  memory_type: MemoryType;
  title: string;
  body: string;
  similarity: number;
  created_at?: string;
};

export type ReconciliationJudgment = {
  relationship: ReconciliationRelationship;
  target_memory_id?: string;
  related_memory_ids: string[];
  proposed_title?: string;
  proposed_body?: string;
  confidence: number;
  rationale: string;
};

export type ReconciliationDecision = {
  action: ReconciliationAction;
  status: ReconciliationStatus;
  target_memory_id?: string;
  related_memory_ids: string[];
  proposed_title?: string;
  proposed_body?: string;
  confidence: number;
  rationale: string;
  policy_reason: string;
  metadata: Record<string, unknown>;
};
```

- [ ] **Step 4: Implement pure reconciliation policy**

Create `sofia/cloud/supabase/functions/sofia-core/reconcile.ts`:

```ts
import { z } from "zod";
import type {
  CandidateInput,
  ReconciliationAction,
  ReconciliationDecision,
  ReconciliationJudgment,
  ReconciliationRelationship,
  ReconciliationStatus,
} from "./types.ts";

const HIGH_CONFIDENCE_UPDATE = 0.92;
const SAFE_UPDATE_TYPES = new Set([
  "preference",
  "operating_rule",
  "lesson",
  "gotcha",
  "project_context",
]);
const SENSITIVE_PATTERN =
  /\b(loan|mortgage|balance|rate|offer|closing|property|address|family|son|partner|medical|doctor|legal|lawyer|bank|salary|compensation|tax|hoa|\$\d+)/i;

const ReconcilerSchema = z.object({
  relationship: z.enum([
    "new_memory",
    "exact_duplicate",
    "same_fact",
    "refinement",
    "updates_existing",
    "contradicts_existing",
    "merge_with_existing",
    "uncertain",
  ]),
  target_memory_id: z.string().uuid().optional(),
  related_memory_ids: z.array(z.string().uuid()).default([]),
  proposed_title: z.string().optional(),
  proposed_body: z.string().optional(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export function parseReconcilerResponse(raw: string): ReconciliationJudgment {
  const parsed = JSON.parse(raw);
  return ReconcilerSchema.parse(parsed);
}

export function mapRelationshipToAction(
  relationship: ReconciliationRelationship,
): ReconciliationAction {
  switch (relationship) {
    case "new_memory":
      return "promote_new";
    case "exact_duplicate":
    case "same_fact":
      return "archive_duplicate";
    case "contradicts_existing":
      return "review_conflict";
    case "merge_with_existing":
      return "review_merge";
    case "refinement":
    case "updates_existing":
    case "uncertain":
      return "review_update";
  }
}

export function applyReconciliationPolicy(
  candidate: CandidateInput,
  judgment: ReconciliationJudgment,
): ReconciliationDecision {
  const baseAction = mapRelationshipToAction(judgment.relationship);
  const relatedIds =
    judgment.related_memory_ids.length > 0
      ? judgment.related_memory_ids
      : judgment.target_memory_id
        ? [judgment.target_memory_id]
        : [];

  if (baseAction === "promote_new") {
    return decision(
      "promote_new",
      "auto_applied",
      candidate,
      judgment,
      relatedIds,
      "reconciler found no related active memory",
    );
  }

  if (baseAction === "archive_duplicate") {
    return decision(
      "archive_duplicate",
      "auto_applied",
      candidate,
      judgment,
      relatedIds,
      "duplicate or same-fact candidate does not need a new memory",
    );
  }

  if (baseAction === "review_conflict" || baseAction === "review_merge") {
    return decision(
      baseAction,
      "pending_review",
      candidate,
      judgment,
      relatedIds,
      "conflicts and broad merges require review",
    );
  }

  if (candidate.metadata?.redacted === true) {
    return decision(
      "review_update",
      "pending_review",
      candidate,
      judgment,
      relatedIds,
      "redacted candidate requires review",
    );
  }

  if (candidate.risk_level !== "low") {
    return decision(
      "review_update",
      "pending_review",
      candidate,
      judgment,
      relatedIds,
      `${candidate.risk_level} risk candidate requires review`,
    );
  }

  if (candidate.candidate_type === "person_context") {
    return decision(
      "review_update",
      "pending_review",
      candidate,
      judgment,
      relatedIds,
      "person context updates require review",
    );
  }

  if (isSensitiveDomain(candidate)) {
    return decision(
      "review_update",
      "pending_review",
      candidate,
      judgment,
      relatedIds,
      "sensitive domain updates require review",
    );
  }

  if (!SAFE_UPDATE_TYPES.has(candidate.candidate_type)) {
    return decision(
      "review_update",
      "pending_review",
      candidate,
      judgment,
      relatedIds,
      `${candidate.candidate_type} updates require review`,
    );
  }

  if (!judgment.target_memory_id) {
    return decision(
      "review_update",
      "pending_review",
      candidate,
      judgment,
      relatedIds,
      "update relationship did not identify a target memory",
    );
  }

  if (judgment.confidence < HIGH_CONFIDENCE_UPDATE) {
    return decision(
      "review_update",
      "pending_review",
      candidate,
      judgment,
      relatedIds,
      "reconciliation confidence below auto-update threshold",
    );
  }

  return decision(
    "update_existing",
    "auto_applied",
    candidate,
    judgment,
    relatedIds,
    "safe high-confidence update may be applied automatically",
  );
}

function isSensitiveDomain(candidate: CandidateInput): boolean {
  const text = `${candidate.title}\n${candidate.candidate_text}`;
  if (SENSITIVE_PATTERN.test(text)) return true;
  return candidate.entities.some(
    (entity) =>
      ["person", "place"].includes(entity.type.toLowerCase()) &&
      /family|son|partner|address|property/i.test(
        `${entity.name} ${entity.evidence ?? ""}`,
      ),
  );
}

function decision(
  action: ReconciliationAction,
  status: ReconciliationStatus,
  candidate: CandidateInput,
  judgment: ReconciliationJudgment,
  relatedMemoryIds: string[],
  policyReason: string,
): ReconciliationDecision {
  return {
    action,
    status,
    target_memory_id: judgment.target_memory_id,
    related_memory_ids: relatedMemoryIds,
    proposed_title: judgment.proposed_title ?? candidate.title,
    proposed_body: judgment.proposed_body ?? candidate.candidate_text,
    confidence: judgment.confidence,
    rationale: judgment.rationale,
    policy_reason: policyReason,
    metadata: { relationship: judgment.relationship },
  };
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test reconcile_test.ts
```

Expected: all tests in `reconcile_test.ts` pass.

- [ ] **Step 6: Commit pure reconciliation engine**

```bash
git add sofia/cloud/supabase/functions/sofia-core/types.ts \
  sofia/cloud/supabase/functions/sofia-core/reconcile.ts \
  sofia/cloud/supabase/functions/sofia-core/reconcile_test.ts
git commit -m "Add SOFIA reconciliation policy engine"
```

---

## Task 3: Add DB helpers for reconciliation persistence and memory versioning

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/db.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/db_test.ts`

- [ ] **Step 1: Add failing DB tests**

Append to `sofia/cloud/supabase/functions/sofia-core/db_test.ts`:

```ts
import {
  applyMemoryUpdateFromReconciliation,
  insertReconciliation,
  markCandidateArchived,
} from "./db.ts";

Deno.test("insertReconciliation stores decision audit row", async () => {
  const client = fakeSupabase({ id: "reconciliation-1" });

  const id = await insertReconciliation(
    client as never,
    "candidate-1",
    "personal",
    {
      action: "archive_duplicate",
      status: "auto_applied",
      target_memory_id: "memory-1",
      related_memory_ids: ["memory-1"],
      proposed_title: "Merge preference",
      proposed_body:
        "Justin prefers direct local merge after verification when solo.",
      confidence: 0.96,
      rationale: "Same fact.",
      policy_reason:
        "duplicate or same-fact candidate does not need a new memory",
      metadata: { relationship: "same_fact" },
    },
  );

  assert.equal(id, "reconciliation-1");
  assert.deepEqual(client.calls[0], {
    table: "memory_reconciliations",
    operation: "insert",
    payload: {
      candidate_id: "candidate-1",
      context: "personal",
      action: "archive_duplicate",
      status: "auto_applied",
      target_memory_id: "memory-1",
      related_memory_ids: ["memory-1"],
      proposed_title: "Merge preference",
      proposed_body:
        "Justin prefers direct local merge after verification when solo.",
      confidence: 0.96,
      rationale: "Same fact.",
      policy_reason:
        "duplicate or same-fact candidate does not need a new memory",
      metadata: { relationship: "same_fact" },
    },
  });
});

Deno.test(
  "markCandidateArchived archives candidate with reconciliation reason",
  async () => {
    const client = fakeSupabase({ id: "candidate-1" });

    await markCandidateArchived(
      client as never,
      "candidate-1",
      "duplicate of active memory memory-1",
    );

    assert.deepEqual(client.calls, [
      {
        table: "memory_candidates",
        operation: "update",
        payload: {
          status: "archived",
          metadata: { archive_reason: "duplicate of active memory memory-1" },
        },
      },
    ]);
  },
);

Deno.test(
  "applyMemoryUpdateFromReconciliation versions an existing memory",
  async () => {
    const client = fakeSupabase({
      id: "memory-1",
      title: "Old title",
      body: "Old body",
      confidence: 0.8,
      current_version: 1,
      metadata: { existing: true },
    });

    await applyMemoryUpdateFromReconciliation(client as never, {
      candidateId: "candidate-1",
      reconciliationId: "reconciliation-1",
      targetMemoryId: "memory-1",
      title: "New title",
      body: "New body",
      confidence: 0.94,
      changeReason: "reconciliation auto-update: safe high-confidence update",
      status: "auto_applied",
    });

    assert.deepEqual(client.calls, [
      {
        table: "memories",
        operation: "update",
        payload: {
          title: "New title",
          body: "New body",
          confidence: 0.94,
          current_version: 2,
          metadata: {
            existing: true,
            updated_by: "memory_reconciliation",
            reconciliation_id: "reconciliation-1",
          },
        },
      },
      {
        table: "memory_versions",
        operation: "insert",
        payload: {
          memory_id: "memory-1",
          version: 2,
          title: "New title",
          body: "New body",
          change_reason:
            "reconciliation auto-update: safe high-confidence update",
          created_by: "memory_reconciliation",
        },
      },
      {
        table: "memory_candidates",
        operation: "update",
        payload: { status: "approved" },
      },
      {
        table: "memory_reconciliations",
        operation: "update",
        payload: { status: "auto_applied" },
      },
    ]);
  },
);
```

- [ ] **Step 2: Run failing DB tests**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test db_test.ts
```

Expected: FAIL because the new DB helper exports do not exist.

- [ ] **Step 3: Update the fake Supabase helper if needed**

Modify `fakeSupabase` in `db_test.ts` so `.single()` returns IDs for reconciliation inserts and memory loads. Replace the existing `single()` body with:

```ts
async single() {
  if (table === "memory_candidates") return { data: record, error: null };
  if (table === "memory_reconciliations" && operation === "insert") {
    return { data: { id: "reconciliation-1" }, error: null };
  }
  if (table === "memories" && operation === "insert") {
    return { data: { id: "memory-1" }, error: null };
  }
  if (table === "memories") {
    return { data: { id: "memory-1", ...record }, error: null };
  }
  return { data: record, error: null };
}
```

- [ ] **Step 4: Implement DB helpers**

Add imports to `db.ts`:

```ts
import type { ReconciliationDecision, SimilarMemory } from "./types.ts";
```

Add these functions to `db.ts`:

```ts
export async function findSimilarMemories(
  supabase: SupabaseClient,
  embedding: number[],
  context: SofiaContext,
  limit = 5,
  threshold = 0.72,
): Promise<SimilarMemory[]> {
  const contexts = context === "shared" ? ["shared"] : [context, "shared"];
  const results: SimilarMemory[] = [];

  for (const searchContext of contexts) {
    const { data, error } = await supabase.rpc("match_memories", {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit,
      filter_context: searchContext,
      include_archived: false,
    });
    if (error)
      throw new Error(`find similar memories failed: ${error.message}`);
    results.push(...((data ?? []) as SimilarMemory[]));
  }

  const byId = new Map<string, SimilarMemory>();
  for (const memory of results) {
    const existing = byId.get(memory.id);
    if (!existing || memory.similarity > existing.similarity)
      byId.set(memory.id, memory);
  }
  return [...byId.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export async function insertReconciliation(
  supabase: SupabaseClient,
  candidateId: string,
  context: SofiaContext,
  decision: ReconciliationDecision,
): Promise<string> {
  const { data, error } = await supabase
    .from("memory_reconciliations")
    .insert({
      candidate_id: candidateId,
      context,
      action: decision.action,
      status: decision.status,
      target_memory_id: decision.target_memory_id ?? null,
      related_memory_ids: decision.related_memory_ids,
      proposed_title: decision.proposed_title ?? null,
      proposed_body: decision.proposed_body ?? null,
      confidence: decision.confidence,
      rationale: decision.rationale,
      policy_reason: decision.policy_reason,
      metadata: decision.metadata,
    })
    .select("id")
    .single();

  if (error) throw new Error(`insert reconciliation failed: ${error.message}`);
  return data.id as string;
}

export async function markCandidateArchived(
  supabase: SupabaseClient,
  candidateId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("memory_candidates")
    .update({ status: "archived", metadata: { archive_reason: reason } })
    .eq("id", candidateId);
  if (error) throw new Error(`archive candidate failed: ${error.message}`);
}

export async function applyMemoryUpdateFromReconciliation(
  supabase: SupabaseClient,
  input: {
    candidateId: string;
    reconciliationId: string;
    targetMemoryId: string;
    title: string;
    body: string;
    confidence: number;
    changeReason: string;
    status: "auto_applied" | "approved";
  },
): Promise<string> {
  const { data: memory, error: loadError } = await supabase
    .from("memories")
    .select("id, current_version, metadata")
    .eq("id", input.targetMemoryId)
    .single();
  if (loadError)
    throw new Error(`load target memory failed: ${loadError.message}`);

  const nextVersion = ((memory.current_version as number | null) ?? 1) + 1;
  const metadata = {
    ...((memory.metadata as Record<string, unknown> | null) ?? {}),
    updated_by: "memory_reconciliation",
    reconciliation_id: input.reconciliationId,
  };

  const { error: updateError } = await supabase
    .from("memories")
    .update({
      title: input.title,
      body: input.body,
      confidence: input.confidence,
      current_version: nextVersion,
      metadata,
    })
    .eq("id", input.targetMemoryId);
  if (updateError)
    throw new Error(`update memory failed: ${updateError.message}`);

  const { error: versionError } = await supabase
    .from("memory_versions")
    .insert({
      memory_id: input.targetMemoryId,
      version: nextVersion,
      title: input.title,
      body: input.body,
      change_reason: input.changeReason,
      created_by: "memory_reconciliation",
    });
  if (versionError)
    throw new Error(`insert memory version failed: ${versionError.message}`);

  const { error: candidateError } = await supabase
    .from("memory_candidates")
    .update({ status: "approved" })
    .eq("id", input.candidateId);
  if (candidateError)
    throw new Error(
      `mark candidate approved failed: ${candidateError.message}`,
    );

  const { error: reconciliationError } = await supabase
    .from("memory_reconciliations")
    .update({ status: input.status })
    .eq("id", input.reconciliationId);
  if (reconciliationError)
    throw new Error(
      `mark reconciliation applied failed: ${reconciliationError.message}`,
    );

  return input.targetMemoryId;
}
```

- [ ] **Step 5: Run DB tests**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test db_test.ts
```

Expected: all DB tests pass.

- [ ] **Step 6: Commit DB helpers**

```bash
git add sofia/cloud/supabase/functions/sofia-core/db.ts \
  sofia/cloud/supabase/functions/sofia-core/db_test.ts
git commit -m "Add reconciliation database helpers"
```

---

## Task 4: Add structured LLM reconciler and fallback behavior

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/reconcile.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/reconcile_test.ts`

- [ ] **Step 1: Add prompt-building test**

Append to `reconcile_test.ts`:

```ts
import {
  buildReconcilerPrompt,
  fallbackReconciliationDecision,
} from "./reconcile.ts";

Deno.test("buildReconcilerPrompt includes candidate and memory IDs", () => {
  const prompt = buildReconcilerPrompt(candidate(), [
    {
      id: "11111111-1111-1111-1111-111111111111",
      context: "personal",
      memory_type: "preference",
      title: "Existing merge preference",
      body: "Justin prefers direct local merge when solo.",
      similarity: 0.91,
    },
  ]);

  assert.match(prompt, /Existing merge preference/);
  assert.match(prompt, /11111111-1111-1111-1111-111111111111/);
  assert.match(prompt, /strict JSON/);
});

Deno.test(
  "fallbackReconciliationDecision routes expected auto-promotion to review",
  () => {
    const result = fallbackReconciliationDecision(candidate(), "model timeout");
    assert.equal(result.action, "review_update");
    assert.equal(result.status, "pending_review");
    assert.match(result.policy_reason, /reconciliation failed/);
    assert.equal(result.metadata.reconciliation_error, "model timeout");
  },
);
```

- [ ] **Step 2: Run failing tests**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test reconcile_test.ts
```

Expected: FAIL because `buildReconcilerPrompt` and `fallbackReconciliationDecision` are missing.

- [ ] **Step 3: Implement prompt and fallback**

Add to `reconcile.ts`:

```ts
import type { SimilarMemory } from "./types.ts";

export function buildReconcilerPrompt(
  candidate: CandidateInput,
  memories: SimilarMemory[],
): string {
  return `You are SOFIA's memory reconciliation engine.

Decide how a new memory candidate relates to existing active memories. Return strict JSON only. Do not include markdown.

Allowed relationship values:
- new_memory
- exact_duplicate
- same_fact
- refinement
- updates_existing
- contradicts_existing
- merge_with_existing
- uncertain

Candidate:
${JSON.stringify(
  {
    type: candidate.candidate_type,
    title: candidate.title,
    body: candidate.candidate_text,
    entities: candidate.entities,
  },
  null,
  2,
)}

Existing active memories:
${JSON.stringify(
  memories.map((memory) => ({
    id: memory.id,
    context: memory.context,
    type: memory.memory_type,
    title: memory.title,
    body: memory.body,
    similarity: memory.similarity,
  })),
  null,
  2,
)}

Return this JSON shape:
{
  "relationship": "new_memory",
  "target_memory_id": "uuid when one primary target exists",
  "related_memory_ids": ["uuids"],
  "proposed_title": "title for updates or merges",
  "proposed_body": "body for updates or merges",
  "confidence": 0.0,
  "rationale": "brief explanation"
}`;
}

export function fallbackReconciliationDecision(
  candidate: CandidateInput,
  errorMessage: string,
): ReconciliationDecision {
  return {
    action: "review_update",
    status: "pending_review",
    related_memory_ids: [],
    proposed_title: candidate.title,
    proposed_body: candidate.candidate_text,
    confidence: 0,
    rationale: "Reconciliation failed before a safe decision could be made.",
    policy_reason: "reconciliation failed; candidate requires review",
    metadata: { reconciliation_error: errorMessage },
  };
}
```

- [ ] **Step 4: Implement LLM call**

Add this function to `reconcile.ts`:

```ts
export async function judgeReconciliation(
  candidate: CandidateInput,
  memories: SimilarMemory[],
  apiKey: string,
): Promise<ReconciliationJudgment> {
  if (memories.length === 0) {
    return {
      relationship: "new_memory",
      related_memory_ids: [],
      confidence: 1,
      rationale: "No similar active memories were retrieved.",
    };
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1-mini",
        messages: [
          { role: "user", content: buildReconcilerPrompt(candidate, memories) },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`reconciler request failed: ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string")
    throw new Error("reconciler returned no content");
  return parseReconcilerResponse(content);
}
```

- [ ] **Step 5: Run reconciliation tests**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test reconcile_test.ts
```

Expected: all reconciliation tests pass. No network call should run in these tests.

- [ ] **Step 6: Commit LLM reconciler support**

```bash
git add sofia/cloud/supabase/functions/sofia-core/reconcile.ts \
  sofia/cloud/supabase/functions/sofia-core/reconcile_test.ts
git commit -m "Add structured memory reconciler"
```

---

## Task 5: Integrate reconciliation into capture flow behind feature flag

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/index.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/db.ts` if helper signatures need adjustment

- [ ] **Step 1: Add imports and feature flag**

In `index.ts`, extend DB imports:

```ts
import {
  applyMemoryUpdateFromReconciliation,
  archiveMemory,
  createServiceClient,
  findSimilarMemories,
  insertCandidate,
  insertEvent,
  insertReconciliation,
  markCandidateArchived,
  promoteCandidate,
  promoteExistingCandidate,
} from "./db.ts";
```

Add reconciliation imports:

```ts
import {
  applyReconciliationPolicy,
  fallbackReconciliationDecision,
  judgeReconciliation,
} from "./reconcile.ts";
```

Add near env constants:

```ts
const RECONCILIATION_ENABLED =
  Deno.env.get("SOFIA_RECONCILIATION_ENABLED") === "true";
```

- [ ] **Step 2: Replace promotion block in capture loop**

In `capture_event`, replace the existing block that embeds and promotes when `route.shouldPromote` with this structure:

```ts
let memoryId: string | null = null;
let reconciliation: Record<string, unknown> | null = null;
const canBecomeMemory =
  candidate.candidate_type !== "todo" &&
  candidate.candidate_type !== "open_loop";

if (
  canBecomeMemory &&
  (route.shouldPromote || route.status === "pending_review")
) {
  const memoryEmbedding = await embedText(
    candidate.candidate_text,
    OPENROUTER_API_KEY,
  );

  if (RECONCILIATION_ENABLED) {
    let decision;
    try {
      const similarMemories = await findSimilarMemories(
        supabase,
        memoryEmbedding,
        capture.context,
      );
      const judgment = await judgeReconciliation(
        candidate,
        similarMemories,
        OPENROUTER_API_KEY,
      );
      decision = applyReconciliationPolicy(candidate, judgment);
    } catch (error) {
      decision = fallbackReconciliationDecision(
        candidate,
        (error as Error).message,
      );
    }

    const reconciliationId = await insertReconciliation(
      supabase,
      candidateId,
      capture.context,
      decision,
    );
    reconciliation = { id: reconciliationId, ...decision };

    if (decision.action === "promote_new" && route.shouldPromote) {
      memoryId = await promoteCandidate(
        supabase,
        candidateId,
        capture.context,
        candidate,
        memoryEmbedding,
      );
    } else if (decision.action === "archive_duplicate") {
      await markCandidateArchived(
        supabase,
        candidateId,
        `duplicate/same-fact reconciliation with ${decision.target_memory_id ?? "active memory"}`,
      );
    } else if (
      decision.action === "update_existing" &&
      decision.target_memory_id
    ) {
      memoryId = await applyMemoryUpdateFromReconciliation(supabase, {
        candidateId,
        reconciliationId,
        targetMemoryId: decision.target_memory_id,
        title: decision.proposed_title ?? candidate.title,
        body: decision.proposed_body ?? candidate.candidate_text,
        confidence: Math.max(candidate.confidence, decision.confidence),
        changeReason: `reconciliation auto-update: ${decision.policy_reason}`,
        status: "auto_applied",
      });
    }
  } else if (route.shouldPromote) {
    memoryId = await promoteCandidate(
      supabase,
      candidateId,
      capture.context,
      candidate,
      memoryEmbedding,
    );
  }
}
```

Keep the existing `results.push`, but add reconciliation:

```ts
results.push({
  candidateId,
  memoryId,
  type: candidate.candidate_type,
  title: candidate.title,
  route,
  reconciliation,
});
```

- [ ] **Step 3: Run full tests**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno task test
deno task check
```

Expected: all tests pass and `deno check index.ts` succeeds.

- [ ] **Step 4: Commit feature-flagged capture integration**

```bash
git add sofia/cloud/supabase/functions/sofia-core/index.ts \
  sofia/cloud/supabase/functions/sofia-core/db.ts
git commit -m "Integrate reconciliation into capture flow"
```

---

## Task 6: Make review approval reconciliation-aware

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/db.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/index.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/db_test.ts`

- [ ] **Step 1: Add DB helper to load pending reconciliation**

Add to `db.ts`:

```ts
export async function getPendingReconciliationForCandidate(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("memory_reconciliations")
    .select("*")
    .eq("candidate_id", candidateId)
    .eq("status", "pending_review")
    .maybeSingle();

  if (error) throw new Error(`load reconciliation failed: ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
}

export async function markReconciliationStatus(
  supabase: SupabaseClient,
  reconciliationId: string,
  status: "approved" | "rejected" | "archived",
): Promise<void> {
  const { error } = await supabase
    .from("memory_reconciliations")
    .update({ status })
    .eq("id", reconciliationId);
  if (error) throw new Error(`update reconciliation failed: ${error.message}`);
}
```

If the fake Supabase helper lacks `maybeSingle`, add:

```ts
async maybeSingle() {
  return { data: record, error: null };
}
```

- [ ] **Step 2: Update review approval flow**

In the `review_candidates` approve branch in `index.ts`, after loading candidate text and before `promoteExistingCandidate`, load reconciliation:

```ts
const reconciliation = await getPendingReconciliationForCandidate(
  supabase,
  candidate_id,
);

if (
  reconciliation?.action === "review_update" &&
  reconciliation.target_memory_id
) {
  const memoryId = await applyMemoryUpdateFromReconciliation(supabase, {
    candidateId: candidate_id,
    reconciliationId: reconciliation.id as string,
    targetMemoryId: reconciliation.target_memory_id as string,
    title: (reconciliation.proposed_title as string | null) ?? "Updated memory",
    body:
      (reconciliation.proposed_body as string | null) ??
      (candidate.candidate_text as string),
    confidence: reconciliation.confidence as number,
    changeReason: `review-approved reconciliation update: ${reconciliation.policy_reason ?? "human approved"}`,
    status: "approved",
  });
  return textResponse(
    formatJson({
      candidate_id,
      memoryId,
      status: "approved",
      reconciliation_id: reconciliation.id,
    }),
  );
}
```

For reject/archive actions, after updating candidate status, call `markReconciliationStatus` when a pending reconciliation exists.

- [ ] **Step 3: Update list response with reconciliation info**

In the `review_candidates` list branch, after loading pending candidates, fetch pending reconciliations for those candidate IDs and attach them in memory. Use two queries to keep this simple:

```ts
const candidates = data ?? [];
const candidateIds = candidates.map((row) => row.id);
let reconciliations: Record<string, unknown>[] = [];
if (candidateIds.length > 0) {
  const { data: reconciliationRows, error: reconciliationError } =
    await supabase
      .from("memory_reconciliations")
      .select("*")
      .in("candidate_id", candidateIds);
  if (reconciliationError) {
    return textResponse(
      `review reconciliation list failed: ${reconciliationError.message}`,
      true,
    );
  }
  reconciliations = reconciliationRows ?? [];
}
const reconciliationByCandidate = new Map(
  reconciliations.map((row) => [row.candidate_id, row]),
);
return textResponse(
  formatJson(
    sanitizeRowsForMcp(
      candidates.map((row) => ({
        ...row,
        reconciliation: reconciliationByCandidate.get(row.id) ?? null,
      })),
    ),
  ),
);
```

- [ ] **Step 4: Run tests and check**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno task test
deno task check
```

Expected: all tests pass and index checks.

- [ ] **Step 5: Commit review integration**

```bash
git add sofia/cloud/supabase/functions/sofia-core/db.ts \
  sofia/cloud/supabase/functions/sofia-core/db_test.ts \
  sofia/cloud/supabase/functions/sofia-core/index.ts
git commit -m "Apply reconciliation decisions during review"
```

---

## Task 7: Document feature flag and run local verification

**Files:**

- Modify: `sofia/cloud/README.md`

- [ ] **Step 1: Add README section**

Add after the operator tasks section in `sofia/cloud/README.md`:

````md
## Memory reconciliation

SOFIA can reconcile new memory candidates against active memories before promotion when enabled with:

```bash
SOFIA_RECONCILIATION_ENABLED=true
```
````

When disabled, capture uses the legacy route-and-promote behavior. When enabled, SOFIA archives exact duplicates, promotes genuinely new low-risk memories, versions safe high-confidence updates, and sends conflicts, merges, sensitive updates, and uncertain changes to the existing candidate review queue.

Reconciliation decisions are stored in `memory_reconciliations` and should be inspected through `review_candidates` when a candidate is pending review.

````

- [ ] **Step 2: Run full local verification**

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno task test
deno task check
cd /Users/justinramirez/dev/dotfiles
git diff --check
````

Expected:

- `deno task test` reports all tests passed.
- `deno task check` reports `Check index.ts`.
- `git diff --check` exits 0.

- [ ] **Step 3: Commit docs**

```bash
git add sofia/cloud/README.md
git commit -m "Document SOFIA memory reconciliation"
```

---

## Task 8: Deploy with reconciliation disabled, then smoke test before enabling

**Files:**

- No code files expected unless smoke test exposes a defect.

- [ ] **Step 1: Confirm clean working tree and full test pass**

```bash
git status --short
cd sofia/cloud/supabase/functions/sofia-core
deno task test
deno task check
```

Expected: clean status before deploy; all tests/checks pass.

- [ ] **Step 2: Apply database migration**

Preview/apply according to the existing Supabase workflow. Use:

```bash
cd /Users/justinramirez/dev/dotfiles/sofia/cloud
supabase db push
```

Expected: migration `0002_memory_reconciliations.sql` is applied successfully. If Supabase prompts for confirmation, read the prompt and confirm only if it is applying the expected new table/index/policy migration.

- [ ] **Step 3: Deploy Edge Function with flag disabled**

Ensure `SOFIA_RECONCILIATION_ENABLED` is absent or false in Supabase secrets, then deploy:

```bash
cd /Users/justinramirez/dev/dotfiles
mise run sofia-cloud:deploy
mise run sofia-cloud:functions-list
```

Expected: `sofia-core` deploys and functions list shows a new active version.

- [ ] **Step 4: Smoke test legacy behavior still works**

Use MCP to capture a harmless test event while the flag is disabled:

```json
{
  "context": "personal",
  "source": "reconciliation-smoke-test",
  "source_ref": "flag-disabled",
  "type_hint": "test",
  "content": "SOFIA reconciliation smoke test with flag disabled; this temporary event should not become durable memory.",
  "metadata": { "test_marker": "reconciliation-flag-disabled" }
}
```

Expected: capture succeeds. If a candidate is created, archive it through `review_candidates` or `archive_memory` depending on result.

- [ ] **Step 5: Enable flag only after explicit approval**

Ask Justin before changing Supabase secrets. With approval, run:

```bash
cd /Users/justinramirez/dev/dotfiles/sofia/cloud
supabase secrets set SOFIA_RECONCILIATION_ENABLED=true
cd /Users/justinramirez/dev/dotfiles
mise run sofia-cloud:deploy
```

Expected: deployment succeeds with reconciliation enabled.

- [ ] **Step 6: Smoke test duplicate/update behavior**

Capture a duplicate of an existing shared workflow preference:

```json
{
  "context": "shared",
  "source": "reconciliation-smoke-test",
  "source_ref": "duplicate-workflow-preference",
  "type_hint": "test",
  "content": "Justin prefers direct local merge after verification when he is the only person working on the branch.",
  "metadata": { "test_marker": "reconciliation-duplicate" }
}
```

Expected: capture succeeds and MCP output includes reconciliation. Exact expected action may be `archive_duplicate` or `review_update` depending LLM judgment; it must not create an unlinked parallel durable memory. If it queues review, inspect `review_candidates` and archive the smoke-test candidate after verifying reconciliation metadata.

- [ ] **Step 7: Final verification**

```bash
git status --short
cd sofia/cloud/supabase/functions/sofia-core
deno task test
deno task check
```

Expected: clean working tree and all tests/checks pass.

---

## Self-review checklist

- Spec coverage: Tasks cover schema, retrieval/reconciliation, policy-based autonomy, audit rows, versioning, review integration, feature flag, docs, tests, and rollout.
- Scope: Merge approval is represented in schema and review routing; full multi-memory merge execution is intentionally deferred because update/duplicate behavior is the first independently testable slice and the spec allowed merge semantics after update/duplicate behavior.
- Placeholder scan: No `TBD`, incomplete code placeholders, or unspecified test commands remain.
- Type consistency: Reconciliation action/status/type names match the design spec and are used consistently across types, policy, DB helpers, and capture flow.
