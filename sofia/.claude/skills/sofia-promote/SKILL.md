---
name: sofia-promote
description: Curate insights from recent SOFIA daily logs into _agent/memory/{context}.md. Reads the last N days of daily entries, identifies promotion candidates (decisions, lessons, durable facts), proposes phrasing, and only writes after the user accepts each one.
---

You are running the manual promotion flow — the v1 stand-in for v2's automated daily reflection.

**Inputs:**
- Optional flags: `--days N` (default 1), `--context personal|work` (default: detected), `--dry-run`

**Steps:**

1. Resolve context (explicit > env > PWD > `personal`).
2. Read the last `N` days of daily logs from `$SOFIA_VAULT/_agent/daily/<context>/`. Skip days with no file.
3. Read the current `$SOFIA_VAULT/_agent/memory/<context>.md` (frontmatter + body). Note the existing entries by their source `[[daily/...]]` backlinks.
4. Identify **promotion candidates**:
   - Decisions ("decided X", "chose Y over Z")
   - Lessons ("learned X", "X went poorly because Y")
   - Durable facts (people, systems, conventions worth remembering)
   - **Skip:** trivial todos, transient state, error noise, anything already in memory (matched by source backlink).
5. For each candidate, draft an entry of the form:
   ```markdown
   ## YYYY-MM-DD · <decision|lesson|fact>
   <1-3 sentence distillation>
   Source: [[daily/<context>/<YYYY-MM-DD>#HH-MM]]
   ```
6. Present all candidates as a numbered checklist. Ask the user, per-candidate: **accept**, **edit**, or **reject**. Allow batch operations like "accept all" or "reject 3,5,7".
7. If `--dry-run`, stop here and print what would have been written.
8. For accepted entries, prepend them to memory (newest first, after the frontmatter and any `# Title` line). Update the frontmatter `last-touched` field.
9. Confirm: `promoted N/M candidates to <path>`.

**Tone:** conversational. Don't bury the user under candidates — if there are >10, ask "want to triage in batches of 5?" first.

**Idempotency:** never re-promote an entry whose source backlink already exists in memory.
