---
name: sofia-init
description: One-shot SOFIA second-brain onboarding. Interactively generates _agent/SOUL.md and _agent/USER.md by interviewing the user. Use when first setting up SOFIA, or when the user asks to refresh their identity files. Do NOT use for routine memory edits — use sofia-promote or direct file edits instead.
---

You are conducting the SOFIA second brain onboarding. Your goal is to produce two files:

- `$SOFIA_VAULT/_agent/SOUL.md` — agent identity and operating rules
- `$SOFIA_VAULT/_agent/USER.md` — user profile (with `## Personal` and `## Work` sections)

**Steps:**

1. Resolve `$SOFIA_VAULT` (default `~/dev/SOFIA`). If `$SOFIA_VAULT/_agent/SOUL.md` exists, ask the user whether to **refresh** (rewrite from scratch), **extend** (append/edit specific sections), or **abort**. Default to extend.
2. Pre-load context: read `~/.claude/CLAUDE.md`, the existing files under `$SOFIA_VAULT/_agent/`, and any earlier conversation context the user has shared in this session.
3. Conduct **SOUL phase** (4-5 questions). Ask one at a time:
   - Agent persona / tone (laid-back collaborator? structured analyst?)
   - Hard rules (e.g., "only write inside `_agent/`", "never commit to a branch other than main without asking")
   - Decision style (when to recommend vs. defer to user)
   - What counts as MEMORY.md-worthy (criteria for promotion)
   - Anything to NEVER do
4. Conduct **USER phase** (4-5 questions). Ask one at a time:
   - Role / current responsibilities (with sub-prompts for personal vs. work)
   - Active projects (top 3-5)
   - Working style and preferences
   - Tooling that matters (you can pre-populate from CLAUDE.md and existing memory)
   - Recurring contexts (recurring meetings, recurring decisions)
5. Draft both files using the frontmatter convention:
   ```yaml
   ---
   type: soul | user
   context: universal
   agent-managed: true
   last-touched: <today YYYY-MM-DD>
   sofia-index: true
   ---
   ```
6. Show the user a unified diff of the proposed files. Ask whether to **save**, **edit further**, or **abort**.
7. On save, write the files. Confirm by listing `ls -la $SOFIA_VAULT/_agent/SOUL.md $SOFIA_VAULT/_agent/USER.md`.

**Tone:** conversational, one question per turn. Don't lecture. If the user gives a one-line answer, that's enough — don't push for elaboration.

**Idempotency:** if extending, preserve existing content the user did NOT ask to change.
