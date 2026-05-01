---
name: sofia-status
description: One-page situational digest of the SOFIA brain. Reads SOUL.md, USER.md, shared memory, the active context router, recent daily logs, and active plans. Outputs a compact summary. Use at start of day, when returning to a project after a break, or when the user asks "where am I?".
---

You are producing the SOFIA status digest.

SOFIA memory architecture:

- `shared.md` is always-loaded cross-context operating memory.
- `<context>.md` is a compact boot router with `Active Now`, stable summary, and topic links.
- `topics/*.md` files hold detailed durable memory and should be loaded only when relevant.

**Inputs:**
- Optional flags: `--context personal|work` (default: detected)
- Optional `--topic <slug>` or explicit user topic/request, e.g. "status on real estate" or "where am I with Telophase?"

**Steps:**

1. Resolve context.
2. Read these files (best effort — silently skip what's missing):
   - `$SOFIA_VAULT/_agent/SOUL.md`
   - `$SOFIA_VAULT/_agent/USER.md`
   - `$SOFIA_VAULT/_agent/memory/shared.md`
   - `$SOFIA_VAULT/_agent/memory/<context>.md`
   - Last 7 days of `$SOFIA_VAULT/_agent/daily/<context>/*.md`
   - All `$SOFIA_VAULT/_agent/plans/<context>/*.md` files
3. Topic loading:
   - Do **not** load all topic files by default.
   - If the user asks about a specific topic, or the context router's `Active Now` clearly points to a small number of relevant topic files, read only those topic files.
   - Prefer linked topic paths in `<context>.md` over guessing.
4. Parse plan frontmatter for `status` and `last-touched`.
5. Render this layout (markdown, terse — fits in <60 lines):

   ```markdown
   # SOFIA status — <context>, <today>

   ## Active now
   - <items from context router's Active Now, with topic links preserved>

   ## Active plans
   - [<status>] **<plan title>** — <last-touched>: <one-line summary from frontmatter `## Status` or first paragraph>
   - ...

   ## Relevant memory
   - <top shared/context/topic memory items relevant to the status request>
   - ...

   ## Recent activity
   - <YYYY-MM-DD HH:MM>: <entry preview>
   - ...

   ## Stale plans
   - **<plan title>** — last-touched <date>
   - (none if all plans recent)
   ```

6. Output the rendered digest. Don't add commentary unless the user asks.

**Don't:**
- Don't promote, summarize for memory, or write any files.
- Don't include items outside the requested context unless they come from `shared.md` or the user explicitly asks cross-context.
- Don't load every topic file just because it exists.
- Don't truncate so aggressively that an entry's meaning is lost.
