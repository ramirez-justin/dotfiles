---
name: ai-docs-maintenance
description: >-
  Audit and update project AI instruction docs such as CLAUDE.md, AGENTS.md,
  CLAUDE.local.md, AGENT.local.md, Cursor rules, and Copilot instructions when
  durable project behavior or recurring gotchas should guide future agents.
---

# AI Docs Maintenance

Use this skill when Justin asks whether project AI docs need updates, asks to
synchronize instruction files, or when verified implementation, debugging,
review feedback, or repeated friction reveals a durable project rule.

Do not use it for one-off task state, raw review comments, temporary plans, or
personal preferences that belong in SOFIA.

## Process

1. Discover applicable instruction files in the repository root and touched
   subdirectories.
2. Read all applicable non-local docs. Treat local docs as private context and
   never quote sensitive material.
3. Gather concrete evidence from source, tests, commands, review feedback, or
   existing documentation. Do not add speculative rules.
4. Classify the destination: project-wide rule, subtree rule, private local
   rule, SOFIA memory, or reusable Pi skill.
5. Audit for duplicates, stale rules, conflicts, and over-specific examples.
   Prefer updating existing guidance over appending.
6. Keep paired `CLAUDE.md` and `AGENTS.md` guidance synchronized when they serve
   the same audience; preserve intentional differences.
7. Make the smallest safe edit. Do not add secrets, transient branch state, or
   copied private configuration.
8. Verify formatting and confirm the intended rule appears in every required
   destination. If no edit is needed, report why.

## Output

Report docs inspected, updates made, items intentionally excluded, and exact
verification performed.
