---
description: Create a concrete plan with the local Pi writing-plans workflow
argument-hint: "<task/context>"
---
Use the local `writing-plans` skill to create an implementation plan. If the
codebase or affected subsystem is broad or unfamiliar, launch `Explore` first.
Use Terra `Plan` for a separate detailed planning pass when useful.

Automatically use `AstraPlan` first when the task meets the escalation gate in
`AGENTS.md`. Give it a curated evidence brief, then give its architecture
handoff to Terra `Plan` for file-level expansion. Skip Terra if Astra reports
that architecture and sequencing cannot reasonably be separated. Do not ask
the agents to repeat each other's work.

Ask for approval only if it is not already established. Once an approved build
request is ready, continue automatically with local `executing-plans`; never
ask the user to choose internal execution mechanics. Honor planning-only scope.

$ARGUMENTS
