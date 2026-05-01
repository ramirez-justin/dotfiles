# SOFIA Cloud Roadmap

- **Status:** draft
- **Date:** 2026-05-01
- **Purpose:** phased roadmap for SOFIA vNext after reviewing OB1/Open Brain

## Direction

Build SOFIA into a cloud-capable personal memory OS. Do not migrate wholesale to OB1. Use OB1 as reference architecture for Supabase/Postgres, remote MCP, adaptive capture, graph/wiki compilation, and integrations, while preserving SOFIA's stronger hybrid memory model.

North star:

```text
Raw events
→ memory candidates
→ hybrid auto-promotion/review
→ versioned durable memory
→ compiled artifacts
→ MCP/chat/Obsidian clients
```

## Design docs

- [Cloud Core Design](../specs/2026-05-01-sofia-cloud-core-design.md)
- [Memory Pipeline Design](../specs/2026-05-01-sofia-memory-pipeline-design.md)
- [MCP + Chat Automation Design](../specs/2026-05-01-sofia-mcp-chat-automation-design.md)
- [Compiled Views Design](../specs/2026-05-01-sofia-compiled-views-design.md)

## Implementation plans

- [Phase 1–2 Implementation](2026-05-01-sofia-cloud-phase-1-2-implementation.md)

## Phase 0 — Design lock

Goal: settle architecture before implementation.

Tasks:

- [ ] Review the four design docs.
- [ ] Decide Supabase-first vs local Postgres-first.
- [ ] Decide canonical source: Postgres canonical, Obsidian compiled view.
- [ ] Approve initial schema boundaries.
- [ ] Approve memory auto-promotion thresholds.
- [ ] Pick first chat adapter: Telegram vs WhatsApp.
- [ ] Decide whether existing SOFIA memory imports seed candidates or durable memories.

Exit criteria:

- Design docs approved.
- Implementation plan written.
- First milestone chosen.

## Phase 1 — Supabase/Postgres cloud core

Goal: create canonical memory database.

Deliverables:

- Supabase project or local Postgres dev target.
- SQL migrations for:
  - `events`
  - `memory_candidates`
  - `memories`
  - `memory_versions`
  - `entities`
  - join tables
  - `memory_edges`
  - `compiled_artifacts`
- content fingerprint dedup.
- pgvector search function.
- basic backup/restore notes.
- secret reference policy.

Exit criteria:

- Can insert an event.
- Can search events/memories.
- Can create a durable memory with version row.
- No secret values stored in DB.

## Phase 2 — Memory-worthiness pipeline

Goal: automatically classify and route memory candidates.

Deliverables:

- redaction filter.
- event ingestion worker/function.
- candidate extractor.
- worthiness classifier.
- confidence/risk router.
- auto-promote transaction.
- review queue data model.
- feedback/outcomes table.

Exit criteria:

- “Remember this” creates event + candidates.
- high-confidence low-risk candidate auto-promotes.
- medium/high-risk candidate appears in review queue.
- rollback works via `memory_versions`.

## Phase 3 — Remote MCP

Goal: make SOFIA available to AI clients.

Deliverables:

- Supabase Edge Function MCP server.
- Tools:
  - `capture_event`
  - `search_memory`
  - `list_recent`
  - `review_candidates`
  - `get_profile`
  - `get_artifact`
- access key auth.
- CORS/Claude Desktop compatibility.
- smoke tests from at least one AI client.

Exit criteria:

- Claude/Pi can capture to SOFIA Cloud.
- Search retrieves durable memories.
- Pending candidates can be listed and acted on.

## Phase 4 — Compiled artifacts and Obsidian export

Goal: generate SOFIA-readable files from canonical memory.

Deliverables:

- compiler for:
  - `SOUL.md`
  - `USER.md`
  - shared/personal/work memory
  - topic pages
- `compiled_artifacts` storage.
- export command to SOFIA vault.
- generated-file frontmatter policy.

Exit criteria:

- Agent boot context can come from compiled artifact.
- Obsidian files regenerate from database.
- Human-owned vault spaces are not modified.

## Phase 5 — Review workflows

Goal: make memory maintenance easy.

Deliverables:

- daily candidate review.
- weekly review.
- stale memory report.
- contradiction/supersession review.
- “undo last auto-promotion” flow.

Exit criteria:

- Justin can review candidates in under 2 minutes.
- Weekly review surfaces useful themes/open loops.
- Auto-promotions are auditable.

## Phase 6 — Chat adapter

Goal: interact with SOFIA outside coding sessions.

Recommended order:

1. Telegram
2. WhatsApp
3. Signal

Deliverables:

- webhook receiver.
- chat command grammar.
- capture flow.
- review queue buttons.
- daily/weekly proactive messages.
- quiet hours/throttle rules.

Exit criteria:

- Can text SOFIA a memory.
- Can approve/reject candidate from chat.
- Can ask a search question from chat.

## Phase 7 — Graph + wiki compiler

Goal: OB1-class synthesis layer.

Deliverables:

- entity extraction worker.
- typed memory edges.
- person/project/topic pages.
- decision history pages.
- compiled wiki manifest.

Exit criteria:

- SOFIA can generate topic/person/project dossiers.
- Contradictions/supersessions are visible.
- Wiki pages are regenerable from source data.

## Phase 8 — Importers

Goal: bring history into SOFIA without polluting durable memory.

Priority:

1. Existing SOFIA vault.
2. Claude/ChatGPT exports.
3. Gmail.
4. Calendar.
5. Notion/Obsidian imports.
6. Readwise/browser/bookmark-style sources.

Rules:

- imports create events first.
- candidate extraction runs afterward.
- durable memory only via promotion gate.
- all importers are rerunnable via fingerprints.

## Major decisions to revisit

- Supabase vs local Postgres dev-first.
- Direct OpenAI/OpenRouter/Anthropic model choices.
- Whether compiled artifacts should be committed/synced.
- Whether to expose admin MCP tools.
- Whether to make SOFIA multi-user-ready from schema day one.

## Immediate next step

After design review, write an implementation plan for Phase 1 + Phase 2 only. Do not plan all phases at task granularity yet; later phases should wait for feedback from the cloud core and pipeline.
