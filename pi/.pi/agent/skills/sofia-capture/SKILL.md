---
name: sofia-capture
description: Intelligent SOFIA capture workflow. Use when Justin says "capture this", "journal this", "remember this", "note that", "todo", "we decided", "all done", "wrap this up", or otherwise wants something reflected into SOFIA. Handles quick notes, decisions, todos, and end-of-task wrap-ups.
---

You are running SOFIA capture: the main user-facing workflow for getting thoughts, decisions, todos, and completed-work reflections into SOFIA.

This skill replaces a strict split between "journal" and "finish". Classify the user's intent, capture the right amount of context, append to the daily log, and optionally route durable memory into promoted files.

**Inputs:**

- Free-form text from Justin, e.g. `remember that...`, `todo: ...`, `we decided...`, `all done`, `wrap this up`
- Optional flags: `--context personal|work`, `--type note|decision|todo`, `--promote`, `--no-promote`, `--dry-run`

**Intent classification:**

Classify into one of these modes:

1. **Quick note** — simple observation or fact to append.
2. **Decision** — settled choice, especially with reasoning.
3. **Todo** — explicit follow-up/action item Justin wants tracked.
4. **End-of-task wrap-up** — phrases like "all done", "done", "wrap this up", "finish this", "close this out".
5. **Durable memory candidate** — stated preference, lesson/gotcha, recurring pattern, stable fact, or system/project convention.

If multiple apply, preserve all relevant parts. Example: an end-of-task wrap-up may include decisions and todos.

**Steps:**

1. Resolve context: explicit flag > `$SOFIA_CONTEXT` env > PWD-based detection > `personal`.
2. Build a capture draft.
   - For quick notes/decisions/todos: draft the shortest useful daily-log entry.
   - For end-of-task wrap-up: reconstruct what happened from the conversation and relevant file changes; produce:

     ```markdown
     ## Wrap-up draft

     ### Journal entry

     <3-6 bullets or 1 short paragraph capturing what changed / what was decided>

     ### Durable candidates

     - <decision/lesson/fact/preference/pattern worth promoting later>
     - ...

     ### Follow-ups

     - <todo, if any>
     - (none)
     ```

3. Approval behavior:
   - If Justin gave exact text and intent is trivial, append directly.
   - If the capture is a wrap-up, durable/ambiguous, or inferred from conversation, ask Justin to approve/edit/reject before writing.
   - If sensitive data appears, redact or ask before writing.
4. Append the approved entry to today's daily log:
   - Path: `$SOFIA_VAULT/_agent/daily/<context>/$(date +%Y-%m-%d).md`
   - Create the daily file if missing with standard frontmatter.
   - Use type:
     - `decision` for settled decisions
     - `todo` for explicit tasks
     - `note` for everything else, including wrap-up summaries unless mostly decision-oriented
   - Format:

     ```markdown
     ## HH:MM · <type>

     <approved text>
     ```

5. Promotion handling:
   - If `--no-promote`, stop after journaling.
   - If `--promote`, route durable candidates immediately using the `sofia-promote` model.
   - Otherwise, if there are durable candidates, ask: "Promote now or leave in daily log?"
   - Promotion routing:
     - shared rules/preferences → `_agent/memory/shared.md`
     - boot router changes → `_agent/memory/<context>.md`
     - detailed durable facts → `_agent/memory/topics/*.md`
     - new topics only with approval
6. Follow-up handling:
   - For todos, ask where to record if not obvious:
     - daily log todo
     - active SOFIA plan
     - nowhere / just mention in response
   - Do not create a new task system entry unless one exists and Justin asks.
7. Confirm briefly:
   `captured to <daily path>; promoted <N> items; follow-ups <recorded|none>`

**What to capture:**

- Decisions with why
- Lessons/gotchas
- Durable facts
- Stated preferences
- Recurring patterns
- Useful follow-ups
- Concise summaries of completed SOFIA/project work

**What not to capture:**

- Raw command output
- Routine edits with no durable value
- Sensitive data/secrets/PII
- Unsettled speculation
- Blow-by-blow transcripts

**SOFIA Cloud MCP usage:**

- Prefer the `sofia_cloud_capture_event` MCP tool when SOFIA Cloud is available.
- If the server is shown as cached/not connected, connect to `sofia-cloud` first or retry once after a transient connection failure.
- If a capture call fails validation, describe the tool and follow its live schema instead of guessing argument names.
- Current `sofia_cloud_capture_event` argument shape:
  ```json
  {
    "content": "Raw content to capture",
    "context": "personal|work|shared",
    "source": "pi",
    "source_ref": "optional reference",
    "type_hint": "note|decision|todo|preference|lesson|fact",
    "metadata": {}
  }
  ```
- Important gotcha: the required raw-content parameter is `content`, not `text`.
- Treat successful auto-promotion as capture complete; if candidates are queued for review, summarize them and ask Justin whether to approve, reject, or archive.

**Relationship to other SOFIA skills:**

- `sofia-capture` is the main user-facing capture workflow.
- `sofia-journal` is a low-level append primitive for exact/simple journal writes.
- `sofia-promote` handles durable memory curation/routing.
- `sofia-status`, `sofia-search`, `sofia-link`, and `sofia-plan` remain separate workflows.

**Safety:**

- Only write inside `_agent/` unless Justin explicitly asks otherwise.
- Ask before editing human-owned vault spaces.
- Ask before promotion if destination is ambiguous.
