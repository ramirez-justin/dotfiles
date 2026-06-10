---
name: memory-management
description: >-
  Propose, review, and apply durable Pi memory updates. Use when the user asks
  to remember something, update memory, forget stale facts, or preserve a
  reusable preference or workflow across sessions.
---

# Memory Management

Use this skill to manage durable memory in Justin's dotfiles-backed Pi setup.

## Memory Files

- `pi/.pi/agent/memory/USER.md` for durable user preferences.
- `pi/.pi/agent/memory/WORKFLOWS.md` for repeatable workflow conventions.
- `pi/.pi/agent/memory/PROJECTS.md` for stable project facts and caveats.

## Process

1. Classify the candidate memory as user preference, workflow, project fact, or
   not worth storing.
2. Reject secrets, credentials, private keys, tokens, transient session details,
   and unverified assumptions.
3. Read the target memory file before proposing a change.
4. Present the exact diff you plan to apply.
5. Wait for explicit user approval before editing.
6. Apply the smallest useful edit.
7. Show the resulting file path and summarize the stored memory.

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
- Anything the user has not approved.
