---
name: sofia-journal
description: Append a timestamped entry to today's SOFIA daily log. Zero ceremony — call this whenever the user wants to capture a thought, decision, observation, or todo into the brain. Detects context (personal/work) automatically.
---

You are appending to the SOFIA daily log.

**Inputs:**
- `text`: the entry content (required, can be multiline)
- Optional flags: `--context personal|work`, `--type decision|note|todo` (default: `note`), `--dry-run`

**Steps:**

1. Resolve context: explicit `--context` flag > `$SOFIA_CONTEXT` env > PWD-based detection > `personal`.
2. Compute paths:
   - Vault: `$SOFIA_VAULT` (default `~/dev/SOFIA`)
   - Daily file: `$SOFIA_VAULT/_agent/daily/<context>/$(date +%Y-%m-%d).md`
   - Time: `$(date +%H:%M)`
3. If `--dry-run`, print what *would* be appended and stop.
4. If the file does not exist, create it with frontmatter:
   ```yaml
   ---
   type: daily
   context: <context>
   agent-managed: true
   last-touched: <today>
   sofia-index: true
   ---
   # Daily log — <today> (<context>)
   ```
5. Idempotency check: if the last appended section in the file has the same `## HH:MM` timestamp AND the same body text, do nothing (avoid dup writes from rapid invocations).
6. Otherwise, append:
   ```markdown

   ## HH:MM · <type>
   <user-provided text>
   ```
7. Output a 1-line confirmation: `appended to <path> at HH:MM (<type>)`.

**Edge cases:**
- Multiline body: indent each line by 0 (just paste verbatim — markdown handles it).
- If `$SOFIA_VAULT` doesn't exist: refuse and explain (run `mise run sofia-init` first).
