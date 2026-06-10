# Pi Hermes-Like Capabilities Design

## Goal

Add a personal, dotfiles-backed roadmap for Hermes-like Pi capabilities:
subagents first, durable memory second, and assisted skill creation third.
The implementation should use existing Pi mechanisms before adding custom
runtime code.

## Scope

This is personal automation for this dotfiles repository, not a public Pi
package. Files should live under the existing `pi/` stow topic when they affect
Pi runtime behavior. Documentation and plans may live under `docs/`.

The work intentionally avoids forking Pi or reimplementing Hermes. Instead, it
uses Pi packages, settings, skills, and small local files that are easy to
review and revert.

## Phase 1: Subagents

Use `pi-subagents` as the foundation for delegation. Add it to Pi packages and
configure opinionated personal defaults.

Initial subagent roles:

- `researcher`: evidence gathering, read-only exploration, concise summary.
- `reviewer`: risks, correctness issues, tests, and concrete findings.
- `implementer`: focused code changes after a plan is approved.
- `planner`: turns approved designs into step-by-step plans.
- `verifier`: runs checks and reports evidence before completion claims.

Add `pi-intercom` only if we decide child agents need to ask questions while
running in the background. It should not be required for the first usable slice.

Success criteria:

- `pi-subagents` is available from the normal Pi package list.
- Pi can discover and run the named helper roles.
- Defaults are conservative: research and review roles do not edit files.
- Configuration is stored in dotfiles, not only in live home-directory state.

## Phase 2: Memory

Add reviewable, explicit memory files rather than automatic chat-log retention.
Memory should preserve durable preferences and workflow facts, not transient
session details.

Initial memory files:

- `pi/.pi/agent/memory/USER.md`: durable user preferences.
- `pi/.pi/agent/memory/WORKFLOWS.md`: repeatable workflow conventions.
- `pi/.pi/agent/memory/PROJECTS.md`: stable project facts and caveats.

Add a local memory-management skill that instructs Pi to propose memory updates
as diffs and wait for approval before writing. The skill should separate
preferences, workflows, project facts, and rejected memories.

Success criteria:

- Memory files are versioned in dotfiles.
- Memory updates are explicit, reviewable, and never contain secrets.
- Pi has a clear workflow for proposing and applying memory updates.

## Phase 3: Skill Creation

Add a local skill that helps Pi create new Pi skills from repeated workflows.
This should be a human-approved workflow, not autonomous self-modification.

Skill creation flow:

1. Collect examples of a repeated workflow.
2. Decide whether a skill, prompt, script, or note is the right artifact.
3. Draft a valid `SKILL.md` with narrow triggers and clear instructions.
4. Self-review for frontmatter, scope, safety, and ambiguity.
5. Install as experimental under the dotfiles-backed Pi skills directory.
6. Promote only after repeated successful use.

Success criteria:

- New skills follow Pi's Agent Skills format.
- Skill creation is opt-in and approval-gated.
- Skills stay focused and do not bloat the default prompt.

## Architecture

Prefer static dotfiles and Pi package settings first:

- `pi/.pi/agent/settings.json` for package and subagent configuration.
- `pi/.pi/agent/skills/*/SKILL.md` for local workflows.
- `pi/.pi/agent/memory/*.md` for durable memory.
- Existing `mise run link` to stow runtime files into `~/.pi/agent`.

A custom Pi extension may be added later for commands such as `/memory` or
`/skill-create`, but only after the static workflows prove useful.

## Safety

- Do not persist secrets in memory files.
- Do not let subagents mutate files unless the chosen role explicitly allows it.
- Require approval before writing memory or creating skills.
- Keep changes small and reversible.
- Prefer documented Pi settings and package behavior over hidden scripts.

## Verification

For each phase:

- Validate JSON settings.
- Run `mise run link` or equivalent stow verification when appropriate.
- Run `mise exec -- pi --offline --list-models` as a startup smoke test.
- Inspect resulting dotfiles with `git diff` before declaring complete.

## Deferred Work

- Public reusable Pi package.
- Autonomous session-end memory extraction.
- Automatic skill generation from logs.
- Hermes-compatible profile migration.
- Cloud or messaging integration.
