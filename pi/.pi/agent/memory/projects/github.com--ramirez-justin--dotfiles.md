# Project Memory: Dotfiles

Stable facts for `github.com/ramirez-justin/dotfiles`.

## Rules

- Do not store secrets, credentials, transient state, or unverified
  guesses.
- Keep facts stable, actionable, and specific to this repository.
- Audit existing facts before adding or changing entries.

## Facts

- The dotfiles repository uses GNU Stow topic directories.
- The `pi/` topic maps to `~/.pi/agent`.
- `mise.toml` is the task runner entry point for setup and verification.
- Pi package settings live in `pi/.pi/agent/settings.json`.
- For gametime Pi memory, use SOFIA-inspired markdown files rather than
  database or cloud memory infrastructure.
