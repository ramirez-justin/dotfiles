# SOFIA Memory Pipeline — Design

- **Status:** draft
- **Date:** 2026-05-01
- **Scope:** automatic memory-worthiness, hybrid auto-promotion/review, provenance, rollback

## Summary

The SOFIA memory pipeline removes Justin from the moment-by-moment burden of deciding what is memory-worthy. All raw captures become events. A classifier extracts memory candidates, scores durability/worthiness, assigns risk, and routes each candidate into one of four lanes: auto-promote, review, archive/search-only, or reject.

The pipeline is hybrid: high-confidence, low-risk memories can be promoted automatically; ambiguous or high-risk candidates require review. Every durable memory keeps provenance back to its raw source event and can be rolled back.

## Goals

- Make capture effortless: “remember this” should be enough.
- Extract durable memory from sessions, chats, imports, and daily logs automatically.
- Promote obvious high-value memories without asking.
- Queue uncertain or risky candidates for lightweight review.
- Avoid context poisoning through thresholds, provenance, versioning, and review.
- Detect and redact secrets before storage.

## Non-goals

- Perfect classification on day one.
- Fully autonomous identity-shaping memory updates.
- Storing raw secrets, credentials, or sensitive values.
- Replacing human judgment for high-risk memories.

## Pipeline

```text
incoming content
  ↓
redaction + normalization
  ↓
event insert
  ↓
candidate extraction
  ↓
worthiness + confidence + risk scoring
  ↓
routing decision
  ├─ auto-promote
  ├─ review queue
  ├─ archive/search-only
  └─ reject
  ↓
compiled artifacts refresh
```

## Step 1 — Redaction and normalization

Before anything lands in the database, SOFIA scans for likely secrets.

Examples:

- API keys
- private keys
- OAuth tokens
- bearer tokens
- passwords in config snippets
- service-role keys

If found:

- replace with `[REDACTED_SECRET]`
- mark event sensitivity as `secret_redacted`
- never promote automatically
- optionally store a non-secret reference if the user explicitly provides one

## Step 2 — Event insertion

Every capture becomes an `events` row. Events are raw-ish and append-only.

Minimum event metadata:

```json
{
  "source": "pi_session",
  "source_ref": "session id / transcript path / chat id",
  "context": "personal",
  "capture_mode": "manual | session_end | chat | import",
  "redacted": false
}
```

## Step 3 — Candidate extraction

An LLM reads the event and emits zero or more candidate memories.

Candidate types:

```text
fact
preference
decision
lesson
gotcha
project_context
person_context
operating_rule
todo
open_loop
```

`todo` and `open_loop` are not automatically durable memories. They feed task/open-loop systems and reviews.

## Step 4 — Worthiness scoring

Each candidate gets:

- `worthiness_score`: durable value, 0–1
- `confidence`: confidence that the extracted statement is true/faithful, 0–1
- `risk_level`: low/medium/high
- `recommended_action`: auto_promote/review/archive/reject
- `reasoning`: short explanation

### Memory-worthiness rubric

High worthiness:

- explicit decisions with reasoning
- lessons/gotchas likely to recur
- stable facts about people/projects/systems
- stated preferences
- operating rules
- repeated patterns

Medium worthiness:

- plausible but inferred preferences
- project details that may change soon
- potentially useful observations
- temporary context with unclear shelf life

Low worthiness:

- routine progress updates
- raw command output
- transient implementation details
- vague speculation
- duplicated information

Never auto-promote:

- secrets or redacted content
- sensitive financial/legal/medical details
- inferred identity claims
- unresolved speculation
- anything the classifier marks high-risk

## Step 5 — Routing policy

Initial conservative thresholds:

| Candidate type    | Auto-promote threshold | Review threshold | Notes                        |
| ----------------- | ---------------------: | ---------------: | ---------------------------- |
| explicit decision |                   0.85 |             0.65 | Must include why/context     |
| stated preference |                   0.80 |             0.60 | User-stated only             |
| lesson/gotcha     |                   0.80 |             0.60 | Strong SOFIA value           |
| stable fact       |                   0.85 |             0.70 | Prefer direct source         |
| operating_rule    |                   0.90 |             0.70 | Affects behavior; be careful |
| project_context   |                   0.85 |             0.65 | Context-specific             |
| person_context    |                  never |             0.70 | Review by default            |
| inferred fact     |                  never |             0.75 | Do not auto-promote          |
| sensitive         |                  never |             0.80 | Review only                  |

Auto-promote requires:

```text
worthiness_score >= type threshold
confidence >= 0.80
risk_level = low
no redaction flags
not a near-duplicate of active memory
```

## Step 6 — Promotion

Promotion creates:

1. a `memories` row
2. a `memory_versions` row
3. entity links
4. optional memory edges
5. compiled artifact invalidation flag

Promotion text must be self-contained and sourced.

Example promoted memory:

```text
SOFIA should build toward a cloud-capable architecture rather than migrate wholesale to OB1. OB1 is a reference architecture for Supabase/Postgres, MCP, adaptive capture, and graph/wiki patterns, but SOFIA keeps its own hybrid memory model and provenance rules.
```

## Step 7 — Review queue

Review queue should be available through:

- MCP `review_candidates`
- Pi skill
- future Telegram/WhatsApp buttons
- optional dashboard

Actions:

- approve/promote
- edit then promote
- reject
- archive/search-only
- mark as duplicate
- mark as sensitive

## Step 8 — Feedback learning

Borrowing from OB1 adaptive classification, SOFIA tracks outcomes:

- auto-promoted accepted later
- auto-promoted rolled back
- review candidate approved
- review candidate rejected
- type corrections
- risk corrections

This tunes thresholds per type over time.

## Failure modes and mitigations

| Failure               | Mitigation                                                  |
| --------------------- | ----------------------------------------------------------- |
| Memory pollution      | conservative thresholds, review queue, rollback             |
| Missed durable memory | raw events remain searchable; weekly review scans archive   |
| Duplicate memory      | content fingerprint + semantic duplicate check              |
| Secret capture        | redaction before insert; never auto-promote redacted events |
| Over-inference        | require explicit evidence for auto-promote                  |
| Stale memories        | memory_edges `supersedes`; periodic stale review            |

## Evaluation metrics

Track weekly:

- candidates generated
- auto-promotions
- review approvals/rejections
- rollback count
- duplicate rate
- redaction hits
- search success/failure anecdotes

## Open questions

- Should high-confidence decisions auto-promote immediately, or wait until session end?
- How often should archived/search-only candidates be reconsidered?
- Should thresholds be global, per-context, or per-memory-type plus context?
- What is the UX for “undo last auto-promotion”?

## Recommendation

Start with hybrid automation: auto-promote only high-confidence, low-risk durable memories; queue everything else. Keep raw events searchable so missed promotions are recoverable.
