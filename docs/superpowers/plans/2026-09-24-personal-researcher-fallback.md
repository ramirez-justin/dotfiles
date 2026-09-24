# Personal Researcher Fallback Implementation Plan

> **For agentic workers:** Use the existing single-writer workflow. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop loading the unavailable Claude provider on personal `main` and
route research through GPT-6 Luna.

**Architecture:** Change the workflow contract first, then make minimal
settings, agent-frontmatter, and routing-guidance edits. Reconcile Pi packages
only after static verification passes.

**Tech Stack:** JSON, Markdown agent definitions, Python `unittest`, Pi CLI.

**Design:**
`docs/superpowers/specs/2026-09-24-personal-researcher-fallback-design.md`

---

## Tasks

### Task 1: Add the failing contract

**Files:**

- Modify: `pi/.pi/agent/tests/test_agent_workflow.py`

- [ ] Require `npm:pi-claude-code-provider` to be absent.
- [ ] Require `researcher.md` to use `openai-codex/gpt-6-luna` with high
  reasoning.
- [ ] Run the contract and confirm failures name the selected provider and old
  Sonnet model.

### Task 2: Change personal routing

**Files:**

- Modify: `pi/.pi/agent/settings.json`
- Modify: `pi/.pi/agent/agents/researcher.md`
- Modify: `pi/.pi/agent/AGENTS.md`
- Modify:
  `docs/superpowers/specs/2026-09-24-main-safe-config-improvements-design.md`

- [ ] Remove only `npm:pi-claude-code-provider` from settings.
- [ ] Set the researcher model to `openai-codex/gpt-6-luna` and display name to
  `Researcher (Luna)`; retain high reasoning and read-only tools.
- [ ] Replace Claude-specific routing guidance with GPT-6 Luna guidance.
- [ ] Mark the earlier design's Claude statement as superseded by the fallback
  design.
- [ ] Run the complete workflow contract.

### Task 3: Reconcile and verify

**Files outside the repository:**

- Reconcile: `~/.pi/agent/npm/`

- [ ] Run `mise tasks validate`, `mise run check-agent-tiers`, and
  `mise run doctor`.
- [ ] Run `mise run pi-update` to reconcile selected packages.
- [ ] Confirm `mise exec -- pi list` omits `pi-claude-code-provider`.
- [ ] Confirm offline model listing includes `gpt-6-luna` and emits no Claude
  provider warning.
- [ ] Run Ruff, `git diff --check`, LSP, and pi-lens diagnostics.
- [ ] Run independent correctness and Ponytail simplicity reviews.
- [ ] Commit the config/test change and its design/plan documentation as logical
  Conventional Commits.
- [ ] Confirm the worktree is clean and rerun the workflow contract and doctor.
