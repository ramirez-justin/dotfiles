# SOFIA Phase 4 Retrieval Policy Learning Implementation Plan

> **For Hermes:** Use TDD task-by-task. Write a failing focused Deno test before changing runtime code for each behavior.

**Goal:** use retrieval telemetry to recommend boot-context and priority policy changes without mutating memories automatically.

**Architecture:** Add read-only analytics over `memory_retrievals`, `memories`, and `boot_context_snapshots`, then expose a gated MCP report tool. SQL migration adds helpful views for live inspection; TypeScript owns recommendation logic so it can be tested deterministically.

**Tech Stack:** Supabase Postgres migrations, Deno Edge Function, MCP tool registration, Deno tests.

---

## Acceptance criteria

- Tests cover helpful/confusing retrieval aggregation.
- Tests cover policy recommendations without applying them.
- `record_memory_feedback` remains the mutation path for telemetry updates.
- A live report can list top helpful, top confusing, and boot-unused memories.
- No automatic destructive changes occur without review.

## Task 1: Add failing tests for aggregation

**Files:**
- Create: `sofia/cloud/supabase/functions/sofia-core/retrieval_policy_test.ts`
- Create later: `sofia/cloud/supabase/functions/sofia-core/retrieval_policy.ts`

**Steps:**
1. Test that the report loads retrieval rows grouped by memory and computes:
   - `retrieval_count`
   - `used_count`
   - `helpful_count`
   - `confusing_count`
   - `helpful_rate`
   - `confusing_rate`
2. Run `deno test retrieval_policy_test.ts --filter aggregation`; expect missing module/function failure.
3. Implement minimal `buildRetrievalPolicyReport` with fake Supabase support.
4. Verify test passes.

## Task 2: Add recommendation tests

**Files:**
- Modify: `retrieval_policy_test.ts`
- Modify: `retrieval_policy.ts`

**Steps:**
1. Test helpful memories recommend `raise_priority` or `enable_boot_context`.
2. Test confusing memories recommend `needs_review` and never archive automatically.
3. Test boot-context eligible memories seen in snapshots but not used recommend `lower_priority` or `disable_boot_context`.
4. Implement pure recommendation logic.
5. Verify tests pass.

## Task 3: Add SQL migration for live analytics

**Files:**
- Create: `sofia/cloud/supabase/migrations/0008_retrieval_policy_learning.sql`

**Steps:**
1. Create `memory_retrieval_policy_stats` view aggregating `memory_retrievals` joined to active `memories`.
2. Create `boot_context_memory_usage` view using `boot_context_snapshots.included_memory_ids` plus retrieval feedback.
3. Add comments documenting that views are diagnostic/read-only; policy mutations remain gated through review.
4. Verify SQL style with tests/checks.

## Task 4: Expose MCP report tool

**Files:**
- Modify: `sofia/cloud/supabase/functions/sofia-core/index.ts`
- Modify: `retrieval_policy.ts`

**Steps:**
1. Register `get_retrieval_policy_report`.
2. Inputs:
   - `context`: `personal | work | shared | both`, default `both`
   - `limit`: default `10`
   - `minimum_retrievals`: default `1`
3. Return JSON with:
   - `top_helpful`
   - `top_confusing`
   - `boot_unused`
   - `recommendations`
4. Ensure tool only reads data.

## Task 5: Documentation and verification

**Files:**
- Modify: `sofia/cloud/RUNBOOK.md`
- Modify: `sofia/cloud/ROADMAP.md`

**Steps:**
1. Add Phase 4 runbook section with SQL and MCP report examples.
2. Mark Phase 4 status after deploy.
3. Run:
   - `mise run sofia-cloud:test`
   - `mise run sofia-cloud:check`
   - `git diff --check -- sofia/cloud`
4. Deploy:
   - `supabase db push --workdir sofia/cloud --yes`
   - `supabase functions deploy sofia-core --workdir sofia/cloud --no-verify-jwt --project-ref <ref>`
5. Health/smoke:
   - `mise run sofia-cloud:health`
   - live MCP/tool smoke if exposed in current session, or HTTP health if gateway metadata needs reload.
6. Commit using conventional message.
