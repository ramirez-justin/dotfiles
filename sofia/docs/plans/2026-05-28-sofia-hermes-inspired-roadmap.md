# SOFIA Hermes-Inspired Roadmap

Status: draft
Date: 2026-05-28

## Purpose

Reframe SOFIA as the durable memory, review, and coordination layer for Pi, borrowing the best product ideas from Hermes Agent without replacing Pi or overbuilding a new agent framework.

Target shape:

- **Pi** is the interactive agent shell: terminal, tools, coding workflows, MCP, skills.
- **SOFIA Cloud** is the memory/control plane: boot context, durable memories, plans, review queues, compiled artifacts, health state.
- **Hermes-inspired layer** is the operating loop: always-available access, scheduled review, proactive capture, skill learning, and reliability checks.

## Guiding principles

1. Keep Postgres/SOFIA Cloud canonical; Obsidian/Markdown is a generated human view.
2. Keep Pi lightweight. Add workflows through skills, MCP tools, and scheduled jobs rather than a monolithic runtime.
3. Prefer explicit review gates for durable memory and skills; auto-promote only when confidence is high.
4. Preserve Justin’s agency: preview before mutation, quiet hours, opt-in proactive behavior.
5. Make failures legible. If cloud boot fails, explain what failed and how to recover.
6. Use SOUL.md for character, not as a substitute for operating rules or durable memory.

## Current baseline

Already working:

- SOFIA Cloud Supabase/Postgres core.
- Remote MCP tools for capture, search, recent listing, candidate review, archive, boot context, and artifacts.
- Cloud-first Pi boot context.
- Durable memory capture with candidate extraction, reconciliation, auto-promotion, and review routing.
- Pi skills for SOFIA workflows.
- Dotfiles-managed deployment/check tasks.

Known gaps:

- Existing roadmap is stale.
- Supabase project inactivity can break boot context until the project is restored.
- No first-class scheduled review/briefing loop.
- No chat gateway for capture/search/review outside coding sessions.
- Classifier output can still produce unexpected enum values for roadmap/feature-like captures, causing capture failure instead of graceful review routing.
- Skill creation/improvement is not yet a formal SOFIA loop.
- Human-readable compiled views are incomplete or not treated as a core product surface.
- SOFIA/Pi personality is mostly implicit in instructions rather than expressed through a dedicated SOUL.md.

## Phase 1 — Reliability and operability

Goal: make SOFIA boring to operate before adding more surfaces.

Deliverables:

- Add `sofia-cloud:health` task that checks:
  - Supabase project status.
  - DNS resolution for the project hostname.
  - Edge Function reachability.
  - authenticated MCP boot-context call.
- Add a short recovery runbook for:
  - `INACTIVE` Supabase project.
  - DNS `NXDOMAIN`.
  - transient Cloudflare `521` during restore.
  - missing or invalid `SOFIA_MCP_ACCESS_KEY`.
- Add an optional keepalive/check job to reduce surprise inactivity.
- Improve boot failure messaging in Pi instructions/hooks: never fall back to local Obsidian; surface cloud failure and suggested command.
- Harden classifier normalization so unknown candidate types/actions degrade to `fact`/`review` or a clear validation error path without losing the raw event.

Exit criteria:

- A failed boot context points to one diagnostic command.
- Health check distinguishes auth, DNS, project status, and function errors.
- The restore gotcha is documented in-repo.

## Phase 2 — SOUL.md and agent character

Goal: give SOFIA/Pi a consistent character while keeping behavior governed by explicit rules.

Deliverables:

- Create a generated or curated `SOUL.md` concept for SOFIA/Pi character.
- Define boundaries between:
  - **SOUL.md**: voice, posture, values, personality.
  - **USER.md / durable memory**: Justin’s preferences and facts.
  - **AGENTS.md / skills**: operating rules and procedures.
- Add SOUL content to boot context in a compact way.
- Add a review workflow for character changes so personality does not drift accidentally.

Initial character direction:

- Calm, direct, and slightly opinionated.
- Practical second brain, not sycophant.
- Curious but not chatty.
- Pushes back when evidence is weak.
- Treats memory as sacred: useful, terse, non-invasive.

Exit criteria:

- New Pi sessions have a recognizable SOFIA voice.
- SOUL.md does not duplicate safety rules or project instructions.
- Justin can edit/review character separately from memory facts.

## Phase 3 — Scheduled review and briefing loop

Goal: make SOFIA useful without requiring manual prompting.

Deliverables:

- Daily review job:
  - pending memory candidates.
  - recent captures.
  - failed captures/reconciliations.
- Weekly digest:
  - active projects/plans.
  - stale plans.
  - recurring themes.
  - unresolved todos or open loops.
- Stale memory report:
  - likely obsolete facts.
  - conflicting memories.
  - candidates for archive/supersession.
- Quiet-hours and delivery preferences.

Exit criteria:

- Justin can review daily memory in under two minutes.
- Weekly digest identifies stale plans and useful themes.
- Review jobs are visible, disable-able, and auditable.

## Phase 4 — Chat gateway, Telegram first

Goal: let Justin capture, search, and review SOFIA from outside coding sessions.

Recommended first adapter: Telegram.

Deliverables:

- Minimal Telegram bot or gateway integration.
- Commands/intents:
  - capture note/decision/todo.
  - search memory.
  - list pending review candidates.
  - approve/reject/archive candidate.
  - ask for daily/weekly digest.
- Identity/authorization guardrails.
- Message formatting for review cards.
- Quiet-hours/throttling.

Exit criteria:

- Justin can text SOFIA a memory from phone.
- Justin can approve/reject candidates from phone.
- SOFIA can send scheduled digest messages without being noisy.

## Phase 5 — Skill learning loop

Goal: turn repeated successful workflows into reusable Pi skills.

Deliverables:

- Add a SOFIA/Pi policy for when to propose skill creation or updates:
  - complex task with 5+ tool calls.
  - repeated workflow.
  - user correction.
  - non-obvious debugging path.
  - manual recovery runbook.
- Add `skill_candidate` capture type or metadata convention.
- Add review flow: promote workflow lesson to skill update, new skill, or memory only.
- Add skill improvement workflow:
  - identify stale/brittle skill instructions.
  - propose patch.
  - verify with user before committing.

Exit criteria:

- SOFIA can identify skill-worthy workflows without spamming.
- Skill changes remain explicit and reviewable.
- Recovery procedures like SOFIA Cloud restore can become durable skills/runbooks.

## Phase 6 — Compiled human view

Goal: make Obsidian/Markdown a high-quality generated view of SOFIA Cloud.

Deliverables:

- Compile artifacts from Postgres:
  - SOUL.md.
  - USER.md.
  - shared/personal/work boot memory.
  - topic pages.
  - project dossiers.
  - decision history.
- Mark generated files clearly with frontmatter.
- Never overwrite human-authored vault spaces without explicit approval.
- Add diff/preview before export.

Exit criteria:

- Human-readable SOFIA vault can be regenerated from cloud state.
- Generated files are clearly separate from human-authored notes.
- Pi never uses local generated files as runtime fallback.

## Phase 7 — Graph and dossier layer

Goal: move from memory list to synthesized understanding.

Deliverables:

- Entity extraction for people, projects, systems, places, decisions.
- Typed edges between memories.
- Project/person/topic dossiers.
- Contradiction and supersession views.
- Timeline views for important projects.

Exit criteria:

- SOFIA can answer “what is going on with project X?” from synthesized memory.
- Contradictions are visible and reviewable.
- Dossiers are generated, not hand-maintained.

## Phase 8 — Importers

Goal: bring history into SOFIA without polluting durable memory.

Priority:

1. Existing SOFIA vault / old local runtime.
2. Pi/Claude session summaries.
3. ChatGPT/Claude exports.
4. Gmail and Calendar.
5. Notion/Obsidian.
6. Readwise/bookmarks/browser sources.

Rules:

- Imports create raw events first.
- Candidate extraction runs afterward.
- Durable memories require promotion/reconciliation.
- Importers must be rerunnable via fingerprints.

Exit criteria:

- Historical material can be searched without all becoming durable memory.
- Reimports do not duplicate events.
- Promotion remains controlled.

## Near-term recommended plan

1. Implement Phase 1 health check and recovery runbook.
2. Draft SOUL.md and wire it into cloud boot context.
3. Add daily/weekly review job design.
4. Choose Telegram gateway implementation path.

## Open decisions

- Should SOUL.md be human-authored, generated from memory, or hybrid?
- Should scheduled jobs live in Supabase, local launchd, GitHub Actions, or an external cron/gateway?
- Should Telegram be a thin SOFIA client or a broader Pi agent interface?
- How aggressive should proactive skill creation be?
- Should old local SOFIA runtime be removed after importer/exporter work lands?
