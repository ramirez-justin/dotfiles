---
name: executing-plans
description: >-
  Use when an approved implementation plan or build request is ready to run
  through the local Pi single-writer workflow with verified outcomes.
---

# Executing Plans

Announce that you are using the local executing-plans skill.
This is the Pi execution control plane, not upstream Superpowers orchestration.
Do not use it to bypass approval or turn a planning-only request into a build.

## Review Before Execution

Read the plan, referenced design, repository instructions, and current state.
Critically check scope, assumptions, dependencies, safety, and verification.
Resolve harmless implementation details from evidence without interrupting the
user. Ask for plan approval only if it has not already been given. Revisit
approval for a substantial departure, not ordinary internal mechanics.

Use an existing workspace by default. Use `using-git-worktrees` only when
isolation materially helps or the user requests it; do not require a worktree
for every plan. Preserve unrelated changes and respect branch restrictions.

## Route Exactly One Writer

Automatically choose one writer using the routing definitions in `AGENTS.md`:

- `worker` on Sol for routine or mechanical writes.
- `implementer` on Claude Code Opus with medium reasoning for approved
  nontrivial work.

Give the writer the approved plan, evidence, exact scope, constraints,
and verification commands. Keep the same writer responsible for corrections;
do not dispatch a fresh writer for every task or create concurrent writers.
The parent must not edit the same worktree concurrently. If already running as
that delegated writer, execute the assigned work rather than delegating again.
If delegation is unavailable, report the blocker instead of asking the user to
choose inline versus subagent execution.

Keep Linear, Notion, Snowflake, and Cortex mutations in the parent by default,
with preview-before-mutation approval. A build approval is not blanket consent
for destructive, production, or external mutations.

## Track and Verify Progress

Use the current todo tool rules for the plan's tasks and dependencies:

- Mark a task in_progress before starting; exactly one task is in_progress.
- Follow its checkbox steps and run the specified verification.
- Mark completed immediately after verified success, never in a batch.
- Never complete partial or failing work. Keep it in_progress and add a
  blocker task for unresolved errors. Keep plan checkboxes consistent.

Use `test-driven-development` where applicable. Investigate failures with
`systematic-debugging`, correct within scope, and rerun the relevant checks.
Do not substitute an agent's completion summary for evidence.

## Mandatory Final-Diff Simplicity Checkpoint

Before Luna verification or completion, load `../ponytail-review/SKILL.md`
and run its final-diff checkpoint. Freeze the sole writer before capturing
complete newline-preserved UTF-8 diff bytes, including untracked created files,
base and head IDs, ordered changed paths, and artifact and path-list SHA-256
identities. Launch `simplifier` with `run_in_background: false` and
`isolated: true`; keep writes frozen until it finishes.

Wait for a completed lifecycle result and validate the report sections and
all echoed identities. Retry once on failure; a second failure blocks this
workflow unless the user explicitly waives the checkpoint. Fix and reassess
blocking findings through the same writer, or reject them with recorded
technical evidence. Rerun after any artifact content change, including changes
prompted by verification or cleanup; stale reviews cannot satisfy completion.

## Parent Review and Completion

Only after the simplicity checkpoint is accepted and blockers are resolved or
rejected with evidence (or the user explicitly waives the checkpoint), proceed
to independent verification.

The parent inspects the actual diff, changed files, and verification output
against the approved design, including unintended changes and missing tests.
For meaningful changes, launch `verifier` on Luna with max reasoning for
independent validation before claiming completion. Send justified corrections
back to the single writer and reverify the final state.

Use `verification-before-completion`. Report exact checks, their outcomes,
and any remaining limitations; never claim success from stale or absent tests.
Remove task-specific plans/specs before finalizing unless explicitly retained.
Check both the worktree and final diff for those artifacts. Do not remove
unrelated documentation. Commit, PR, merge, and external actions still require
their own applicable authorization; do not force a branch-finish menu.

## Pause Only for Material Reasons

Pause for material ambiguity, meaningful user-facing tradeoffs, blockers or
repeated verification failure, required destructive/production/external
mutation approval, or substantial departure from the approved design.
Explain the evidence and smallest decision needed. Do not pause at arbitrary
batch boundaries or ask the user to choose internal execution mechanics.
