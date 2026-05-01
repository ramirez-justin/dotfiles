# SOFIA MCP + Chat Automation — Design

- **Status:** draft
- **Date:** 2026-05-01
- **Scope:** remote MCP tools, chat adapters, scheduled automations

## Summary

SOFIA should expose one cloud memory core through multiple thin clients: MCP for AI tools, Pi/Claude skills for coding sessions, and chat adapters for daily-life capture/review. The MCP and chat layers should not own memory logic. They should call the same SOFIA Cloud API, which writes events and lets the memory pipeline classify, promote, or queue review candidates.

## Goals

- Make SOFIA available from any MCP-capable AI client.
- Keep MCP tool count small and routing-friendly.
- Enable chat capture and review through Telegram/WhatsApp/Signal-style adapters.
- Support scheduled daily/weekly reviews and heartbeat prompts.
- Keep secrets and privileged database access server-side.

## Non-goals

- Building every chat channel at once.
- Exposing low-level database CRUD to AI clients.
- Letting chat adapters bypass the memory pipeline.
- Multi-user public bot support in the first version.

## Layers

```text
AI clients / chat channels / schedulers
        ↓
MCP server + chat adapters
        ↓
SOFIA Cloud API
        ↓
events + memory pipeline + search + artifacts
```

## MCP tool design

Tool count should stay low: 5–6 tools always-on.

### `capture_event`

Writes raw material to `events`; does not directly promote durable memory.

Parameters:

```json
{
  "content": "string",
  "context": "personal | work | shared | auto",
  "source": "string",
  "type_hint": "note | decision | todo | session_summary | import | chat",
  "metadata": {}
}
```

Returns:

- event id
- classifier status
- number of candidates extracted
- any auto-promotions
- any review-required candidates

### `search_memory`

Searches durable memories first, then candidates/events.

Parameters:

```json
{
  "query": "string",
  "context": "personal | work | shared | both",
  "types": ["decision", "preference"],
  "include_raw_events": false,
  "limit": 10
}
```

### `list_recent`

Recent events, candidates, or memories.

Parameters:

```json
{
  "kind": "events | candidates | memories | all",
  "context": "personal | work | shared | both",
  "days": 7,
  "limit": 20
}
```

### `review_candidates`

Fetches pending review candidates and optionally applies user decisions.

Actions:

```text
list
approve
edit_and_approve
reject
archive
mark_duplicate
```

### `get_profile`

Returns compiled profile context for a client/session.

Parameters:

```json
{
  "context": "personal | work | shared",
  "format": "markdown | json",
  "budget_tokens": 8000
}
```

### `get_artifact`

Fetches a compiled artifact, e.g. `USER.md`, topic page, weekly review.

## Chat adapters

Chat should be a thin adapter over the same API.

Recommended order:

1. **Telegram** — fastest iteration and best review buttons.
2. **WhatsApp** — best daily-life UX once workflow is stable.
3. **Signal** — privacy-friendly but operationally brittle.

### Telegram adapter

Use first because it supports:

- simple bot setup
- inline buttons
- quick approve/edit/reject flows
- webhooks
- low operational overhead

Example interactions:

```text
Justin: remember this: Lindsay and I both dislike farmhouse design.
SOFIA: Captured. Auto-promoted preference: “Justin and Lindsay dislike farmhouse design.”
```

```text
SOFIA: I found 3 memory candidates from today.
[1] Cloud SOFIA should use Supabase first...
[Promote] [Edit] [Reject]
```

### WhatsApp adapter

Use Twilio WhatsApp or Meta WhatsApp Cloud API.

Best for:

- daily reminders
- quick capture
- review prompts
- voice-note path later

Tradeoffs:

- account/business setup
- template message rules for proactive messages
- possible cost

### Signal adapter

Possible via `signal-cli`, but defer.

Tradeoffs:

- unofficial/brittle bridge
- persistent linked-device state
- more maintenance

## Automations

### Daily review

Schedule: evening or next morning.

Output:

- auto-promotions made
- candidates needing review
- open loops detected
- secrets/redactions detected

### Weekly review

Output:

- dominant themes
- durable memories added
- rejected/archived candidate patterns
- stale plans
- unresolved tasks/open loops
- contradictions or superseded memories
- suggested focus for next week

### Heartbeat prompts

Future automation that checks:

- calendar/context
- open loops
- stale projects
- recurring responsibilities
- user-defined watch items

Heartbeat should write events and candidate memories, not directly mutate durable memory without the pipeline.

## Authentication and secrets

- MCP access uses a revocable access key or OAuth-compatible layer later.
- Chat webhooks use platform-specific verify tokens and signing validation.
- Backend uses Supabase service role key only inside Edge Functions/workers.
- LLMs never receive service-role secrets.
- Database stores secret references only.

## Tool scoping

Avoid separate tools for every operation. Prefer generic high-level tools with action parameters. If tool count grows beyond ~10, split servers by use case:

- Capture server
- Query/review server
- Admin server

Admin tools should not be connected by default.

## Open questions

- Should chat replies be generated by the same LLM used for classification, or a cheaper conversational model?
- Should proactive chat messages require quiet hours and throttle rules?
- Do we want voice notes in the first chat version?
- Should MCP support streaming progress for long imports/reviews?

## Recommendation

Build remote MCP first, then Telegram as the first chat adapter. Keep all clients thin and force every write through `capture_event` plus the memory pipeline.
