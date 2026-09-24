# Main Safe Configuration Improvements

## Goal

Make exactly two personal-safe changes derived from `origin/gametime`: update
Sol/Luna routing to GPT-6 and stabilize the Homebrew doctor check. Do not import
any other branch behavior or dependency.

## Scope

### Model routing

Update the balanced execution and evidence roles to the available GPT-6 model
generation:

- personal default and `worker`: `openai-codex/gpt-6-sol`
- `Explore` and `verifier`: `openai-codex/gpt-6-luna`

Keep the existing specialized routing unchanged:

- planning and review remain on GPT-5.6 Terra;
- Oracle architecture decisions, complex planning, and implementation remain on
  GPT-6 Astra;
- external research remains on Claude Sonnet.

Before changing the contract or configuration, confirm both GPT-6 aliases in
Pi's offline model catalog. Then update the workflow contract before the
configuration so the model transition is exercised as a failing test first.

### Stable Homebrew doctor check

Change only the Brewfile portion of `mise run doctor`. The check will:

1. resolve Homebrew's prefix and add its binary directories to `PATH`;
2. set `HOMEBREW_NO_AUTO_UPDATE=1`;
3. run `brew bundle check --no-upgrade` against the repository Brewfile.

This keeps doctor read-only and verifies installed dependencies without failing
solely because newer package versions are available.

## Boundaries

Do not add or change:

- tmux calendar OAuth;
- Marp or other developer tools;
- work integrations, identities, or secret references;
- Pi Intercom;
- local Markdown memory or the memory governor;
- SOFIA Cloud configuration or its canonical-memory ownership;
- submodules or Neovim configuration;
- existing unrelated working-tree changes.

Before implementation, record a full binary patch for every dirty tracked file
and complete staged, unstaged, and untracked path lists. Retain hashes for the
independent `mise.lock` and `zsh/.zshrc` changes. Final verification must compare
against that baseline so preservation is objective.

The broader Pi workflow files already in the baseline belong to the separately
approved workflow-parity rollout. Do not mutate them beyond the model-routing
changes above. Per Justin's explicit instruction, commit that preserved work in
logical groups after this implementation passes verification.

No package installation or cloud mutation is required.

## Failure Handling

- Before any tracked contract or configuration mutation, model routing changes
  stop if either GPT-6 alias is absent from Pi's offline model catalog.
- Doctor changes stop if the no-upgrade Brewfile check fails for a genuinely
  missing dependency.
- Existing workflow checks remain fail-closed; no fallback model or agent is
  introduced.

## Verification

- Capture the complete dirty-worktree baseline before implementation and prove
  unrelated prior changes remain represented afterward.
- Confirm both GPT-6 aliases before mutating tracked contract or config files.
- Demonstrate the model contract failing before configuration changes.
- Run the complete workflow contract after implementation.
- Run `mise tasks validate` and `mise run check-agent-tiers`.
- Confirm `gpt-6-sol` and `gpt-6-luna` in Pi's offline model catalog.
- Run `mise run doctor` and require a zero exit.
- Run diagnostics and `git diff --check`.
- Inspect the final diff to confirm scope and preservation of prior changes.
