# SOFIA Cloud Boot Context Cutover — Design

- **Status:** approved for implementation planning
- **Date:** 2026-05-01
- **Scope:** replace local Obsidian/SOFIA-vault boot context with SOFIA Cloud boot context for Pi agents

## Summary

SOFIA agents should boot from SOFIA Cloud, not local Obsidian files. Supabase/Postgres remains canonical, `compiled_artifacts` stores generated boot/profile snapshots, and the Pi extension fetches boot context from the deployed SOFIA Cloud Edge Function at session start.

Obsidian remains useful as a human-friendly generated/readable view, but it is no longer the agent runtime memory path.

## Goals

- Make SOFIA Cloud the source of agent boot context.
- Stop using local `_agent/` files as the normal Pi session-start memory source.
- Provide a first-class cloud boot-context API/tool.
- Keep boot context compact, high-signal, and context-aware (`personal`, `work`, `shared`).
- Fail visibly if cloud boot context is unavailable instead of silently using stale local context.
- Preserve generated Obsidian/markdown as a human-facing compiled view, not the runtime brain.

## Non-goals

- Building the full Obsidian export/compiler in this slice.
- Bidirectional Obsidian sync.
- Rewriting all SOFIA capture/review workflows.
- Supporting multiple users beyond the current personal deployment.
- Keeping local Obsidian boot files as a fallback runtime path.

## Target architecture

```text
SOFIA Cloud Postgres
  ├─ durable memories
  ├─ memory candidates
  ├─ memory versions
  └─ compiled_artifacts
        ↓
compile_boot_context(context)
        ↓
get_boot_context MCP tool / HTTP endpoint
        ↓
Pi SOFIA extension session_start
        ↓
agent system prompt injection
```

Runtime rule:

```text
Cloud is the brain.
MCP/boot-context endpoint is the agent interface.
Obsidian is the human-readable generated view.
```

## Cloud API design

Add a boot-context read path to `sofia-core`.

### MCP tool

```text
get_boot_context(context: "personal" | "work" | "shared")
```

Returns formatted boot context content suitable for direct system prompt injection.

### HTTP endpoint

For the Pi extension, add a simple non-MCP endpoint:

```http
GET /boot-context?context=personal
x-sofia-key: <runtime access key>
```

Response:

```json
{
  "context": "personal",
  "content": "# SOFIA — your second brain context\n...",
  "generated_at": "2026-05-01T00:00:00Z",
  "artifact_id": "...",
  "source": "compiled_artifacts"
}
```

A plain HTTP endpoint keeps Pi boot simple and avoids requiring the extension to speak MCP JSON-RPC during session startup.

## Boot context compilation

Add an internal cloud function/module:

```ts
compileBootContext(context);
```

First implementation should be deterministic and conservative:

1. Load latest active compiled artifacts if present.
2. If missing, assemble a minimal boot context from active durable memories:
   - shared operating rules and preferences,
   - context-specific active projects and stable facts,
   - recent high-importance decisions/gotchas,
   - links/IDs back to source memories.
3. Store/update the result in `compiled_artifacts` as `boot_context.md` for that context.
4. Return the compiled artifact.

The content should preserve the existing boot marker:

```markdown
# SOFIA — your second brain context (context: personal)
```

This keeps the Pi extension’s duplicate-injection guard simple.

## Pi extension cutover

Update `pi/.pi/agent/extensions/sofia.ts`:

- Stop invoking `sofia-session-start.sh` for boot context.
- On `session_start`, fetch SOFIA Cloud `/boot-context?context=<detected-context>`.
- Store the returned content in memory for `before_agent_start` injection.
- If fetch fails, inject a short diagnostic block or fail visibly; do not fall back to local `_agent/` memory files.
- Keep duplicate marker protection.

Context detection can remain local/PWD-based for now, but the context content itself must come from cloud.

### Local hooks

For this cutover, local boot-context reading is removed. Pre-compact/session-end local journaling can be left alone temporarily only if it does not affect boot context, but the target direction is for capture/review to flow through SOFIA Cloud MCP.

## Failure behavior

Cloud boot-context failures should be obvious.

Recommended injected failure block:

```markdown
# SOFIA — cloud boot context unavailable

SOFIA Cloud boot context failed to load. Do not use local Obsidian memory as a fallback. Ask Justin whether to proceed without SOFIA context or debug SOFIA Cloud.
```

This avoids silent stale context while keeping Pi usable enough to repair the issue.

## Classifier hardening included

During design work, a live capture failed because the model returned:

```text
recommended_action: "Promote to durable memory."
```

The parser should normalize common action phrases before strict validation:

- `Promote to durable memory.` → `auto_promote`
- `promote`, `save`, `remember` → `auto_promote`
- `review`, `needs review`, `ask user` → `review`
- `archive`, `ignore` → `archive`
- `reject`, `discard` → `reject`

Unknown actions should still reject. This mirrors the existing candidate-type normalization while preserving strictness for truly unknown output.

## Security

- Reuse existing `x-sofia-key` auth.
- Do not expose service-role keys or raw embeddings.
- Boot context should omit secret-redacted raw event content.
- Boot context should include provenance IDs, not hidden sensitive source material.
- Browser/plain `GET` health behavior must remain safe.

## Testing

Cloud tests:

- `compileBootContext` creates valid markdown with the SOFIA marker.
- `get_boot_context` returns the latest artifact for the requested context.
- Missing artifact path compiles from active memories and persists `compiled_artifacts`.
- HTTP `/boot-context` rejects missing/invalid keys.
- HTTP `/boot-context` returns JSON without embeddings.
- Classifier parser normalizes verbose `recommended_action` values.

Pi tests/manual verification:

- Start Pi after deployment and environment reload/restart.
- Confirm injected prompt contains cloud boot context marker.
- Confirm local `_agent/` boot files are not read by the extension.
- Temporarily break the access key and confirm failure is visible with no local fallback.

## Rollout plan

1. Implement classifier action normalization regression fix.
2. Implement boot-context compiler and tests.
3. Add `get_boot_context` MCP tool.
4. Add HTTP `/boot-context` endpoint.
5. Deploy `sofia-core`.
6. Update Pi extension for cloud boot fetch.
7. Restart Pi and verify full cutover.
8. Archive or clearly mark local boot scripts/files as legacy after successful verification.

## Open questions

- Should `shared` always be included when requesting `personal` or `work`, or should the endpoint return exactly one context?
- Should boot context compilation happen on every request, on stale artifacts only, or via explicit operator task?
- What is the initial token/character budget for cloud boot context?

## Recommendation

Implement full cutover now: Pi session boot context should come only from SOFIA Cloud. Use the local vault and Obsidian as generated human-facing views, not as fallback runtime memory. Keep the first compiler deterministic and compact, then improve synthesis quality after real boot sessions expose what is missing.
