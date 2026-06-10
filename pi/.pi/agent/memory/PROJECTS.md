# Project Memory

Stable project facts and caveats that may help future Pi sessions.

## Rules

- Do not store secrets, internal credentials, or copied private config.
- Store only facts that are likely to remain useful across sessions.
- Remove or update stale facts when projects change.

## Dotfiles

- The dotfiles repository uses GNU Stow topic directories.
- The `pi/` topic maps to `~/.pi/agent`.
- `mise.toml` is the task runner entry point for setup and verification.
- Pi package settings live in `pi/.pi/agent/settings.json`.
