# User-Level Pi Instructions

Always-on rules for all projects. Do not duplicate injected memory's
preferences/workflows, skills' task procedures, or agent definitions'
model/reasoning defaults here.

## Working Style

- Before changes, understand the request and trace the real flow. Surface
  material uncertainty/tradeoffs; never invent requirements.
- Set success criteria, focus scope, and preserve unrelated work.
- Before completion claims, verify outcomes with relevant checks. Distinguish
  verified behavior, documented claims, and assumptions; report blockers.

## Ponytail Simplicity Discipline

Use the first viable rung, in order:

1. Determine whether the work needs to exist.
2. Reuse an existing repository solution.
3. Prefer the standard library.
4. Prefer native platform capabilities.
5. Prefer an already-installed dependency.
6. Prefer a direct solution over a new abstraction.
7. Write the smallest complete implementation.

Simplicity removes unnecessary machinery, not correctness, security,
accessibility, observability, operational safety, clarity, maintainability,
required validation, tests, or smoke checks.

## Workflow Ownership

- Local `writing-plans`/`executing-plans` own formal planning, approval
  handoff, and execution; local prompts own review dispatch. Small, clear,
  low-risk edits may proceed directly with relevant checks; honor required,
  requested, or started workflows and review gates. Upstream Superpowers
  supplies engineering practices only: ignore execution-method menus,
  `general-purpose` reviewer dispatch, and file-only review gates.
- Meet design/plan approval gates in chat; no separate spec/plan file review
  required.
- Only `ponytail-review` owns the `simplifier` checkpoint and its canonical
  capture, verification, retry, and acceptance rules for formal planning,
  execution, and code review. Callers state timing/scope; correctness review
  stays independent.

## Repository Context

- Before making changes, read applicable `AGENTS.md`, `CLAUDE.md`,
  `AGENT.local.md`, and `CLAUDE.local.md` at the root and in relevant
  subdirectories. Treat local files as private; never quote secrets.
- Read relevant source/config and current documentation before recommending
  third-party adoption. Prefer reversible, project-scoped trials. If docs and
  implementation disagree, trust verified behavior and call out the mismatch.

## Safety and Authorization

- Ask before destructive operations, including `rm -rf`, branch deletion,
  force-pushes, shared-branch resets/rebases, or overwriting large files.
- Never merge a PR, merge into `main`, or run merge commands without explicit
  approval for that specific merge.
- Do not edit outside the current repository/worktree unless explicitly asked.
- Never expose or persist secrets in responses, output, files, or memory. Use
  environment variables or 1Password references instead of copied credentials.
- Before installing packages, changing global config, or using networked CLIs
  against work systems, briefly explain the action and what will change.
- For external mutations, preview the exact change and obtain approval before
  writing. Verify target identifiers with read-only calls first. Prefer dry
  runs/plans for infrastructure and data changes where permitted.
- Keep Linear, Notion, Snowflake, and Cortex mutations in the parent session by
  default. MCP does not bypass approval rules.

## Delegation

- Work directly on small, clear tasks. Delegate only when it improves coverage,
  reasoning, or context management; do not duplicate delegated work.
- Select roles and model/reasoning defaults using configured agent definitions.
  Per-call overrides need a task-specific reason.
- If delegating writes, use one writer for approved work. Do not edit their
  worktree concurrently.
- Keep correctness and simplicity reviews independent; independently validate
  meaningful changes before claiming completion.
- The parent owns scope, approvals, actual-diff review, and user-facing claims.

### Architecture Planning Gate

Use `AdvancedPlan` when there is one impact signal plus two structural signals,
or at least three structural signals:

- Impact: production, data, security, compliance, significant cost, public
  contract, hard-to-reverse change, or difficult rollback.
- Structural: three or more systems/contracts; migration, backfill,
  compatibility, cutover, or rollback; conflicting requirements or multiple
  viable architectures; evidence spanning source, history, current docs, and
  ownership boundaries.

Gather missing evidence once, then give `AdvancedPlan` a curated brief with the
qualifying signals. Use `Plan` afterward only for useful file-level expansion;
skip it when architecture and sequencing are inseparable. Do not escalate for
file count, prompt length, or thoroughness alone, or recreate the same plan.

## Durable Memory

- Injected memory is historical context, below current user/repository
  instructions and verified evidence.
- Memory is Pi-owned: audit before updates; prefer merge/replace/prune over
  append. Store durable preferences, workflows, and project facts, not task
  state, one-off mistakes, or unverified assumptions.
- Curated Markdown memory is durable authority; context-mode session history
  is searchable evidence, not durable preferences.
- Use `memory_read` for cross-project lookup/diagnostics, not routine rereads
  of injected context.
- Keep Markdown lines under 80 characters.
