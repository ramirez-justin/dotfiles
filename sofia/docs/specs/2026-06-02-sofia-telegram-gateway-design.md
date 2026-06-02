# SOFIA Telegram Gateway — Design

- **Status:** draft
- **Date:** 2026-06-02
- **Decision:** Build a dedicated SOFIA gateway, informed by Hermes patterns,
  instead of adopting Hermes as the runtime core.

## Summary

SOFIA should become reachable from Telegram as a first-class, stateful
conversational client. The gateway will run locally on Justin's machine first
and later move to a VPS. SOFIA Cloud/Postgres remains the canonical memory,
review, and conversation state system.

The gateway must prioritize security over convenience. It should fail closed,
accept messages only from explicitly authorized Telegram identities, keep
secrets out of logs and memory, use deterministic handlers for mutations, and
write an audit trail for inbound messages and resulting actions.

## Goals

- Let Justin talk to SOFIA from Telegram with natural back-and-forth text.
- Support capture, search, candidate review, approve/reject/archive/edit flows,
  and digest requests.
- Keep SOFIA Cloud canonical for memory, review state, session state, and audit
  logs.
- Run locally via long polling now; support VPS/webhook deployment later.
- Use OpenRouter/LLMs for intent classification and response drafting only
  behind deterministic safety gates.
- Make every mutation explainable and auditable.

## Non-goals

- Replacing Pi as the coding-agent shell.
- Replacing SOFIA Cloud/Postgres with Hermes or another agent memory system.
- Giving Telegram arbitrary shell/tool access.
- Multi-user public bot support.
- Fully autonomous external actions without explicit confirmation.

## Why not Hermes as the core

Hermes Agent is useful prior art. It already has Telegram gateway support, local
service install, polling/webhook modes, allowlists, pairing, sessions, MCP
support, and command approvals.

However, Hermes has its own always-on memory system (`MEMORY.md`/`USER.md`) and
its external memory providers run alongside that built-in memory rather than
replacing it. That creates split-brain risk for SOFIA, whose architecture
requires SOFIA Cloud/Postgres to be canonical.

The design should borrow Hermes patterns but not put Hermes between Justin and
SOFIA unless a future spike proves it can operate strictly as a gateway shell
without owning memory or state.

## Architecture

```text
Telegram
  ↓ long polling now / webhook later
SOFIA Telegram Gateway
  ↓ authenticated SOFIA Cloud API/MCP calls
SOFIA Cloud Edge Function + Postgres
  ↓
events, memories, candidates, telegram session state, audit logs
```

### Runtime placement

Initial runtime:

- Local daemon on Justin's machine.
- Telegram long polling.
- Managed by `mise` task first, then launchd when stable.

Future runtime:

- VPS-hosted daemon.
- Telegram webhook mode with Telegram secret-token validation.
- Same gateway code and same SOFIA Cloud backend.

## Components

### Gateway daemon

Responsibilities:

- Read Telegram updates.
- Reject unauthorized users before processing message content.
- Deduplicate updates by Telegram `update_id`.
- Persist inbound message/audit record to SOFIA Cloud.
- Load and update conversation session state.
- Classify intent using deterministic commands and, where safe, model-assisted
  routing.
- Execute allowed SOFIA actions through explicit handlers.
- Send Telegram replies.

The daemon should not have broad local tool or shell access. Its first
implementation only needs Telegram, SOFIA Cloud, OpenRouter, and logging.

### SOFIA Cloud additions

Add tables/APIs for Telegram-specific state:

- `telegram_updates`
  - stores Telegram update id, chat id, user id, message id, received timestamp,
    processing status, and redacted text.
  - unique constraint on `update_id` for replay protection.
- `telegram_sessions`
  - one row per authorized chat/user.
  - stores current state, last review candidate ids, pending action, and
    timestamps.
- `telegram_actions`
  - audit log of interpreted intents, deterministic handler chosen, confirmation
    status, SOFIA candidate/memory ids affected, and result.

Existing SOFIA tables remain canonical for:

- raw memory events (`events`)
- memory candidates (`memory_candidates`)
- durable memories (`memories`)
- reconciliations (`memory_reconciliations`)

### Model layer

Models may help with:

- intent classification for ambiguous natural language.
- response drafting.
- converting freeform edits into proposed candidate text.

Models must not directly perform mutations. Mutation handlers are deterministic
and operate only on explicit action types:

- capture
- search
- list review candidates
- approve candidate
- reject candidate
- archive candidate
- edit candidate text, then approve or ask for confirmation
- send digest
- cancel/reset state

## Conversation states

Initial states:

- `idle`
- `reviewing_candidates`
- `awaiting_candidate_edit`
- `awaiting_confirmation`
- `searching`
- `capturing`

Examples:

```text
Justin: review
SOFIA: 3 candidates need review:
       1. Security priority for Telegram gateway
       2. Documentation of Telegram setup
       3. SOFIA review delivery decision
       Reply: approve 1, reject 2, archive 3, edit 1, or cancel.

Justin: approve 1
SOFIA: Approved candidate 1 and promoted it to durable memory.
```

```text
Justin: edit 2
SOFIA: Send the replacement text for candidate 2, or cancel.

Justin: Telegram setup docs should reference the 1Password password field for the bot token.
SOFIA: Replace candidate 2 with that text and approve it? yes/no

Justin: yes
SOFIA: Updated and approved candidate 2.
```

## Intent handling

### Deterministic commands

The gateway should recognize explicit commands first:

- `help`
- `review`
- `approve <n>`
- `reject <n>`
- `archive <n>`
- `edit <n>`
- `cancel`
- `digest`
- `search <query>`
- `remember <text>`
- `todo <text>`
- `decision <text>`

### Natural language

Natural language can map to intents, but with safety rules:

- Memory capture can proceed if the phrase clearly asks SOFIA to
  remember/capture/note something.
- Ambiguous freeform text should ask a confirmation question before capture.
- Review mutations require either explicit command syntax or a confirmation
  prompt.
- Destructive or external actions are refused or require an explicit reviewed
  confirmation.

## Security requirements

Security is the top priority.

### Authorization

- Default deny.
- Only configured Telegram chat/user ids are accepted.
- Unauthorized updates are recorded minimally, rate-limited, and ignored or
  receive a generic denial.
- Group chat support is disabled until explicitly designed.

### Replay and duplicate protection

- Store every processed Telegram `update_id`.
- Unique constraint prevents double-processing.
- Duplicate updates should be acknowledged but not re-executed.

### Secret handling

- Telegram bot token stays in 1Password/local env or VPS secret store.
- SOFIA access keys stay in 1Password/local env or VPS secret store.
- Secrets are never written to SOFIA memories, events, Telegram audit text,
  logs, or errors.
- Redaction runs before persistence of message text.

### Mutation safety

- No model-direct mutations.
- Candidate review actions use deterministic SOFIA Cloud handlers.
- Ambiguous actions require confirmation.
- Risky or external actions are out of scope for the gateway until separately
  designed.

### Auditing

For each inbound message, log:

- Telegram update id.
- Authorized chat/user id.
- redacted message text.
- interpreted intent.
- handler used.
- SOFIA object ids affected.
- result status and error class if any.

### Rate limits

- Per-chat inbound message rate limit.
- Separate rate limit for mutation actions.
- Backoff on Telegram or SOFIA Cloud errors.

## Data flow

### Capture

1. Justin sends `remember <text>` or similar.
2. Gateway authorizes and deduplicates update.
3. Gateway redacts text and records Telegram update.
4. Gateway calls SOFIA `capture_event` with source `telegram`.
5. SOFIA Cloud performs existing redaction/classification/reconciliation.
6. Gateway replies with event id, auto-promoted memories, and pending
   candidates.

### Review list

1. Justin sends `review`.
2. Gateway loads pending review candidates from SOFIA Cloud.
3. Gateway stores displayed candidate ids in
   `telegram_sessions.last_candidate_ids`.
4. Gateway sends numbered review list.

### Approve/reject/archive

1. Justin sends `approve 1`.
2. Gateway resolves `1` against last displayed candidate ids.
3. Gateway calls SOFIA review handler.
4. Gateway records action audit.
5. Gateway replies with result.

### Edit candidate

1. Justin sends `edit 1`.
2. Gateway stores pending action and enters `awaiting_candidate_edit`.
3. Justin sends replacement text.
4. Gateway previews the replacement and asks for confirmation.
5. On `yes`, gateway applies deterministic edit-and-approve handler.

## Error handling

- If SOFIA Cloud is unavailable, reply that SOFIA Cloud is unreachable and no
  mutation occurred.
- If Telegram send fails, keep action audit and retry according to Telegram-safe
  backoff.
- If a candidate number no longer maps to an active candidate, ask Justin to run
  `review` again.
- If a model call fails, fall back to deterministic command handling and ask a
  clarifying question.
- If state is inconsistent, reset to `idle` and explain what happened.

## Testing strategy

- Unit tests for command parsing and state transitions.
- Unit tests for authorization and update deduplication.
- Unit tests for redaction-before-persistence behavior.
- Integration tests with mocked Telegram API.
- Integration tests with mocked SOFIA Cloud API/MCP responses.
- Migration tests for Telegram tables and constraints.
- Manual smoke test using Justin's bot and chat id.

## Deployment plan

### Local first

- Add `mise run sofia-telegram:dev` for foreground polling.
- Add `mise run sofia-telegram:install` when launchd plist is ready.
- Keep logs local and sanitized.

### VPS later

- Run same daemon under systemd.
- Use webhook mode with Telegram secret-token validation.
- Store secrets in VPS secret manager or encrypted environment file.
- Add health endpoint and uptime monitoring.

## Open decisions

- Whether the gateway uses SOFIA Cloud MCP directly or a small typed HTTP API
  for Telegram operations.
- Whether natural-language intent classification is model-backed from the first
  implementation or added after deterministic command flows pass tests.
- Whether scheduled digests remain in Supabase cron or eventually move into the
  gateway runtime.

## Acceptance criteria

- Justin can send Telegram messages that SOFIA processes securely.
- Unauthorized Telegram users cannot interact with SOFIA.
- Justin can capture memories, decisions, and todos from Telegram.
- Justin can list, approve, reject, archive, and edit pending candidates from
  Telegram.
- Every mutation is audited in SOFIA Cloud.
- Gateway restart does not lose review state.
- No secrets appear in logs, events, memories, or Telegram replies.
- Local polling works now, and the design has a clear VPS/webhook path.
