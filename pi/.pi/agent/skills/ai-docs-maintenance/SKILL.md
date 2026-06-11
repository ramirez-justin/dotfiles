---
name: ai-docs-maintenance
description: >-
  Audit and update project AI instruction docs such as CLAUDE.md, AGENTS.md,
  CLAUDE.local.md, AGENT.local.md, .cursor/rules, and GitHub Copilot
  instructions when project behavior, review feedback, or recurring gotchas
  should change future agent behavior.
---

# AI Docs Maintenance

Use this skill when Justin asks whether project AI docs need updates, asks to
sync `CLAUDE.md` and `AGENTS.md`, or when a durable project instruction emerges
from implementation, debugging, review feedback, or repeated friction.

## Goal

Keep project-owned agent instructions accurate, compact, and useful without
turning them into session notes or Pi personal memory.

## Files To Check

At the current repository root and relevant subdirectories, look for:

- `CLAUDE.md`
- `CLAUDE.local.md`
- `AGENTS.md`
- `AGENT.local.md`
- `.cursor/rules/**`
- `.github/copilot-instructions.md`
- other clearly named AI-agent instruction docs

Treat `.local` files as private/local context. Do not quote secrets from them.

## When To Use

Use this after or during:

- review feedback that reveals a reusable project rule
- debugging that reveals a stable repo gotcha
- repeated command/setup mistakes
- changes to build, test, lint, deploy, or codegen workflows
- changes to project-specific agent expectations
- noticing `CLAUDE.md` and `AGENTS.md` have drifted

Do not use this for one-off task state, raw review comments, temporary branch
plans, or personal preferences that belong in Pi memory.

## Process

1. **Discover docs**
   - Find applicable AI docs in the repo root and touched subdirectories.
   - Read all applicable non-local docs before proposing edits.
   - Read local docs only as private context; avoid quoting sensitive content.

2. **Gather evidence**
   - Check the concrete source of the proposed update: diff, tests, commands,
     review feedback, repo scripts, or existing docs.
   - Do not add instructions from guesses or single unverified anecdotes.

3. **Classify destination**
   - Project-wide agent rule: root `CLAUDE.md` and/or `AGENTS.md`.
   - Subtree-specific rule: nearest applicable subdirectory doc.
   - Private machine/user detail: `.local` doc or Pi memory, not shared docs.
   - Personal preference: use `memory-management` instead.
   - Repeatable agent workflow: consider a Pi skill instead.

4. **Audit before editing**
   - Look for duplicates, stale rules, conflicts, and over-specific examples.
   - Prefer updating or merging existing guidance over appending.
   - Keep instructions concise and actionable.

5. **Synchronize paired docs**
   - If the repo uses both `CLAUDE.md` and `AGENTS.md` for the same audience,
     keep overlapping guidance synchronized.
   - If they intentionally differ, preserve the distinction and say why.

6. **Edit safely**
   - Do not store secrets, internal credentials, raw tokens, or copied private
     config.
   - Do not add branch-specific notes or transient session plans.
   - Keep markdown lines under 80 characters when practical.
   - Touch only the smallest relevant sections.

7. **Verify**
   - Run markdown/frontmatter checks when available.
   - For paired docs, diff or grep to confirm the intended rule appears in each
     required file.
   - If no edit is needed, say so and explain the evidence.

## Output

Report concisely:

- docs inspected
- updates made, with paths
- items intentionally not added and why
- verification run

## Good Updates

Good project AI-doc updates are stable, actionable, and repo-specific:

- "Run `mise run link` after changing dotfiles-managed Pi files."
- "Keep `CLAUDE.md` and `AGENTS.md` synchronized in this repo."
- "Use `<repo command>` for tests; direct framework commands miss setup."

## Bad Updates

Do not add:

- raw review comments
- temporary branch state
- exact prompts or chat transcripts
- secrets or credential paths that expose private material
- broad personal preferences better suited to Pi memory
- speculative rules that were not verified
