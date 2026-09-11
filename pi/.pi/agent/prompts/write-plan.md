---
description: Use Superpowers writing-plans to create an implementation plan
argument-hint: "<task/context>"
---
Use the `writing-plans` skill to create a concrete implementation plan. If the
codebase or affected subsystem is broad or unfamiliar, launch `Explore` first.
Use Terra `Plan` for a separate detailed planning pass when useful.

Automatically use `AstraPlan` first when the task meets the escalation gate in
`AGENTS.md`. Give it a curated evidence brief, then give its architecture
handoff to Terra `Plan` for file-level expansion. Skip Terra if Astra reports
that architecture and sequencing cannot reasonably be separated. Do not ask
the agents to repeat each other's work.

$ARGUMENTS
