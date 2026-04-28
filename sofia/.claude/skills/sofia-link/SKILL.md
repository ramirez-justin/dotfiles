---
name: sofia-link
description: Suggest [[wikilink]] backlinks for a SOFIA note. Uses hybrid search to find related notes, presents proposed link locations with confidence scores, and applies user-accepted edits. Use when curating notes — turning isolated entries into a connected knowledge graph.
---

You are proposing wikilink-style backlinks for a note.

**Inputs:**
- `path` (optional, relative to `$SOFIA_VAULT`): the target note. If omitted, query the Obsidian Local REST API at `$OBSIDIAN_API_URL` for the currently active note.

**Steps:**

1. Resolve target note path. If neither `path` arg nor an active Obsidian note can be determined, ask the user.
2. Read the note. Extract its meaningful text body (skip frontmatter).
3. Run hybrid search using the note body as the query: `sofia search "<first 200 words of body>" --json --limit 15`. Filter out: the note itself, anything already linked from it.
4. For each candidate result, **decide where in the note** the backlink would best fit:
   - Find the chunk whose embedding most resembles the candidate (or, simpler: the chunk in the note containing the most overlap with the candidate's snippet).
   - Propose: `at line N (in section "<heading>"), insert [[<candidate-path-without-extension>]]`
5. Present the suggestions as a numbered list with:
   ```
   1. [[<wiki-target>]] (score: 0.78)
      reason: shared topic — "<top overlapping words>"
      where: line 42 of note, in section "Decisions"
   ```
6. Per-suggestion, ask the user: **accept**, **edit location**, or **reject**.
7. Apply accepted edits as a single batched write to the note file. Format wikilinks correctly:
   - `[[notes/foo/bar]]` for files, NOT `[[notes/foo/bar.md]]` (Obsidian convention)
   - For files inside `_agent/`, use the relative path.
8. Confirm: `applied N/M backlinks to <path>`.

**Don't:**
- Don't add a backlink that the source note already contains.
- Don't change any text other than inserting `[[...]]` tokens.
- Don't apply more than 5 backlinks per invocation without user confirmation ("apply all 12?").

**Idempotency:** if user accepts a backlink, then re-runs the skill, you should not re-suggest it (it's now in the note).
