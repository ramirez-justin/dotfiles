---
name: sofia-status
description: One-page situational digest of the SOFIA brain. Reads SOUL.md, USER.md, the active context's memory file, last 7 days of daily logs, and active plans. Outputs a compact summary. Use at start of day, when returning to a project after a break, or when the user asks "where am I?".
---

You are producing the SOFIA status digest.

**Inputs:**
- Optional flags: `--context personal|work` (default: detected)

**Steps:**

1. Resolve context.
2. Read these files (best effort — silently skip what's missing):
   - `$SOFIA_VAULT/_agent/SOUL.md`
   - `$SOFIA_VAULT/_agent/USER.md`
   - `$SOFIA_VAULT/_agent/memory/<context>.md`
   - Last 7 days of `$SOFIA_VAULT/_agent/daily/<context>/*.md`
   - All `$SOFIA_VAULT/_agent/plans/<context>/*.md` files
3. Parse plan frontmatter for `status` and `last-touched`.
4. Render this layout (markdown, terse — fits in <60 lines):

   ```markdown
   # SOFIA status — <context>, <today>

   ## Active plans
   - [<status>] **<plan title>** — <last-touched>: <one-line summary from frontmatter `## Status` or first paragraph>
   - ...

   ## Recent decisions (top 5 from memory)
   - <YYYY-MM-DD · type>: <distillation>
   - ...

   ## Recent activity (last 3 days, top entries)
   - <YYYY-MM-DD HH:MM>: <entry preview>
   - ...

   ## Stale plans (active, not touched in 14+ days)
   - **<plan title>** — last-touched <date>
   - (none if all plans recent)
   ```

5. Output the rendered digest. Don't add commentary unless the user asks.

**Don't:**
- Don't promote, summarize for memory, or write any files.
- Don't include items outside the requested context.
- Don't truncate so aggressively that an entry's meaning is lost.
