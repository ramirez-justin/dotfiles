# Personal Researcher Fallback Design

## Goal

Prevent personal `main` from loading `pi-claude-code-provider` while no eligible
Claude account is available, without changing `gametime`.

## Design

Remove `npm:pi-claude-code-provider` from personal Pi package settings. Route the
read-only `researcher` role to `openai-codex/gpt-6-luna` with high reasoning and
label it `Researcher (Luna)`.

Update global routing guidance to describe Luna-backed external research rather
than Claude Sonnet. Update the workflow contract first so it requires both the
provider's absence and the new researcher model.

The provider may remain present in npm's local package cache temporarily; it
must not be selected or loaded by Pi. Reconcile configured Pi packages after
the repository change so runtime discovery reflects settings.

## Boundaries

- Do not modify `gametime`.
- Do not remove Claude Code itself.
- Do not alter other model tiers, tools, thinking levels, or agent ownership.
- Keep SOFIA Cloud canonical memory.
- Do not add a silent fallback mechanism; the configured model is explicit.

## Verification

- Demonstrate the workflow contract failing before configuration changes.
- Confirm the complete workflow contract passes afterward.
- Validate Mise tasks and run `check-agent-tiers` and `doctor`.
- Reconcile Pi packages and confirm `pi-claude-code-provider` is no longer
  selected by `pi list`.
- Confirm `gpt-6-luna` remains available in Pi's offline model catalog.
- Start Pi's offline model listing without a Claude-provider warning.
- Run final diagnostics, independent review, and `git diff --check`.
