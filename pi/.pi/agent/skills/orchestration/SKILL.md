---
name: orchestration
description: Use for complex, multi-step, high-risk, or long-running workflows that benefit from explicit checkpoints, evidence capture, and reasoned alternatives. Inspired by Babysitter-style orchestration, but does not require installing Babysitter.
---

# Orchestration

Use this skill when a task is too large or risky for a single linear edit, especially when it involves multiple dependent steps, external systems, migrations, large refactors, debugging campaigns, or coordination across tools.

This is a lightweight local workflow skill. It borrows useful ideas from Babysitter-style orchestration—explicit state, effects, checkpoints, and verification—without requiring the Babysitter Pi package or slash commands.

## When to use

Use orchestration for:

- Multi-step feature work or refactors
- Debugging where several hypotheses need to be tested
- Work touching production, cloud, data, auth, CI/CD, or issue trackers
- Tasks that need durable progress notes or handoff context
- Integrations where documentation and implementation may differ
- Any workflow where failure modes should be surfaced before action

Do not use orchestration for:

- Simple questions
- Small single-file edits
- Trivial config changes
- Read-only lookups with obvious next steps

## Core loop

1. **State the goal and constraints**
   - Restate what success means.
   - List safety constraints, approvals needed, and known unknowns.

2. **Inspect evidence before choosing a path**
   - Read relevant local docs, source, config, and recent changes.
   - For third-party/version-sensitive tools, consult current docs when useful.
   - Separate verified facts from assumptions.

3. **Offer pushback and alternatives**
   - Present 2-3 viable approaches when the choice matters.
   - Include trade-offs and a recommendation.
   - Push back when a request adds avoidable risk, global state, unnecessary runtime complexity, or brittle custom maintenance.

4. **Plan reversible steps**
   - Prefer local/project-scoped trials before global installs.
   - Prefer read-only verification before mutation.
   - Add checkpoints before destructive or hard-to-reverse actions.

5. **Execute one phase at a time**
   - Keep each phase small enough to verify.
   - Record what changed and why.
   - Ask for approval before mutations that require it by policy.

6. **Verify with evidence**
   - Run relevant commands/tests/checks.
   - Quote concise evidence, not broad claims.
   - If verification is incomplete, say exactly what remains unverified.

7. **Capture handoff context**
   - Summarize decisions, files changed, commands run, and next steps.
   - For long workflows, write or update a plan/spec in the repo when appropriate.

## Babysitter reference policy

Babysitter may be useful as a reference for structured orchestration patterns. Do not install or invoke the Babysitter Pi package by default.

Current verified finding from local inspection:

- `@a5c-ai/babysitter-pi` is a thin Pi package that exposes skills and slash-command aliases.
- Its extension forwards commands into Pi's native skill flow.
- The packaged Pi plugin does not currently provide a verified native loop driver, task interception layer, or TUI widget runtime in the installed package surface.

Therefore, prefer this lightweight workflow skill unless the user explicitly asks to install or trial Babysitter. If considering adoption, inspect the current package/docs again and distinguish verified behavior from documented claims.

## Safety reminders

- Keep preview-before-mutation approval rules.
- Keep destructive operations opt-in.
- Do not install global tools without explaining what will change and getting approval.
- If docs and implementation disagree, trust verified implementation behavior and mention the discrepancy.
