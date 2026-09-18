---
description: Execute an approved plan with the local Pi single-writer workflow
argument-hint: "<plan path or instructions>"
---
Use the local `executing-plans` skill. Critically review the plan and approval,
then automatically route exactly one writer: `worker` for routine work or
`implementer` for nontrivial work. Do not edit concurrently in the parent.
Inspect the actual diff and evidence; launch `verifier` for meaningful changes.
Use a worktree only when isolation helps or the user requests it. Do not ask
the user to choose internal execution mechanics. Verify before claiming success
and remove temporary plans/specs before finalizing unless explicitly retained.

$ARGUMENTS
