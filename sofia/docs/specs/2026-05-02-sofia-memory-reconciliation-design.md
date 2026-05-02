# SOFIA Memory Reconciliation Design

## Summary

SOFIA should reconcile new memory candidates against existing active memories before promotion. The goal is to avoid duplicate memories, detect stale or contradictory facts, and apply safe updates through memory versioning instead of creating parallel records.

This is not a similarity-only half measure. It is an end-state foundation for memory lifecycle management: retrieve related memories, classify the relationship, apply policy-based autonomy, persist the reconciliation decision, and either archive, promote, update, or queue review.

## Goals

- Prevent exact duplicates and no-op restatements from becoming new active memories.
- Detect when a candidate refines, updates, contradicts, or should merge with an existing memory.
- Preserve memory history through `memory_versions` instead of overwriting without audit.
- Allow autonomous updates only under explicit low-risk policy.
- Require review for sensitive, ambiguous, financial/property/legal/medical/family/person-context, conflict, and broad-merge cases.
- Keep capture resilient: reconciliation failures must not lose events or candidates.

## Non-goals

- Fully autonomous rewriting of all memories.
- Manual-only duplicate flagging without lifecycle actions.
- Changing boot-context compilation semantics beyond using active/current memories as it already does.
- Using local Obsidian/Markdown as a runtime memory source. SOFIA Cloud/Postgres remains canonical.

## Architecture

Add a reconciliation step between candidate routing and promotion.

Current flow:

1. Redact event.
2. Insert event.
3. Classify event into memory candidates.
4. Route candidates.
5. Auto-promote high-confidence low-risk candidates or queue review.

New flow:

1. Redact event.
2. Insert event.
3. Classify event into memory candidates.
4. Embed each candidate.
5. Route candidates for base quality/risk.
6. Retrieve similar active memories.
7. Reconcile candidate against those memories.
8. Apply policy to the reconciliation result.
9. Persist reconciliation decision.
10. Apply the final action:
    - archive duplicate/no-op candidate
    - promote genuinely new memory
    - update/version an existing memory
    - queue proposed update/merge/conflict for review

The main reconciliation module should expose a small interface, such as:

```ts
reconcileCandidate(candidate, context, embedding, existingMemories, policy);
```

It returns a structured decision:

```ts
{
  action:
    | "promote_new"
    | "archive_duplicate"
    | "update_existing"
    | "review_update"
    | "review_merge"
    | "review_conflict";
  target_memory_id?: string;
  related_memory_ids: string[];
  proposed_title?: string;
  proposed_body?: string;
  confidence: number;
  rationale: string;
  policy_reason: string;
}
```

## Reconciliation engine

Use a two-stage engine.

### Stage 1: deterministic retrieval

For each candidate with an embedding:

- Search active memories in the same context.
- Also search `shared` when the candidate context is `personal` or `work`.
- Prefer same memory type, but do not require it.
- Use a semantic similarity threshold around `0.72` for candidates.
- Include the top few matches, usually up to five.
- Keep or boost matches with overlapping entities or similar titles.
- Ignore archived memories for normal reconciliation.

### Stage 2: structured relationship judgment

Call an LLM with the candidate plus retrieved memories and require strict JSON.

Relationship values:

- `new_memory`
- `exact_duplicate`
- `same_fact`
- `refinement`
- `updates_existing`
- `contradicts_existing`
- `merge_with_existing`
- `uncertain`

Expected output:

```ts
{
  relationship: "updates_existing";
  target_memory_id: "...";
  related_memory_ids: ["..."];
  proposed_title: "...";
  proposed_body: "...";
  confidence: 0.94;
  rationale: "...";
}
```

### Stage 3: action mapping

- `new_memory` -> `promote_new`
- `exact_duplicate` / `same_fact` -> `archive_duplicate`
- `refinement` / `updates_existing` -> `update_existing` or `review_update`, depending policy
- `contradicts_existing` -> `review_conflict`
- `merge_with_existing` -> `review_merge`
- `uncertain` -> preserve the base route, usually review

If retrieval or reconciliation fails, capture should still succeed. The event and candidate should remain stored, and the candidate should route to review with `reconciliation_error` metadata rather than being unsafely auto-promoted.

## Policy model

Keep reconciliation judgment separate from policy application.

The reconciler decides what relationship exists and may propose a new title/body. The policy layer decides whether SOFIA may apply that decision automatically.

### Auto-allowed actions

SOFIA may automatically:

- archive exact duplicates
- archive same-fact/no-meaningful-change candidates
- promote genuinely new low-risk memories
- update an existing memory only when all conditions are true:
  - candidate risk is `low`
  - candidate is not redacted
  - reconciliation confidence is very high, around `>= 0.92`
  - memory type is safe for autonomous update, such as:
    - `preference`
    - `operating_rule`
    - `lesson`
    - `gotcha`
    - low-risk `project_context`
  - no sensitive entities or domains are detected

### Review-required actions

SOFIA must require review for:

- `person_context`
- financial, property, legal, medical, or family details
- contradictions
- broad merges of multiple memories
- medium/high-risk candidates
- redacted content
- updates below the high-confidence threshold
- boot-context-critical system rules unless explicitly captured as a direct instruction
- any ambiguous or uncertain reconciliation

## Data model

Add a `memory_reconciliations` table. One row represents one candidate reconciliation attempt.

Suggested columns:

- `id uuid primary key default gen_random_uuid()`
- `candidate_id uuid references memory_candidates(id) on delete cascade`
- `context text not null`
- `action text not null`
- `status text not null`
- `target_memory_id uuid references memories(id)`
- `related_memory_ids uuid[] not null default '{}'`
- `proposed_title text`
- `proposed_body text`
- `confidence real not null`
- `rationale text`
- `policy_reason text`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Expected statuses:

- `auto_applied`
- `pending_review`
- `approved`
- `rejected`
- `archived`

Expected actions:

- `promote_new`
- `archive_duplicate`
- `update_existing`
- `review_update`
- `review_merge`
- `review_conflict`

## Memory versioning behavior

For an approved or auto-applied update:

1. Load target memory.
2. Compute `next_version = current_version + 1`.
3. Update `memories.title`, `memories.body`, `memories.confidence`, and `memories.current_version`.
4. Insert a `memory_versions` row with the new title/body and a reconciliation change reason.
5. Mark the candidate and reconciliation as applied/approved.

For duplicate or no-op candidates:

1. Leave the target memory unchanged.
2. Mark the candidate archived.
3. Store the reconciliation row pointing at the existing memory.

For merge/conflict review cases:

- Store proposed title/body and related memory IDs.
- Do not supersede or archive existing memories until review approval.
- If a merge is approved, update one target memory or create a consolidated memory, then mark replaced memories as `superseded` or `archived` according to the review action.
- Add `memory_edges` where useful, such as `supersedes`, `contradicts`, or `evolved_into`.

## Review UX

Extend the existing `review_candidates` flow rather than adding a second queue initially.

- Candidate list responses should include reconciliation info when present.
- Approving a candidate with `review_update` should apply the proposed update/version instead of creating a parallel memory.
- Approving a `review_merge` should apply the proposed merge behavior once implemented for that action.
- Rejecting or archiving should update both the candidate and its reconciliation row.

This keeps one review surface while still modeling reconciliation as first-class state.

## Feature flag and rollout

Gate the behavior behind an environment flag:

```text
SOFIA_RECONCILIATION_ENABLED=false
```

Rollout sequence:

1. Add schema and code with the flag off.
2. Run unit and integration-style tests.
3. Deploy with the flag off.
4. Enable in cloud after smoke testing.
5. Inspect several live captures and review queue entries.
6. Keep enabled once behavior is trusted.

## Testing plan

Unit tests should cover:

- relationship-to-action mapping
- policy decisions
  - duplicate auto-archive
  - safe high-confidence preference update auto-applies
  - financial/family/person-context updates require review
  - redacted and medium-risk updates require review
- memory version update behavior
- review approval applying a proposed update instead of creating a duplicate memory
- reconciliation failure fallback to review

Integration-style tests with fake Supabase data should cover:

- a candidate similar to an existing memory archives as duplicate
- a candidate updating an existing memory creates version 2
- a candidate conflicting with an existing memory remains pending review

## Observability and auditability

Every reconciliation decision should be inspectable through:

- the `memory_reconciliations` row
- candidate status and metadata
- memory version history
- policy reason
- MCP output for capture/review actions

Autonomous memory changes must be explainable after the fact.

## Open implementation notes

- The exact similarity threshold can start near `0.72`, but should be configurable or easy to tune.
- Sensitive-domain detection can begin with deterministic keyword/entity rules and become more sophisticated later.
- Merge approval semantics may be implemented after update/duplicate behavior, but the schema should support merge decisions from the start.
