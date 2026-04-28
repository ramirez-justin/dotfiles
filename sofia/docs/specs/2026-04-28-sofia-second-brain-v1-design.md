# SOFIA Second Brain — v1 Design

- **Status:** approved (design phase complete; ready for implementation planning)
- **Date:** 2026-04-28
- **Author:** Justin Ramirez (with Claude Code)
- **Vault:** `~/dev/SOFIA/` ("SOFIA" = Synthesized Organization For Indexed Annotations)

## Summary

A reactive, hybrid-searchable second brain layered onto an Obsidian vault. v1 is the foundation: persistent memory loaded into every Claude Code session via hooks, daily logs auto-captured at session boundaries, durable insights manually promoted into a curated memory file, and a fully-local hybrid search (vector + keyword) over the entire vault. Personal and work contexts coexist in one vault, separated at the agent layer.

The system is _reactive only_ — it never runs unprompted. v2 adds an automated daily reflection job; v3 adds proactive heartbeat polling and integrations.

## Goals

- **Persistent memory across sessions.** Every Claude Code session starts with the same identity (`SOUL.md`), user profile (`USER.md`), and durable memory (`memory/{context}.md`) loaded into context.
- **Effortless capture.** A `sofia-journal` skill writes to today's daily log in one command; hooks auto-record session boundaries.
- **High-signal retention.** A `sofia-promote` skill turns daily logs into curated entries in `memory/{context}.md` interactively.
- **Searchable across the full vault.** Hybrid search (0.7 vector + 0.3 keyword) returns ranked results in under 100ms.
- **Personal/work separation in one vault.** Single source of truth, partitioned at the agent layer; auto-detected from `$PWD`.
- **Reproducible from source.** Code/config in dotfiles; index regenerable from vault content.

## Non-goals (v1)

- Proactive monitoring, polling, or notifications (deferred to v3)
- Automated promotion / daily reflection (deferred to v2)
- LLM-summarized session transcripts at hook time (PreCompact / SessionEnd are dumb pointers)
- Slack chat interface or any chat surface (deferred to v3)
- Direct integrations with Gmail / Calendar / Trello / Asana / etc. (deferred to v3)
- Per-context separate databases or encryption beyond FileVault
- Embedding model upgrades or remote embedding APIs
- Multi-vault or cross-vault federation
- A full Claude Code plugin packaging (defer until v3+)

## Architecture overview

Three planes:

```
┌─────────────────────────────────────────────────────────────┐
│  CONTROL PLANE  — Claude Code session (interactive)         │
│  • SessionStart hook injects identity + memory into context │
│  • PreCompact / SessionEnd hooks persist session → daily/   │
│  • Skills (sofia-*) operate on the vault                    │
└──────────────────────────┬──────────────────────────────────┘
                           │ reads/writes
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  STATE PLANE  — Obsidian vault (~/dev/SOFIA/)               │
│  • _agent/SOUL.md, USER.md             (identity)           │
│  • _agent/memory/{personal,work}.md    (durable memory)     │
│  • _agent/daily/{personal,work}/...md  (session logs)       │
│  • _agent/plans/{personal,work}/...md  (active plans)       │
│  • inbox/, projects/                   (user content)       │
└──────────────────────────┬──────────────────────────────────┘
                           │ indexed by
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  RETRIEVAL PLANE  — Hybrid search (background)              │
│  • SQLite (sqlite-vec + FTS5) at ~/.local/share/sofia/      │
│  • FastEmbed all-MiniLM-L6-v2 (local, ~80MB)                │
│  • fswatch + launchd → incremental indexer                  │
│  • `sofia` CLI: index, search, status, doctor               │
└─────────────────────────────────────────────────────────────┘
```

### Invariants

1. **The vault is the source of truth.** Search index, model cache, and hook state all live outside the vault and are regenerable from vault contents.
2. **Agent writes only inside `_agent/`.** User-curated content (`inbox/`, `projects/`) is never modified by hooks or skills.
3. **Hooks are global with context detection.** They fire in every Claude Code session. Context (`personal | work`) is inferred from `$PWD` (with `$SOFIA_CONTEXT` as override). No path-based denylist.
4. **Skills live globally** under `~/.claude/skills/sofia-<name>/SKILL.md`, stowed via dotfiles. Vault location passed via `$SOFIA_VAULT`; REST API access via `$OBSIDIAN_API_*` envs.
5. **Search is fully local.** No outbound network calls for embeddings or retrieval. Privacy by default; works offline.

## Vault layout

```
SOFIA/
├── SOFIA.md                              # vault README
├── _agent/                               # agent-owned, writes here only
│   ├── SOUL.md                           # identity, operating rules (universal)
│   ├── USER.md                           # user profile (universal, w/ Personal/Work sections)
│   ├── memory/
│   │   ├── personal.md                   # personal durable memory
│   │   └── work.md                       # work durable memory
│   ├── daily/
│   │   ├── personal/YYYY-MM-DD.md        # personal session logs
│   │   └── work/YYYY-MM-DD.md            # work session logs
│   ├── plans/
│   │   ├── personal/<project>.md
│   │   └── work/<project>.md
│   └── skills/                           # reserved (future per-vault skills)
├── inbox/                                # user capture; agent reads, never writes
└── projects/                             # user projects; agent reads, never writes
```

Notes:

- `_` prefix sorts agent files to the bottom in Obsidian's file explorer.
- The empty `_agent/heartbeat/` and `_agent/context/` from the original scaffold are dropped in v1; `heartbeat/` returns in v3.
- `projects/` is retained as a user-facing space but its actual usage is unproven — revisit after 30 days of v1 use.

### Frontmatter conventions

All files under `_agent/` use:

```yaml
---
type: soul | user | memory | daily | plan
context: personal | work | universal
agent-managed: true
last-touched: YYYY-MM-DD
sofia-index: true # default; set false to skip indexing
---
```

`type` is what skills filter on. `context` partitions the agent layer. `sofia-index: false` is the per-file opt-out for the indexer.

### File semantics

| File                        | Lifecycle            | Written by                                                    | Loaded into context?           |
| --------------------------- | -------------------- | ------------------------------------------------------------- | ------------------------------ |
| `SOUL.md`                   | stable, hand-edited  | user (manual)                                                 | yes, every SessionStart        |
| `USER.md`                   | evolves, hand-edited | user (manual)                                                 | yes, every SessionStart        |
| `memory/{ctx}.md`           | curated              | `sofia-promote` (with user confirmation); v2 daily reflection | yes, the matching context only |
| `daily/{ctx}/YYYY-MM-DD.md` | append-only          | `sofia-journal`, hooks                                        | no (search-retrieved)          |
| `plans/{ctx}/<project>.md`  | living docs          | `sofia-plan` or hand                                          | no (search-retrieved)          |

## Hooks

Three hooks, all global, all gated by a single context-detection step at the top.

### Context detection (every hook)

Resolution priority (matches skills): **explicit env override > PWD inference > personal default.**

```bash
#!/usr/bin/env bash
set -uo pipefail                                # NOT -e: hook errors must never block sessions
input="$(cat)"                                  # Claude Code passes JSON on stdin
cwd="$(echo "$input" | jq -r '.cwd // empty' 2>/dev/null || echo "")"

if [[ -n "${SOFIA_CONTEXT:-}" ]]; then
  context="$SOFIA_CONTEXT"                      # explicit override wins
else
  shopt -s nocasematch                          # macOS APFS is case-insensitive
  if [[ "$cwd" == "$HOME/telophaseqs"* ]] || [[ "$cwd" == *"/SOFIA/"*"/work/"* ]]; then
    context=work
  else
    context=personal
  fi
  shopt -u nocasematch
fi
```

The hook deliberately drops `-e` from `set` so a downstream failure (missing file, parsing glitch) cannot block session startup. All errors log to `~/.local/state/sofia/hooks.log` and the hook exits 0.

### SessionStart — `sofia-session-start.sh`

Loads identity + the matching context's memory into the session.

1. Run context detection (above).
2. Read `_agent/SOUL.md`, `_agent/USER.md`, `_agent/memory/${context}.md`.
3. Apply size budget: cap total injected content at **8000 tokens (~32 KB)**. SOUL + USER are usually small (<2k tokens combined). MEMORY truncates to the most recent 20 entries if over budget.
4. Output JSON with `hookSpecificOutput.additionalContext` containing assembled markdown:

   ```markdown
   # SOFIA — your second brain context (context: <personal|work>)

   ## SOUL (identity + rules)

   <contents of SOUL.md>

   ## USER (profile)

   <contents of USER.md>

   ## MEMORY (recent durable insights, newest first)

   <top N entries until budget hit>

   ---

   Vault: /Users/justinramirez/dev/SOFIA
   For full memory, search with `sofia-search` or read files directly.
   ```

5. Failure mode: if any file is missing or unreadable, log to `~/.local/state/sofia/hooks.log` and continue with whatever was readable.

Performance target: <200ms end-to-end.

### PreCompact — `sofia-pre-compact.sh`

Persists a recoverable pointer to the conversation before auto-compact wipes context.

1. Run context detection.
2. Append a single timestamped section to `_agent/daily/${context}/YYYY-MM-DD.md`:

   ```markdown
   ## HH:MM · session pre-compact

   - Transcript: <transcript_path>
   - Session ID: <session_id>
   - CWD: <cwd>
   - Trigger: <auto | manual>
   ```

3. **No LLM summarization in v1.** Lazy: the user can run `sofia-promote` later to read the transcript and pull insights.

Rationale: $0 marginal cost, hook stays fast (<50ms), avoids API rate-limit risk during compaction. Trade-off: less rich automatic summaries. v2's daily-reflection job is the natural place to add LLM summarization.

### SessionEnd — `sofia-session-end.sh`

Marks session boundary in the daily log.

1. Run context detection.
2. Append:

   ```markdown
   ## HH:MM · session end

   - Reason: <clear | logout | exit | other>
   - Transcript: <transcript_path>
   - Session ID: <session_id>
   - CWD: <cwd>
   ```

Performance target: <50ms.

### Implementation language

- **Bash** for the context-detection gate and the simple "append a section" logic in PreCompact / SessionEnd. Tiny, no dependencies.
- **Python** (via `uv run`) for SessionStart's content assembly + budget logic. Lives in `~/.local/share/sofia/src/sofia/hooks/session_start.py`.
- Bash hook scripts in `~/.claude/hooks/` are thin wrappers that gate then exec the Python where needed.

### Settings.json registration

Edited in two places (matching existing `op://` ref convention):

- `~/.claude/settings.json` (live)
- `dotfiles/claude/.claude/settings.json` (template; in `.stow-local-ignore`)

```json
"env": {
  ...,
  "SOFIA_VAULT": "/Users/justinramirez/dev/SOFIA"
},
"hooks": {
  "SessionStart": [{"hooks": [{"type": "command", "command": "$HOME/.claude/hooks/sofia-session-start.sh"}]}],
  "PreCompact":   [{"hooks": [{"type": "command", "command": "$HOME/.claude/hooks/sofia-pre-compact.sh"}]}],
  "SessionEnd":   [{"hooks": [{"type": "command", "command": "$HOME/.claude/hooks/sofia-session-end.sh"}]}],
  "Stop":         [{"hooks": [{"type": "command", "command": "afplay /System/Library/Sounds/Submarine.aiff"}]}]
}
```

The existing Stop hook (submarine sound) stays.

## Search infrastructure

### Storage

```
~/.local/share/sofia/index.db             # SQLite + sqlite-vec + FTS5; same sensitivity as vault
~/.cache/fastembed/models/                # ONNX, ~80MB, public model, regenerable
~/.local/state/sofia/indexer.log          # rotated daily
~/.local/state/sofia/state.json           # last full-index timestamp, etc.
```

The `index.db` is a chunked copy of vault contents — treat with the same sensitivity as the vault. Local-only, FileVault-encrypted, never synced or pushed.

### Schema

```sql
documents (
  path          TEXT PRIMARY KEY,        -- relative to $SOFIA_VAULT
  context       TEXT,                    -- personal | work | universal | none
  type          TEXT,                    -- soul | user | memory | daily | plan | inbox | project | other
  mtime         INTEGER,
  content_hash  TEXT,                    -- sha256 of contents; used for dedup
  indexed_at    INTEGER
);

chunks (
  id          INTEGER PRIMARY KEY,
  doc_path    TEXT REFERENCES documents(path) ON DELETE CASCADE,
  chunk_idx   INTEGER,
  heading     TEXT,                      -- nearest H1/H2/H3 above the chunk
  text        TEXT
);

CREATE VIRTUAL TABLE chunks_vec USING vec0(
  chunk_id  INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);

CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id');
```

WAL mode enabled to reduce lock contention.

### Indexing pipeline

For each `.md` file under `$SOFIA_VAULT`:

1. **Ignore-list check.** Glob match against `config.toml` deny patterns (`.obsidian/**`, `*.secret.md`, `**/private/**`, `**/*credentials*`, `**/*token*`, `**/*api-key*`); frontmatter check `sofia-index: false`.
2. **Skip if unchanged.** Compare `content_hash` against DB; no-op on identical content.
3. **Parse frontmatter.** Extract `type`, `context`, etc.
4. **Chunk.** Split by markdown headings (H1/H2/H3); each chunk capped at ~512 tokens with 64-token overlap; store nearest heading as the chunk's `heading`.
5. **Embed.** Single batched FastEmbed call across all chunks for the file.
6. **Upsert.** Transactionally write `documents`, `chunks`, `chunks_vec`, `chunks_fts`. Old chunks for the doc are deleted first so a doc shrinking doesn't leave orphans.

### Hybrid query

```python
qvec = embed(query)
ftq = sanitize_fts5(query)

vec_hits = db.execute(
    "SELECT chunk_id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = 50",
    [qvec]
)
fts_hits = db.execute(
    "SELECT rowid AS id, bm25(chunks_fts) AS rank FROM chunks_fts "
    "WHERE chunks_fts MATCH ? LIMIT 50",
    [ftq]
)

# normalize each set to [0, 1]
# combined_score = 0.7 * vec_score + 0.3 * keyword_score
# tiebreak by document mtime (newer wins)
# return top 20 with (path, heading, snippet, score, context, type)
```

Snippet = chunk text trimmed to ~200 chars around the strongest match.

### File watcher

`~/Library/LaunchAgents/com.sofia.indexer.plist` runs a long-lived `fswatch` invocation:

```sh
fswatch -o "$SOFIA_VAULT" | xargs -n1 -I{} sofia index --incremental
```

`fswatch` (vs. launchd's built-in `WatchPaths`) catches deep recursive file changes reliably. Indexer is idempotent via `content_hash`. Throttling/coalescing handled by the indexer's batching, not by `fswatch`.

### CLI (`sofia`)

```
sofia init                                  # create DB, download embed model, smoke-test
sofia index                                 # full incremental walk (default)
sofia index --rebuild                       # drop + recreate from scratch
sofia index --incremental                   # only re-index files with changed mtime
sofia search "query" [opts]                 # hybrid search
  --context personal|work|both              # default: from SOFIA_CONTEXT or PWD
  --type memory|daily|plan|...              # filter by file type
  --limit N                                 # default 20
sofia status                                # doc count, last index, oldest entry, DB size
sofia doctor                                # health check: model present, DB writable, fswatch running
```

Built with `typer` (CLI shell) and `uv` (env management). Single binary entry; subcommands dispatched in `cli.py`.

### Performance targets

- Initial full index: ~30s for 1000 small files
- Incremental on save: <500ms (one file, ~5 chunks, one embed call)
- Search query: <100ms p95 at 1000-doc / ~5000-chunk scale
- DB size: ~1.5KB per chunk; 5000 chunks ≈ 8 MB

### Failure modes

- **Model not yet downloaded:** `sofia search` exits 1 with "run `sofia init` first".
- **DB locked:** retry once with backoff (rare under WAL), then fail.
- **fswatch dies:** indexer goes stale; `sofia status` flags it; `sofia doctor` re-launches the LaunchAgent.
- **Corrupt index:** `sofia index --rebuild` always works. Vault is the source of truth.

## Skills (v1: 7 skills)

Each skill is `~/.claude/skills/sofia-<name>/SKILL.md`. All skills resolve context in priority: explicit `--context` flag > `$SOFIA_CONTEXT` env > PWD detection > `personal` default.

| Skill                      | Reads                                                                                                            | Writes                                                                               | Behavior                                                                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sofia-init`               | existing `_agent/SOUL.md`/`USER.md` if present, dotfiles `claude/.claude/CLAUDE.md`, current session context     | `_agent/SOUL.md`, `_agent/USER.md`                                                   | Interactive interview (~8-10 questions) across SOUL phase + USER phase. Drafts both files, shows diff, prompts to accept/edit. Detects existing files and offers refresh/extend.                                                                                                 |
| `sofia-search "query"`     | invokes `sofia search` CLI                                                                                       | nothing                                                                              | Formats CLI JSON as ranked list with snippets + Obsidian URIs (`obsidian://open?vault=SOFIA&file=...`). For ambiguous queries, Claude synthesizes a 1-sentence summary across top results.                                                                                       |
| `sofia-journal "<text>"`   | today's daily log if exists                                                                                      | appends `## HH:MM` section to `_agent/daily/${context}/YYYY-MM-DD.md`                | Zero ceremony. Multi-line input. Optional `--type decision\|note\|todo` for downstream filtering.                                                                                                                                                                                |
| `sofia-promote [--days N]` | last N days of `_agent/daily/${context}/`, current `memory/${context}.md`                                        | appends curated entries to `memory/${context}.md`                                    | Claude identifies promotion candidates from daily logs, presents as checklist with proposed phrasing, user accepts/edits/rejects. Each entry: type (decision\|lesson\|fact), 1-3 sentence distillation, `Source: [[daily/...]]` backlink. v1 stand-in for v2's daily reflection. |
| `sofia-plan <project>`     | `_agent/plans/${context}/<project>.md` if exists, related daily entries                                          | creates from template if missing; opens for editing                                  | Treats the plan as the active doc for the session; `last-touched` frontmatter updates on close.                                                                                                                                                                                  |
| `sofia-status`             | SOUL.md, USER.md, `memory/${context}.md`, last 7 days of daily logs, all plans where `status: active`            | nothing                                                                              | One-page digest: active plans (titles + last-touched + 1-line status), recent decisions (top 5), recent activity highlights, stale items (active plans not touched in 14+ days).                                                                                                 |
| `sofia-link [path]`        | target note (specified or current Obsidian active note via REST API), `sofia search` results for similar content | edits target file to insert `[[...]]` backlinks (after user accepts each suggestion) | Hybrid search using note content as query. Top N candidates presented with confidence scores and proposed link locations. User accepts/rejects per-suggestion; edits applied as a batch.                                                                                         |

### Common patterns

- **Dry-run flag** on every write-skill (`journal`, `promote`, `plan`, `link`): prints what it would write.
- **Idempotency for writes:** `sofia-journal` deduplicates exact-content same-minute entries; `sofia-promote` won't re-add an entry already in `memory/${context}.md` (matches by source line link).
- **No silent network calls.** v1 skills only hit the local Obsidian REST API and the local `sofia` CLI.

## Dotfiles topology

New `sofia/` topic in `~/dev/dotfiles/`:

```
dotfiles/sofia/
├── .stow-local-ignore                    # excludes __pycache__/, *.pyc, etc.
├── .config/sofia/
│   └── config.toml                       # vault path, model name, search weights, ignore patterns
├── .local/bin/
│   └── sofia                             # bash wrapper → uv run python -m sofia.cli
├── .local/share/sofia/src/
│   ├── pyproject.toml                    # uv-managed: fastembed, sqlite-vec, typer, etc.
│   ├── uv.lock
│   └── sofia/
│       ├── __init__.py
│       ├── cli.py
│       ├── config.py
│       ├── chunker.py
│       ├── embedder.py
│       ├── indexer.py
│       ├── search.py
│       ├── db.py
│       └── hooks/
│           ├── session_start.py
│           ├── pre_compact.py
│           └── session_end.py
├── .claude/
│   ├── skills/sofia-{init,search,journal,promote,plan,status,link}/SKILL.md
│   └── hooks/
│       ├── sofia-session-start.sh
│       ├── sofia-pre-compact.sh
│       └── sofia-session-end.sh
├── Library/LaunchAgents/
│   └── com.sofia.indexer.plist
└── docs/specs/
    └── 2026-04-28-sofia-second-brain-v1-design.md   # this file
```

Stow links into `$HOME` as expected: `.local/bin/sofia → ~/.local/bin/sofia`, etc.

### `mise.toml` additions

Add `sofia` to `link` and `unlink` task lists. New tasks:

```toml
[tasks.sofia-init]
description = "Bootstrap SOFIA second brain (deps, DB, LaunchAgent)"
run = """
set -e
cd ~/.local/share/sofia/src && uv sync
~/.local/bin/sofia init
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.sofia.indexer.plist
launchctl enable gui/$UID/com.sofia.indexer
echo "SOFIA bootstrapped. Next: open Claude Code in ~/dev/SOFIA and run /sofia-init"
"""

[tasks.sofia-status]
description = "Check SOFIA health"
run = "~/.local/bin/sofia doctor"
```

### `Brewfile` additions

```ruby
brew "fswatch"
```

`uv` is already managed via mise; if not, add to `mise.toml [tools]`.

## Bootstrap & operations

### Fresh setup

1. `mise run link` — stow the new `sofia` topic
2. `mise run brew-install` — fswatch installs
3. `mise run sofia-init` — `uv sync`, model download, DB init, LaunchAgent load
4. Open Claude Code in `~/dev/SOFIA/` → `/sofia-init` (interactive SOUL.md / USER.md generation)
5. (optional smoke test) `/sofia-journal "first entry — second brain bootstrapped"`

### Daily-use flow

- **Any personal session anywhere:** SessionStart loads `SOUL + USER + memory/personal.md`.
- **In `~/telophaseqs`:** SessionStart loads `SOUL + USER + memory/work.md`.
- **In SOFIA vault working area for a specific context:** PWD path drives detection (`*/work/*` or `*/personal/*`).
- **Override:** `SOFIA_CONTEXT=both` for cross-context sessions.
- **Capture:** `/sofia-journal "..."` from anywhere.
- **Promote at end of day:** `/sofia-promote --days 1`.
- **Search:** `/sofia-search "..."` or `sofia search "..."` from terminal.

### Reproducibility / DR

| Asset                                    | Backup mechanism                                    |
| ---------------------------------------- | --------------------------------------------------- |
| Vault                                    | Obsidian Sync (existing)                            |
| Code/config                              | Dotfiles git remote (existing)                      |
| Index DB                                 | `sofia index --rebuild` from vault                  |
| Embed model                              | re-downloads on `sofia init`                        |
| LaunchAgent                              | re-loads via `mise run sofia-init`                  |
| 1Password creds (Obsidian REST cert/key) | Already in `dev_vault`; documented in Claude memory |

Single-command recovery on a fresh machine: `mise run bootstrap && mise run sofia-init`.

## Roadmap

### v2 — Daily Reflection (Agent SDK)

Adds the automated 8am promotion job that v1 punts to manual `sofia-promote`.

- Cron / launchd job at 8am: `sofia reflect --yesterday`
- Reads yesterday's daily log; runs `sofia-promote` logic non-interactively (or queues morning-review suggestions)
- Updates `_agent/memory/${context}.md` with auto-curated entries, idempotent against manual `sofia-promote` runs
- Adds Anthropic SDK dep, prompt engineering for promotion criteria, dedup logic

### v3 — Heartbeat + Chat + Integrations (Agent SDK)

Proactive monitoring layer.

- 30-min `heartbeat.py` polling Gmail / Calendar / Trello
- `_agent/heartbeat/HEARTBEAT.md` configurable check list
- macOS notifications + daily-log writes
- Optional Whatsapp or Signal chat interface (Agent SDK Socket Mode)
- Direct integrations module wraps existing MCP connectors with Python CLI shims (`sofia gmail today`, `sofia cal today`)
- Trello API integration (TRELLO_API_KEY already in env)

### Explicit deferrals from v1 (with rationale)

| Deferred                               | Rationale                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| LLM-summarized PreCompact / SessionEnd | $$$ on every fire; quality unproven; daily-reflection (v2) is the natural place                    |
| Hybrid-search infra (defer to v2/v3)   | **Pulled into v1 by user choice.** Originally proposed for deferral.                               |
| Automated daily promotion              | Want to prove the manual `sofia-promote` flow first; auto-promotion will inherit its prompt design |
| Heartbeat polling                      | $1.40/day cost; behavior unproven without v1's memory layer in place                               |
| signal/email/Trello integrations       | Each is its own design problem; better attacked once the brain has content to act on               |
| Per-context separate DBs / encryption  | Marginal threat improvement vs. complexity; FileVault is already the disk-level guard              |
| Embedding model upgrades               | all-MiniLM-L6-v2 is enough; revisit only if retrieval quality is the bottleneck                    |
| Plugin packaging                       | Premature; do it in v3+ when the system is stable                                                  |

### v1 → v2 graduation criteria

Before starting v2 work, confirm v1 has produced:

- [ ] **30+ days of continuous use** without major hook regressions
- [ ] **20+ daily log entries** captured (mostly via `sofia-journal`)
- [ ] **10+ curated entries** in `memory/personal.md` (and ≥3 in `memory/work.md` if work context is active)
- [ ] **Search latency stable** (<100ms p95 measured via `sofia status`)
- [ ] **Zero recurring hook failures** (per `~/.local/state/sofia/hooks.log`)
- [ ] **A clear daily-reflection workflow** has emerged from real `sofia-promote` use — i.e., we know what kind of prompt the v2 automated reflection needs to ape

If any criterion fails, the failure tells us what to fix in v1 before automating.

### Tracking the roadmap

Once v1 ships and the vault exists, the roadmap is mirrored as plan stubs in the vault itself:

- `_agent/plans/personal/sofia-v2.md` — status: paused
- `_agent/plans/personal/sofia-v3.md` — status: paused

This makes them visible to `sofia-status` and `sofia-search` — the brain knows about its own roadmap. Each is flipped to `active` when its phase begins.

## Decisions log (key choices and why)

| Decision                                                                          | Why                                                                                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Single vault, context-partitioned at agent layer (not two physical vaults)        | User owns Telophase → no data-policy blocker. Single source of truth, cross-context links possible, simpler ops.     |
| Hooks global with PWD-based context detection (not denylisted to `~/telophaseqs`) | Telophase work is _part of_ SOFIA's world; need memory loaded there too, just into the work stream.                  |
| Skills global (`~/.claude/skills/sofia-<name>/`), not vault-local                 | Symmetric with global hook scope; standard Claude Code convention; stowable via dotfiles.                            |
| `_agent/` as single agent-writable area (not vault root)                          | Enforceable invariant; `_` sorts to bottom in Obsidian; protects user-curated content.                               |
| Hybrid search in v1 (not deferred)                                                | User choice. Big enough lift it dominates v1 build effort, but enables `sofia-search` and `sofia-link` from day one. |
| FastEmbed all-MiniLM-L6-v2 (not Voyage / OpenAI)                                  | Local, private, free, offline. Cole's choice; proven adequate for vault-scale retrieval.                             |
| sqlite-vec + FTS5 (not Postgres + pgvector)                                       | Single-machine system; no need for client/server overhead. Same engine Cole uses on the local profile.               |
| `uv` for Python tooling                                                           | Fast, modern, single venv, pairs cleanly with mise.                                                                  |
| `fswatch` + launchd long-running job (not launchd `WatchPaths`)                   | `WatchPaths` doesn't recurse reliably; fswatch is the macOS-blessed answer.                                          |
| LLM summarization deferred from PreCompact / SessionEnd hooks                     | $0 marginal cost in v1; quality risk; v2's daily-reflection is the natural home.                                     |
| `_agent/heartbeat/` and `_agent/context/` dropped from v1 scaffold                | Empty placeholders rot. Re-add when their phase ships.                                                               |
| Ignore-list (frontmatter + globs) shipped in v1                                   | User request. Defends against accidental indexing of files that contain secrets.                                     |

## Open questions / things to revisit

- **`projects/` usage.** Kept in the vault layout for now but unproven. Revisit at the v2 milestone — if no notes have landed there, drop it.
- **Frontmatter on user-facing notes (`inbox/`, `projects/`).** Not enforced in v1. May want to require it later to make context-filtering more reliable in search.
- **Hook performance under load.** SessionStart's <200ms target assumes a reasonable-size `memory/{context}.md`. The 8000-token budget kicks in if it grows (top 20 entries) — but at some point we may want a digest-version cache.
- **Skill-set size.** 7 is a starting point. Likely to grow; resist over 12 without a strong daily-use case for each.
