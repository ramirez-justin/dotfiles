---
name: sofia-plan
description: Open a SOFIA project plan file for the current session. Creates the file if missing, treats it as the active doc — subsequent edits/decisions in the session are implicitly about this plan. Use when starting or resuming work on a named project.
---

You are opening a SOFIA project plan as the active doc for this session.

**Inputs:**
- `name`: the project name (required, free-form; we'll slugify)
- Optional flags: `--context personal|work` (default: detected)

**Steps:**

1. Resolve context (explicit > env > PWD > `personal`).
2. Slugify the name: lowercase, spaces → hyphens, strip non-`[a-z0-9-]`.
3. Compute path: `$SOFIA_VAULT/_agent/plans/<context>/<slug>.md`
4. If the file does not exist, create it with this template:
   ```yaml
   ---
   type: plan
   context: <context>
   agent-managed: true
   status: active
   last-touched: <today>
   sofia-index: true
   ---
   # <Original Name>

   ## Goal

   <1-2 sentences — leave blank for the user to fill>

   ## Status

   <current state — leave blank>

   ## Open questions

   - <none yet>

   ## Decisions

   <link to memory entries when promoted>
   ```
5. Read the file. Show its current contents to the user as the new "active context."
6. Tell the user: "Plan loaded. Edits I make in this session will land in this file unless you tell me otherwise."
7. Tail-update the `last-touched: <today>` field in frontmatter on save.

**Tone:** brief; this is a setup skill, not a long conversation.

**Don't** mark a plan as done automatically. Status flips are user-driven (they say "this is done" → you toggle frontmatter).
