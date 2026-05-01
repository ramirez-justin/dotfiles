---
name: sofia-promote
description: Curate durable insights from recent SOFIA daily logs into shared, context, or topic memory files. Routes each accepted candidate to the best target instead of dumping everything into one context file.
---

You are running the manual promotion flow — the v1 stand-in for v2's automated daily reflection.

SOFIA memory architecture:

- `$SOFIA_VAULT/_agent/memory/shared.md` — always-loaded cross-context operating memory. Keep compact.
- `$SOFIA_VAULT/_agent/memory/<context>.md` — compact boot router for `personal` or `work`: `Active Now`, stable summary, and topic links. Do **not** dump detailed entries here by default.
- `$SOFIA_VAULT/_agent/memory/topics/*.md` — detailed durable topic/project/domain memory. This is the default destination for most promoted facts/lessons/decisions.
- `$SOFIA_VAULT/_agent/MEMORY.md` — boot manifest/routing map. Only update when Justin explicitly asks for memory architecture/routing changes.

**Inputs:**
- Optional flags: `--days N` (default 1), `--context personal|work` (default: detected), `--dry-run`

**Steps:**

1. Resolve context (explicit > env > PWD > `personal`).
2. Read the last `N` days of daily logs from `$SOFIA_VAULT/_agent/daily/<context>/`. Skip days with no file.
3. Read memory targets for routing + idempotency:
   - `$SOFIA_VAULT/_agent/memory/shared.md`
   - `$SOFIA_VAULT/_agent/memory/<context>.md`
   - all `$SOFIA_VAULT/_agent/memory/topics/*.md`
   - optionally `$SOFIA_VAULT/_agent/MEMORY.md` for routing context only; don't edit it unless explicitly requested.
4. Note existing promoted entries by their source `[[daily/...]]` backlinks across **all** memory files. Never re-promote an entry whose source backlink already exists anywhere in memory.
5. Identify **promotion candidates**:
   - Decisions ("decided X", "chose Y over Z")
   - Lessons ("learned X", "X went poorly because Y")
   - Durable facts (people, systems, conventions worth remembering)
   - Stated preferences
   - Recurring patterns
   - **Skip:** trivial todos, transient state, raw session-end breadcrumbs, error noise, and anything already in memory.
6. For each candidate, choose a recommended target:
   - Use `shared.md` for cross-context preferences, agent/SOFIA operating rules, decision-making patterns, and broad tooling/runtime rules.
   - Use `<context>.md` only when updating `Active Now`, stable summary, or topic routing links.
   - Use an existing `topics/*.md` file for detailed topic/project/domain memory whenever possible.
   - If no existing topic fits, propose a new topic file path like `_agent/memory/topics/<slug>.md` and explain why.
7. Draft each candidate as:
   ```markdown
   ## YYYY-MM-DD · <decision|lesson|fact|preference|pattern>

   <1-3 sentence distillation>

   Source: [[daily/<context>/<YYYY-MM-DD>#HH-MM]]
   ```
8. Present candidates as a numbered checklist with routing metadata:
   ```markdown
   1. <short title>
      Type: <decision|lesson|fact|preference|pattern>
      Recommended target: <path>
      Reason: <why this target fits>
      Proposed text: <distillation>
      Source: [[daily/<context>/<YYYY-MM-DD>#HH-MM]]
   ```
   Ask the user to **accept**, **edit**, **reject**, or override destinations. Allow batch operations like `accept all`, `accept recommended`, `reject 3`, `move 2 to topics/real-estate.md`.
9. If `--dry-run`, stop here and print what would have been written.
10. For accepted entries:
    - If target exists, prepend the entry after frontmatter and title/intro block, preserving newest-first ordering.
    - If target is a new topic file, create it with frontmatter:
      ```yaml
      ---
      type: memory-topic
      context: <personal|work|shared>
      agent-managed: true
      last-touched: <today>
      sofia-index: true
      ---
      # <Title>
      ```
    - Update target frontmatter `last-touched` to today.
    - If creating a new topic file, consider whether the relevant context router (`personal.md` or `work.md`) needs a new link. Ask before adding router links unless the user already approved that destination/linking change.
11. Confirm with grouped counts, e.g. `promoted 4/5 candidates: 1 to shared.md, 2 to topics/real-estate.md, 1 to topics/telophase.md`.

**Tone:** conversational. Don't bury the user under candidates — if there are >10, ask "want to triage in batches of 5?" first.

**Idempotency:** source backlinks are global across memory files, not per-target.
