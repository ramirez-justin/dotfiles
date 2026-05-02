# SOFIA Compiled Views — Design

- **Status:** draft
- **Date:** 2026-05-01
- **Scope:** generated Obsidian/markdown/profile artifacts from canonical SOFIA Cloud memory

## Summary

Compiled views turn SOFIA's structured memory store into readable artifacts. The
database remains canonical. Markdown files, Obsidian topic pages, weekly reviews,
and profile exports become generated artifacts that can be regenerated from source
memory.

This borrows OB1's wiki compiler direction while preserving SOFIA's existing
`SOUL.md`, `USER.md`, context memory, and topic-file workflows as transitional
formats. Long-term, agents should use SOFIA Cloud MCP and compiled boot artifacts
as their runtime interface; Obsidian is primarily the human-friendly window into
the brain, not the brain itself.

## Goals

- Generate stable agent boot context from durable memory.
- Keep Obsidian useful as a readable browsing and review surface for humans.
- Avoid making generated markdown an agent runtime dependency or source of truth.
- Make memory provenance visible in compiled artifacts.
- Support personal/work/shared context separation.
- Enable future wiki/person/project/topic pages.

## Non-goals

- Full bidirectional sync in the first iteration.
- Replacing human-authored Obsidian notes.
- Making generated files indistinguishable from human-authored files.
- Making local Obsidian search/indexing the primary agent memory runtime.
- Compiling every raw event into markdown.

## Architecture

```text
Postgres canonical memory
  ↓
compiler jobs
  ↓
compiled_artifacts table
  ↓
agent/runtime targets
  ├─ MCP get_boot_context/get_artifact
  └─ chat/session boot payloads
  ↓
human/export targets
  ├─ SOFIA vault _agent/generated/ files
  ├─ Obsidian topic/person/project pages
  ├─ chat review summaries
  └─ future dashboard/wiki
```

## Artifact classes

### Boot artifacts

Used by agents at session start. These should be served from SOFIA Cloud via MCP
or generated from `compiled_artifacts`, not discovered through local Obsidian
search.

- `SOUL.md`
- `USER.md`
- `memory/shared.md`
- `memory/personal.md`
- `memory/work.md`
- future compact JSON form for non-markdown clients

These should stay compact and high-signal.

### Topic artifacts

Generated topic/project/person summaries.

Examples:

- `topics/sofia-system.md`
- `topics/real-estate.md`
- `topics/home-design.md`
- `topics/telophase-data-platform.md`

### Review artifacts

Periodic syntheses.

- daily review
- weekly review
- monthly memory audit
- stale memory report
- contradiction report

### Export artifacts

Portable bundles for other AI clients.

- `operating-model.json`
- `USER.md`
- `SOUL.md`
- `HEARTBEAT.md`
- `schedule-recommendations.json`

## Generated file policy

All generated files should include frontmatter:

```yaml
---
type: compiled-artifact
context: personal
generated-by: sofia-cloud
artifact-id: <uuid>
source: postgres
last-compiled: 2026-05-01T00:00:00Z
human-edit-policy: do-not-edit-generated-section
---
```

For files that may include human notes, use fenced generated regions:

```markdown
<!-- SOFIA:BEGIN GENERATED artifact-id=... -->

Generated content here.

<!-- SOFIA:END GENERATED -->

## Human notes

Human-owned content here.
```

First iteration should prefer fully generated files under `_agent/generated/` or clearly marked `_agent/memory/` artifacts to avoid ownership ambiguity.

## Compilation rules

### `SOUL.md`

Source categories:

- operating rules
- safety constraints
- tone/style preferences
- memory architecture rules
- secret-handling rules

Require review before changing identity-shaping sections.

### `USER.md`

Source categories:

- stable user facts
- active projects
- people/family/work context
- working style
- recurring cadences

Sensitive or inferred user facts require review.

### Context memory files

`shared.md`, `personal.md`, and `work.md` should be boot routers, not content dumps.

Include:

- active now
- stable compact summary
- links/references to topic artifacts
- recent high-importance decisions

Exclude:

- raw events
- long histories
- low-confidence candidates

### Topic files

Topic files are compiled from:

- active durable memories tagged to topic entities
- related decisions
- supersession edges
- recent review summaries

Each claim should include source memory IDs or backlinks.

## Export targets

### Obsidian vault

The compiler writes generated artifacts to the SOFIA vault for human browsing,
review, and portability. Human-owned spaces remain read-by-default. Agents should
not treat Obsidian as canonical or depend on local vault search for durable memory
once cloud boot context is wired.

Preferred target:

```text
SOFIA/_agent/generated/
SOFIA/_agent/memory/
SOFIA/_agent/memory/topics/
```

### MCP

`get_boot_context` and `get_artifact` read from `compiled_artifacts` directly.
Agents should prefer these tools over local Obsidian reads for boot/runtime
context. Local markdown can remain a fallback during migration but should not be
the long-term interface.

### Chat

Daily/weekly summaries can be compiled and sent as chat messages.

## Rebuild behavior

Compiled artifacts are disposable. If wrong, fix source memory/candidates and regenerate.

Commands eventually:

```bash
sofia compile profile --context personal
sofia compile topic sofia-system
sofia compile weekly-review --days 7
sofia export obsidian
```

## Human edit policy

Phase 1:

- generated files are overwritten by compiler
- human edits to generated regions are not preserved
- human-owned notes are not modified
- human changes to canonical memory go through SOFIA Cloud capture/review/update flows

Future:

- import human edits as new events/candidates
- support diff-based review before overwriting

## Failure modes

| Failure                               | Mitigation                                            |
| ------------------------------------- | ----------------------------------------------------- |
| Generated file overwrites human notes | write only under `_agent/`; clear frontmatter         |
| Boot context grows too large          | token budget + topic links                            |
| Artifact repeats stale memory         | stale/superseded filters                              |
| Human edits lost                      | generated-only policy until bidirectional sync exists |
| Artifact hides provenance             | include source IDs/backlinks                          |

## Open questions

- Should existing `_agent/memory/topics/*.md` become generated, semi-generated, or human-curated during migration?
- Should compiled artifacts be committed to dotfiles/vault sync, or regenerated per environment?
- How should Obsidian backlinks point to database-backed memories?
- What is the minimum boot artifact set needed to replace local SOFIA session-start context?
- Do we want a dashboard before or after generated Obsidian views?

## Recommendation

Treat Postgres as canonical, MCP/compiled artifacts as the agent runtime interface,
and Obsidian as a compiled/readable human interface. Keep generated artifacts
visibly generated, preserve provenance, and defer bidirectional sync until the
one-way compiler is stable. Local Obsidian search/indexing can stay as a migration
fallback, but it should not be the long-term memory path for agents.
