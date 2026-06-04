# SOFIA Phase 6 Contradiction Detection and Memory QA Implementation Plan

> **For Hermes:** Use TDD task-by-task. Write failing tests before runtime changes; deploy only after tests, type checks, health checks, and live MCP verification pass.

**Goal:** Detect conflicting or weak SOFIA memories proactively, queue auditable reconciliation work, and prevent unresolved high-confidence contradictions from polluting boot context.

**Architecture:** Add a small deterministic contradiction/QA module that works with existing memory lifecycle and relation tables. Store explicit contradiction review rows in Postgres, expose non-destructive MCP reporting tools, and make boot-context compilation conflict-aware.

**Tech Stack:** Supabase/Postgres migrations, Deno TypeScript Edge Function, MCP JSON-RPC tools, existing SOFIA Cloud tests.

---

## Task 1: Add schema for contradiction reviews and QA views

**Files:**
- Create: `sofia/cloud/supabase/migrations/0010_contradiction_detection.sql`

**Steps:**
1. Add `memory_contradiction_reviews` for candidate/pairwise conflict review state.
2. Add indexes for active context/entity queries.
3. Add QA views for weak provenance and unresolved contradiction relations.
4. Add RLS.

## Task 2: Add contradiction classifier tests first

**Files:**
- Create: `sofia/cloud/supabase/functions/sofia-core/contradictions_test.ts`
- Create: `sofia/cloud/supabase/functions/sofia-core/contradictions.ts`

**Tests:**
- exact duplicate pairs classify as `duplicate`
- explicit negation or changed value classifies as `contradiction`
- newer replacement language classifies as `update`
- unrelated facts classify as `unrelated`

## Task 3: Add review queue helpers

**Files:**
- Modify: `sofia/cloud/supabase/functions/sofia-core/db.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/db_test.ts`

**Tests:**
- unresolved contradiction review row is inserted with related memory IDs and proposed resolution
- QA report reads actionable stale/weak/conflict rows

## Task 4: Make boot context contradiction-aware

**Files:**
- Modify: `sofia/cloud/supabase/functions/sofia-core/boot_context.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/boot_context_test.ts`

**Tests:**
- if two active boot memories have an unresolved high-confidence contradiction relation, boot context includes only the higher-priority/newer memory and records the omitted ID in snapshot metadata.

## Task 5: Expose MCP tools and docs

**Files:**
- Modify: `sofia/cloud/supabase/functions/sofia-core/index.ts`
- Modify: `sofia/cloud/ROADMAP.md`
- Modify: `sofia/cloud/RUNBOOK.md`

**Tools:**
- `create_contradiction_review`
- `get_memory_qa_report`

## Task 6: Verify and deploy

Commands:

```bash
mise run sofia-cloud:test
mise run sofia-cloud:check
git diff --check -- sofia/cloud
supabase db push --workdir /Users/justinramirez/dev/dotfiles/sofia/cloud --yes
supabase functions deploy sofia-core --workdir /Users/justinramirez/dev/dotfiles/sofia/cloud --no-verify-jwt --project-ref avgjtkgppeeihntsyjpy
SUPABASE_SOFIA_PROJECT_REF=avgjtkgppeeihntsyjpy mise run sofia-cloud:health
```

Live verify via JSON-RPC that tools list/call succeeds.
