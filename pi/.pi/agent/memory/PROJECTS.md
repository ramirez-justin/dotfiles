# Project Memory

Stable project facts and caveats that may help future Pi sessions.

## Rules

- Do not store secrets, internal credentials, or copied private config.
- Store only facts that are likely to remain useful across sessions.
- Audit existing project facts before appending new ones.
- Remove or update stale facts when projects change.
- Prefer compact summaries over long project histories.

## Dotfiles

- The dotfiles repository uses GNU Stow topic directories.
- The `pi/` topic maps to `~/.pi/agent`.
- `mise.toml` is the task runner entry point for setup and verification.
- Pi package settings live in `pi/.pi/agent/settings.json`.
- For gametime Pi memory, use SOFIA-inspired markdown files rather than
  database or cloud memory infrastructure.

## Snowflake Objects

- Keep `CLAUDE.md` and `AGENTS.md` synchronized in this repo.
- Keep tool versions aligned across `uv.lock`, CI commands, and pre-commit
  hooks; Ruff version drift can make local hooks and CI disagree.
- For repo CLIs, validate path arguments before filesystem traversal so missing
  paths or file-vs-directory mistakes fail cleanly.
- Snowflake read-only SQL guards should reject multi-statement SQL, not only
  validate the first verb; preserve semicolons inside string literals.
- Use fully qualified Python module paths in runbooks, for example
  `notebooks.tools.deploy_notebook`, so commands work from the repo root.
