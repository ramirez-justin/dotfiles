# Phase 8 Reaction Learning Implementation Plan

> **For Hermes:** Use TDD. Write failing tests before production code and keep Phase 8 deterministic/no-LLM for v1.

**Goal:** Capture Telegram emoji reactions as privacy-bounded feedback telemetry and surface actionable patterns in the SOFIA daily review loop without auto-promoting single reactions into durable memory.

**Architecture:** Add append-only `reaction_events` plus aggregated `reaction_patterns`. Runtime exposes deterministic helpers and MCP tools to record reactions and report patterns. Daily digest includes recent negative reactions and candidate-worthy repeated patterns. SOFIA memory candidates remain the review/reconciliation boundary for durable learned preferences.

**Tech Stack:** Supabase Postgres migrations, Deno/TypeScript Edge Function, MCP tool registration, existing daily digest formatter.

---

## Task 1: Add deterministic reaction classifier

**Objective:** Map emojis to category/sentiment/action without an LLM.

**Files:**
- Create: `sofia/cloud/supabase/functions/sofia-core/reactions_test.ts`
- Create: `sofia/cloud/supabase/functions/sofia-core/reactions.ts`

**Steps:**
1. Write tests for positive, negative, confirmation, attention, and unknown emoji mapping.
2. Run `deno test reactions_test.ts` and verify RED.
3. Implement `classifyReactionEmoji` and `shouldConsiderForLearning` minimally.
4. Re-run `deno test reactions_test.ts` and verify GREEN.

## Task 2: Add reaction event schema and capture helper

**Objective:** Persist append-only reaction events with redacted previews and deterministic classification.

**Files:**
- Create: `sofia/cloud/supabase/migrations/0012_reaction_learning.sql`
- Modify: `reactions.ts`
- Modify: `reactions_test.ts`

**Steps:**
1. Write tests using a fake Supabase client proving `recordReactionEvent` inserts expected fields and redacts message previews.
2. Run test and verify RED.
3. Add migration tables/views and implement helper.
4. Re-run focused tests.

## Task 3: Aggregate safe repeated patterns

**Objective:** Identify repeated reaction patterns that are candidate-worthy but not auto-promoted.

**Files:**
- Modify: `reactions.ts`
- Modify: `reactions_test.ts`

**Steps:**
1. Write tests for `summarizeReactionPatterns`: repeated positive/negative signals pass thresholds; single reactions do not.
2. Implement deterministic summary and candidate-worthy flags.
3. Re-run focused tests.

## Task 4: Expose MCP tools

**Objective:** Add SOFIA MCP tools for reaction capture/reporting.

**Files:**
- Modify: `index.ts`

**Tools:**
- `record_reaction_event`
- `get_reaction_learning_report`

**Steps:**
1. Register schemas with privacy defaults: personal/work/shared context, platform default `telegram`, group reactions disabled unless metadata explicitly says allowed.
2. Return sanitized JSON only.

## Task 5: Integrate Phase 7 daily digest

**Objective:** Surface reaction signals in daily review output.

**Files:**
- Modify: `daily_digest.ts`
- Modify: `daily_digest_test.ts`

**Steps:**
1. Add tests for negative reaction alerts and candidate-worthy patterns in digest text.
2. Verify RED.
3. Add fields to `DailyDigestSnapshot`, fetch from views/helpers, and format deterministic lines.
4. Verify GREEN.

## Task 6: Docs, checks, deploy, live smoke

**Objective:** Complete Phase 8 to the global definition of done.

**Files:**
- Modify: `ROADMAP.md`
- Modify: `RUNBOOK.md`

**Commands:**
- `mise run sofia-cloud:test`
- `mise run sofia-cloud:check`
- `git diff --check -- sofia/cloud`
- `supabase db push --workdir ...`
- `supabase functions deploy sofia-core ...`
- live MCP smoke: `record_reaction_event` and `get_reaction_learning_report`
