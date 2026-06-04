# SOFIA Phase 5 Task/Session Continuity Implementation Plan

> **For Hermes:** Use TDD task-by-task. Write failing tests before runtime changes; deploy only after tests, type checks, and health checks pass.

**Goal:** let agents resume work across sessions from explicit task/session state, artifacts, and handoffs rather than vague memory search.

**Architecture:** Add normalized session/task tables in Postgres, a small TypeScript runtime module for task runs/artifacts/handoffs, MCP tools for agents to record and retrieve continuity state, and boot-context integration for active handoffs. Handoffs are explicit operational state, not durable memories.

**Tech Stack:** Supabase/Postgres migrations, Deno Edge Function, MCP tools, existing SOFIA entity graph.

---

## Task 1: Add task/session schema

Files:
- Create `sofia/cloud/supabase/migrations/0009_task_session_continuity.sql`

Acceptance:
- Adds `agent_sessions`, `task_runs`, `task_artifacts`, and `session_handoffs`.
- Links task runs/handoffs to optional entities.
- Uses status constraints and indexes for active-work lookups.

## Task 2: Add runtime tests first

Files:
- Create `sofia/cloud/supabase/functions/sofia-core/sessions_test.ts`

Test behaviors:
- `startTaskRun` creates an agent session and in-progress task run.
- `attachTaskArtifact` records an artifact with type/title/URI/content.
- `completeTaskRun` updates task status and creates a resumable handoff.
- `getLatestHandoffs` returns newest entity/project handoffs.
- `listActiveTaskRuns` returns in-progress/blocked work only.

## Task 3: Implement runtime module

Files:
- Create `sofia/cloud/supabase/functions/sofia-core/sessions.ts`

Functions:
- `startTaskRun`
- `attachTaskArtifact`
- `completeTaskRun`
- `getLatestHandoffs`
- `listActiveTaskRuns`

## Task 4: Expose MCP tools

Files:
- Modify `sofia/cloud/supabase/functions/sofia-core/index.ts`

Tools:
- `start_task_run`
- `attach_task_artifact`
- `complete_task_run`
- `get_latest_handoffs`
- `list_active_task_runs`

## Task 5: Include handoffs in boot context

Files:
- Modify `sofia/cloud/supabase/functions/sofia-core/boot_context.ts`
- Modify `boot_context_test.ts`

Behavior:
- Fresh boot-context compilation includes active/recent handoffs for the requested context.
- Entity-scoped boot context includes only handoffs linked to that entity.
- Completed task artifacts/verification are visible in handoff text, not raw logs.

## Task 6: Docs, deploy, and verify

Files:
- Modify `sofia/cloud/ROADMAP.md`
- Modify `sofia/cloud/RUNBOOK.md`

Commands:
- `mise run sofia-cloud:test`
- `mise run sofia-cloud:check`
- `git diff --check -- sofia/cloud`
- `supabase db push --workdir /Users/justinramirez/dev/dotfiles/sofia/cloud --yes`
- `supabase functions deploy sofia-core --workdir /Users/justinramirez/dev/dotfiles/sofia/cloud --no-verify-jwt --project-ref avgjtkgppeeihntsyjpy`
- `SUPABASE_SOFIA_PROJECT_REF=avgjtkgppeeihntsyjpy mise run sofia-cloud:health`
