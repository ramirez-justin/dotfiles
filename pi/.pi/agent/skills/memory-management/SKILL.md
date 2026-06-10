---
name: memory-management
description: >-
  Audit, prune, and apply durable Pi memory updates. Use when the user asks to
  remember something, update memory, forget stale facts, or preserve a reusable
  preference or workflow across sessions.
---

# Memory Management

Use this skill to manage durable memory in Justin's dotfiles-backed Pi setup.

## Memory Files

Keep each memory file intentionally small and scoped:

- `pi/.pi/agent/memory/USER.md` contains durable user preferences only.
- `pi/.pi/agent/memory/WORKFLOWS.md` contains reusable workflows only.
- `pi/.pi/agent/memory/PROJECTS.md` contains stable project facts only.

## Process

1. Classify the candidate memory as user preference, workflow, project fact, or
   not worth storing.
2. Reject secrets, credentials, private keys, tokens, transient session details,
   already represented facts, overly session-specific notes, and unverified
   assumptions.
3. Read the target memory file before editing.
4. Audit the file for duplicate, stale, overly specific, or low-value entries.
5. Prefer updating, merging, deduplicating, or pruning existing entries over
   appending.
6. If the file is getting long, make a cleanup edit before adding more memory.
7. Apply the smallest useful edit directly; memory is Pi-owned and does not
   require per-change user approval.
8. Show the diff or concise change summary, the reason for the change, and the
   resulting file path.

## Size Control

Keep memory compact enough to audit quickly. Never silently grow memory. If a
memory file starts to feel long, make or propose a cleanup diff before adding
more:

- Merge overlapping entries.
- Remove stale or low-value details.
- Keep examples only when they change future behavior.
- Prefer one durable rule over several narrow anecdotes.

## Good Memory

Good memory is stable, actionable, and likely to affect future sessions.
Examples:

- Preferred tools or workflows.
- Repeated project caveats.
- Durable communication preferences.
- Explicitly approved rejected approaches.

## Bad Memory

Do not store:

- Secrets or credential material.
- Temporary task state.
- Raw command output.
- Guesses about the user or workplace.
- Duplicates or facts already represented by existing memory.
- Details so narrow they are unlikely to change future behavior.
- Unverified assumptions.
