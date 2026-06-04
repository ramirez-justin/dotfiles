# SOFIA Agent-Native Memory Roadmap

**Goal:** evolve SOFIA Cloud from a graph-capable memory system into a self-maintaining, evidence-backed agent memory/control plane.

**Current baseline:** Phase 6 is deployed. SOFIA now has raw events, candidates, durable memories, first-class provenance, lifecycle/status fields, typed relations, retrieval policy fields, normalized entities, todos, retrieval telemetry, boot-context snapshots, stale/expired memory maintenance, safe supersession edges, task/session handoffs, contradiction QA, and Pi/Hermes cloud consistency checks.

**Tracking rule:** this roadmap is the source of truth for project direction. Concrete implementation tasks should live as SOFIA `todos` once the todo API grows task-management tools; until then, track active engineering work in this file and commit updates as work lands.

---

## Principles

1. **Evidence over vibes** — every durable memory should be explainable through provenance, evidence, confidence, and verification timestamps.
2. **Lifecycle over accumulation** — SOFIA should update, supersede, archive, or reject stale knowledge instead of endlessly adding notes.
3. **Compiled context over ad hoc context** — agents should receive explicit boot-context snapshots with included IDs and token counts.
4. **Todos are not memories** — action state belongs in todos with owner/status/due/dependency fields.
5. **Retrieval should learn** — search and boot-context inclusion should improve from usefulness/confusion feedback.
6. **Fail closed on memory ambiguity** — contradictions, sensitive facts, and uncertain merges go to review, not silent promotion.
7. **Small verified slices** — each phase ships with tests, migration, deployment, live health verification, and rollback notes.

---

## Phase 1 — Agent-native memory foundation

**Status:** complete and deployed.

### Delivered

- `memory_provenance` table.
- lifecycle fields on `memories`: `status`, `superseded_by_memory_id`, `stale_after`, `last_verified_at`, `review_reason`, `expires_at`.
- retrieval policy fields: `retrieval_priority`, `boot_context_eligible`, `activation_triggers`.
- expanded typed `memory_edges` relation vocabulary.
- `todos` and `todo_dependencies` separate from durable memories.
- `memory_retrievals` telemetry and `record_memory_feedback` MCP tool.
- `boot_context_snapshots` with included memory/todo IDs and token count.
- boot compiler sorting by retrieval priority and including active todos.
- live migration/deploy verification.

### Acceptance criteria met

- `mise run sofia-cloud:test` passes.
- `mise run sofia-cloud:check` passes.
- Supabase migrations apply cleanly.
- Edge Function deploys and reports ACTIVE.
- `mise run sofia-cloud:health` passes.
- `get_boot_context(force_refresh=true)` returns `snapshot_id`, `included_memory_ids`, `included_todo_ids`, and `token_count`.
- `search_memory` works after the `match_memories` RPC ambiguity fix.

---

## Phase 2 — Memory lifecycle automation

**Status:** complete and deployed.

**Delivered:** stale/expired memory maintenance, defensive boot-context lifecycle filtering, default search filtering for stale/expired rows, high-priority stale review candidates, safe supersession with graph edges, and cross-agent Pi/Hermes SOFIA Cloud consistency checks.

**Goal:** make SOFIA actively maintain memory freshness and supersession instead of merely storing lifecycle fields.

### Scope

1. Add stale-memory detection.
   - Mark active memories `stale` when `stale_after < now()` or `expires_at < now()`.
   - Keep expired/stale memories out of default retrieval and boot context.
   - Create review items for high-priority stale memories.

2. Add safe supersession application.
   - When reconciliation decides `updates` or `supersedes` with high confidence and low risk, apply it automatically.
   - Set old memory status to `superseded`.
   - Set `superseded_by_memory_id`.
   - Insert `memory_edges` relation `supersedes` or `updates`.
   - Preserve old memory via `memory_versions`.

3. Add review queue ergonomics.
   - Make reconciliation items easier to inspect by severity and relationship.
   - Add reviewer prompts for contradiction/update decisions.
   - Add resolution notes on approve/reject/archive.

4. Verify Hermes and Pi both use SOFIA Cloud correctly.
   - Confirm Pi startup/runtime fetches boot context from SOFIA Cloud and does not silently fall back to local Obsidian `_agent` files.
   - Confirm the Hermes `sofia-spike` profile fetches SOFIA Cloud boot context before session start and fails closed if cloud context is unavailable.
   - Confirm Hermes MCP wiring can call SOFIA Cloud tools (`get_boot_context`, `search_memory`, `capture_event`, and review tools) through the intended profile.
   - Confirm Hermes gateway/Telegram runs under the SOFIA profile with the SOFIA environment loaded, not the default profile.
   - Confirm Pi MCP config and Hermes profile config point at the same deployed `sofia-core` endpoint and use secret references/environment variables rather than raw secrets.
   - Add an operator check/runbook section that makes this auditable after every SOFIA Cloud deployment.

### Acceptance criteria

- Unit tests cover stale transitions, expiry filtering, and high-priority stale review creation.
- Unit tests cover automatic safe supersession and old/new memory graph edges.
- Integration test proves a superseded memory is not returned by default search.
- Integration test proves boot context omits stale/expired/superseded memories.
- Live health passes after deploy.
- A live seeded stale/supersession scenario can be inspected through `review_candidates` or SQL without secret exposure.
- Pi verification passes: `source ~/.pi/agent/env.zsh` followed by a SOFIA Cloud health/boot-context check succeeds without printing secrets.
- Pi MCP config verification passes: `~/.pi/agent/mcp.json` contains the `sofia-cloud` server, points at the deployed Supabase Edge Function, and uses `${SOFIA_MCP_ACCESS_KEY}` or equivalent secret injection.
- Hermes CLI verification passes: `mise run hermes:sofia:boot-context` returns SOFIA Cloud boot context with `snapshot_id`/`token_count`.
- Hermes MCP verification passes: `mise run hermes:sofia:doctor` or equivalent `hermes --profile sofia-spike mcp test sofia-cloud` succeeds.
- Hermes gateway verification passes: `mise run hermes:sofia:gateway:doctor` and `mise run hermes:sofia:gateway:status` show the SOFIA-hydrated gateway running under the intended profile.
- Cross-agent consistency check passes: Pi and Hermes both retrieve boot context from the same SOFIA Cloud project/ref and compiled artifact source, with no local-vault runtime fallback.

### Suggested files

- `sofia/cloud/supabase/migrations/0006_memory_lifecycle_automation.sql`
- `sofia/cloud/supabase/functions/sofia-core/db.ts`
- `sofia/cloud/supabase/functions/sofia-core/reconcile.ts`
- `sofia/cloud/supabase/functions/sofia-core/index.ts`
- `sofia/cloud/supabase/functions/sofia-core/db_test.ts`
- `sofia/cloud/supabase/functions/sofia-core/reconcile_test.ts`
- `sofia/cloud/RUNBOOK.md`
- `hermes/RUNBOOK.md`
- `hermes/.hermes/profiles/sofia-spike/scripts/`
- `pi/.pi/agent/mcp.json`
- `pi/.pi/agent/env.zsh`

---

## Phase 3 — Entity graph model

**Status:** implemented, tested, deployed to Supabase project `avgjtkgppeeihntsyjpy`, and pushed to `main`.

**Goal:** make projects, repos, people, systems, tools, decisions, and organizations first-class retrieval anchors rather than loose metadata.

### Scope

1. Add normalized entity subtypes or typed tables for:
   - people
   - organizations
   - projects
   - repos
   - systems
   - tools
   - decisions

2. Add stable entity identity/reconciliation.
   - Normalize aliases.
   - Merge duplicates safely.
   - Track canonical names and external refs.

3. Attach memory/todo/retrieval context to entities.
   - Memories can belong to projects/repos/systems.
   - Todos can attach to project/system/repo entities.
   - Boot context can compile by entity/project scope.

4. Add entity-aware search.
   - Search by entity name.
   - Search within entity scope.
   - Include entity provenance in results.

### Acceptance criteria

- Tests prove entity aliases resolve to canonical entity IDs.
- Tests prove memory/todo attachments survive promotion and todo creation.
- Search can filter by project/entity scope.
- Boot context can be generated for a project/entity slice without pulling unrelated personal facts.
- Existing memories continue to retrieve normally.
- Migration includes backfill path from existing `entities`/metadata.

### Suggested files

- `sofia/cloud/supabase/migrations/0007_entity_graph_model.sql`
- `sofia/cloud/supabase/functions/sofia-core/entities.ts`
- `sofia/cloud/supabase/functions/sofia-core/entity_test.ts`
- `sofia/cloud/supabase/functions/sofia-core/db.ts`
- `sofia/cloud/supabase/functions/sofia-core/index.ts`

---

## Phase 4 — Retrieval policy learning

**Status:** implemented, tested, deployed to Supabase project `avgjtkgppeeihntsyjpy`, and pushed to `main`.

**Goal:** use telemetry to tune boot-context inclusion and search behavior without manual guesswork.

### Scope

1. Add retrieval analytics queries.
   - Which memories are frequently retrieved and helpful?
   - Which memories cause confusion?
   - Which boot-context memories are never used?

2. Add policy recommendation job/tool.
   - Recommend raising/lowering `retrieval_priority`.
   - Recommend toggling `boot_context_eligible`.
   - Recommend archiving or review for confusing/stale memories.

3. Keep policy changes gated.
   - Recommendations are reviewable before mutation.
   - High-risk memory types never mutate automatically.

4. Add session-aware feedback.
   - Record session/task IDs consistently.
   - Let agents mark which retrieved memories materially affected an answer.

### Acceptance criteria

- Tests cover helpful/confusing retrieval aggregation.
- Tests cover policy recommendations without applying them.
- `record_memory_feedback` updates telemetry rows in live use.
- A live report can list top helpful, top confusing, and boot-unused memories.
- No automatic destructive changes occur without review.

### Suggested files

- `sofia/cloud/supabase/migrations/0008_retrieval_policy_learning.sql`
- `sofia/cloud/supabase/functions/sofia-core/retrieval_policy.ts`
- `sofia/cloud/supabase/functions/sofia-core/retrieval_policy_test.ts`
- `sofia/cloud/supabase/functions/sofia-core/index.ts`
- `sofia/cloud/RUNBOOK.md`

---

## Phase 4.5 — Promotion policy tuning

**Status:** implemented, tested, deployed to Supabase project `avgjtkgppeeihntsyjpy`, pushed to `main`, and current review queue cleared.

**Goal:** reduce review-queue noise by safely auto-promoting provenance-backed work milestones and auto-archiving transient progress updates.

### Scope

1. Conservative auto-promotion for low-risk work/project milestones.
   - Applies to `project_context`, `lesson`, and durable `fact` candidates.
   - Requires work context, confidence >= 0.85, worthiness >= 0.7, durable outcome language, and provenance such as project/repo/commit/branch/entities.

2. Auto-archive transient progress noise.
   - Archives in-progress/planned/investigating updates when no durable outcome is present.

3. Preserve sensitive review boundaries.
   - Person/property/financial/security/secret-adjacent candidates still require review.

4. Reconciler resilience.
   - Malformed optional UUID fields from model output are repaired instead of forcing unnecessary fallback review.

### Acceptance criteria

- Tests cover auto-promote for provenance-backed work milestones.
- Tests cover review for sensitive milestones.
- Tests cover archive for transient progress.
- Tests cover malformed UUID repair in reconciler output.
- Current review queue is cleared only after explicit approval.

### Suggested files

- `sofia/cloud/supabase/functions/sofia-core/router.ts`
- `sofia/cloud/supabase/functions/sofia-core/router_test.ts`
- `sofia/cloud/supabase/functions/sofia-core/reconcile.ts`
- `sofia/cloud/supabase/functions/sofia-core/reconcile_test.ts`
- `sofia/cloud/RUNBOOK.md`

---

## Phase 5 — Task/session continuity

**Status:** implemented, tested, deployed to Supabase project `avgjtkgppeeihntsyjpy`, live-verified, merged to `main`, and pushed.

**Goal:** let agents resume work across sessions from explicit task/session state, not vague memory search.

### Scope

1. Add session/task tables.
   - `agent_sessions`
   - `task_runs`
   - `task_artifacts`
   - `session_handoffs`

2. Add MCP tools for continuity.
   - start/record/end task session
   - attach artifact/commit/PR/log
   - fetch last handoff by project/entity
   - summarize active work queue

3. Connect todos to task runs.
   - Todo status transitions can reference task sessions.
   - Completed todos can link commits, migrations, deployments, or boot snapshots.

4. Add handoff compilation.
   - Generate concise project handoffs with provenance and verification status.
   - Include only live, relevant work items in boot context.

### Acceptance criteria

- Tests cover task run creation, artifact attachment, handoff generation, and todo status transitions.
- A new Hermes session can fetch a project handoff and continue without asking Justin to restate context.
- Completed task runs include verification commands/results.
- Boot context includes active handoffs only when project/entity triggers match.
- External side effects remain explicit and auditable.

### Suggested files

- `sofia/cloud/supabase/migrations/0009_task_session_continuity.sql`
- `sofia/cloud/supabase/functions/sofia-core/sessions.ts`
- `sofia/cloud/supabase/functions/sofia-core/sessions_test.ts`
- `sofia/cloud/supabase/functions/sofia-core/boot_context.ts`
- `sofia/cloud/supabase/functions/sofia-core/index.ts`

---

## Phase 6 — Contradiction detection and memory QA

**Status:** implemented, tested, deployed to Supabase project `avgjtkgppeeihntsyjpy`, live-verified, merged to `main`, and pushed.

**Goal:** detect conflicting facts proactively and keep active memory internally consistent.

### Scope

1. Add contradiction candidates.
   - Dedicated reconciliation item type for likely conflicts.
   - Store related memory IDs and proposed resolution.

2. Add memory consistency checks.
   - Pairwise checks within high-value entity/project scopes.
   - Trigger checks on new candidate capture and on entity merges.

3. Add review workflows.
   - Approve replacement.
   - Merge facts.
   - Mark old memory stale/superseded.
   - Reject candidate as incorrect.

4. Add memory QA reports.
   - stale high-priority memories
   - conflicting active memories
   - memories with weak provenance
   - boot-context memories with no recent usefulness signal

### Acceptance criteria

- Tests cover exact contradiction, softer update, duplicate, and unrelated cases.
- Conflicts create review items, not silent dual active memories.
- Approved replacement creates versions, provenance, and graph edges.
- QA report produces actionable rows with memory IDs and reasons.
- Boot context never includes both sides of an unresolved high-confidence contradiction.

### Suggested files

- `sofia/cloud/supabase/migrations/0010_contradiction_detection.sql`
- `sofia/cloud/supabase/functions/sofia-core/contradictions.ts`
- `sofia/cloud/supabase/functions/sofia-core/contradictions_test.ts`
- `sofia/cloud/supabase/functions/sofia-core/reconcile.ts`
- `sofia/cloud/supabase/functions/sofia-core/boot_context.ts`

---

## Phase 7 — Operational dashboards and daily review loop

**Goal:** make memory maintenance visible and routine.

### Scope

1. Expand Telegram digest.
   - pending review count by severity
   - stale high-priority memories
   - confusing retrievals
   - active todos due soon
   - recent boot snapshot IDs

2. Add operator SQL/report commands.
   - memory health summary
   - retrieval usefulness summary
   - provenance coverage
   - stale/superseded counts

3. Add daily/weekly review surfaces.
   - Daily: quick approvals and urgent contradictions.
   - Weekly: boot-context pruning and project/entity cleanup.

### Acceptance criteria

- Digest remains deterministic and does not call an LLM.
- Digest contains no secrets and redacts sensitive refs.
- Report tests cover empty and populated states.
- Live manual digest succeeds after deploy.
- Reports link to reviewable candidate/reconciliation IDs.

### Suggested files

- `sofia/cloud/supabase/migrations/0011_memory_ops_reports.sql`
- `sofia/cloud/supabase/functions/sofia-core/daily_digest.ts`
- `sofia/cloud/supabase/functions/sofia-core/daily_digest_test.ts`
- `sofia/cloud/RUNBOOK.md`

---

## Global definition of done

Every phase must meet all of these before being called complete:

1. **Schema:** migration is incremental, idempotent where practical, and safe against existing live data.
2. **Tests:** `mise run sofia-cloud:test` passes.
3. **Type check:** `mise run sofia-cloud:check` passes.
4. **Whitespace:** `git diff --check -- sofia/cloud` passes.
5. **Docs:** README or RUNBOOK updated for new operator behavior.
6. **Deploy:** migration applied and Edge Function deployed when runtime changes require it.
7. **Live health:** `mise run sofia-cloud:health` passes after deploy.
8. **Live smoke:** at least one relevant MCP/API call proves the feature works in production.
9. **Auditability:** new behavior writes provenance, telemetry, snapshot, reconciliation, or task-run rows as appropriate.
10. **Safety:** no secrets in logs, docs, memories, commits, or chat.
11. **Commit hygiene:** commit uses conventional style and does not include unrelated dirty files.
12. **Handoff:** final summary names branch, commit, migrations, verification outputs, and remaining work.

---

## Tracking approach

Best near-term tracking:

1. Keep this file as the durable roadmap and decision artifact.
2. For each phase, create a short implementation plan before coding.
3. Commit roadmap/plan updates with the code they guide.
4. Capture major completed phases into SOFIA Cloud memory.
5. Use SOFIA review candidates for durable lessons and project milestones.

Best long-term tracking:

1. Build Phase 5 session/task continuity.
2. Store concrete work items in SOFIA `todos`.
3. Link todos to entity/project, memory, task run, commit, migration, deployment, and boot snapshot IDs.
4. Let boot context include only active relevant task handoffs.
5. Use retrieval telemetry and feedback to decide which roadmap facts remain boot-worthy.

Recommended operating cadence:

- **Before a phase:** write/approve a phase implementation plan.
- **During a phase:** update one todo/task at a time, TDD-first.
- **After a phase:** run full verification, deploy if needed, capture a concise SOFIA project-context event, and update this roadmap status.

---

## Immediate next phase recommendation

Start with **Phase 7 — Operational dashboards and daily review loop**.

Reason: Phases 1–6 established the agent-native memory graph, lifecycle automation, retrieval policy telemetry, task/session handoffs, and contradiction QA. The next unlock is making maintenance routine and visible: deterministic daily digest, operator health reports, contradiction/review counts, stale high-priority memories, confusing retrievals, and boot snapshot links.

## Post-Phase 7 candidate — Emoji reaction learning

Hermes Agent issue #18408 proposes Telegram emoji reaction learning: reactions on bot messages become opt-in implicit feedback for user preferences, response style, skill behavior, and quick emoji-based confirmations. SOFIA Cloud is a natural persistence/reconciliation layer for this because it already has raw captures, candidate extraction, durable memories, task/session handoffs, retrieval telemetry, provenance, and QA review surfaces.

Potential SOFIA implementation:

- Add append-only `reaction_events` for Telegram `message_reaction` updates with user, message, emoji, timestamp, session/task context, and redacted message preview.
- Add `reaction_analyses` for classifier output: sentiment, confidence, category, what worked/failed, and suggested preference update.
- Add `learned_preferences` or reuse memory candidates for stable patterns only after thresholds are met; single reactions stay telemetry, not durable memory.
- Feed positive/negative patterns into retrieval policy, boot context, skill prompts, and Phase 7 digest/QA reports.
- Keep the feature opt-in and privacy-bounded: DM/user-owned reactions only by default; group reactions ignored unless explicitly enabled.
- Treat negative/ambiguous reactions as review/QA signals, not automatic destructive edits to SOFIA memory.
