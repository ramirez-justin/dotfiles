# Dotfiles Repository Design

**Date:** 2026-03-17
**Status:** Approved

## Overview

A personal dotfiles repository for managing development environment configuration across two macOS machines (personal and Gametime work). The system prioritizes reproducibility, simplicity, and a modern toolchain. Nix is replaced entirely.

**Core stack:** git (branch-per-machine) + mise (tasks/tools/env) + GNU Stow (symlinks) + Homebrew Brewfile (packages) + 1Password CLI (secrets)

---

## Repository Structure

Topic-based layout where each folder mirrors `$HOME`. GNU Stow reads each topic and creates symlinks at the correct target paths.

```
dotfiles/
├── mise.toml                  # tools, env, tasks — single entry point
├── Brewfile                   # generated from brew leaves (67 packages)
├── .stow-global-ignore        # excludes mise.toml, Brewfile, docs/, scripts/
├── zsh/
│   ├── .zshrc
│   ├── .zshenv
│   └── .zprofile
├── nvim/
│   └── .config/nvim/
├── tmux/
│   └── .config/tmux/
├── ghostty/
│   └── .config/ghostty/
├── gh-dash/
│   └── .config/gh-dash/
├── gh/
│   └── .config/gh/config.yml
├── git/
│   ├── .gitconfig
│   └── .config/git/
├── mise/
│   └── .config/mise/
├── claude/
│   └── .claude/
│       ├── CLAUDE.md
│       ├── settings.json      # Jira token replaced — injected at runtime via op
│       └── statusline.sh
├── eza/
│   └── .config/eza/
└── marimo/
    └── .config/marimo/
```

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Personal machine base — clean, no work-specific config |
| `gametime` | Work machine — branches from main, adds/overrides work topics |

Work-specific differences on `gametime` branch:
- `git/` — work email (`justin.ramirez@gametime.co`)
- `zsh/` — work aliases, AWS role ARNs, Snowflake config
- `gh-dash/` — Gametime org repo mappings
- `claude/` — work Jira settings

**Workflow:** Make shared improvements on `main`. Regularly `git merge main` into `gametime` to pull in shared updates. Work-specific commits stay isolated on `gametime`.

---

## mise.toml

Single orchestration file for tools, environment, and all tasks.

```toml
[tools]
# dev toolchain managed here (python, node, etc.)
# stow installed via Brewfile, not mise

[tasks.bootstrap]
description = "Full machine setup from scratch"
depends = ["brew-install", "inject-secrets", "link"]

[tasks.brew-install]
description = "Install all packages from Brewfile"
run = "brew bundle --file=Brewfile"

[tasks.link]
description = "Stow all topics into $HOME"
run = "stow --target=$HOME --restow zsh nvim tmux ghostty gh-dash gh git mise claude eza marimo"

[tasks.unlink]
description = "Remove all stow symlinks"
run = "stow --target=$HOME --delete zsh nvim tmux ghostty gh-dash gh git mise claude eza marimo"

[tasks.update]
description = "Pull latest and re-link"
run = ["git pull", "mise run link"]

[tasks.inject-secrets]
description = "Inject 1Password secrets into tool configs (e.g. Claude settings.json)"
run = """
  JIRA_TOKEN=$(op read "op://Work/Jira API Token/credential")
  jq --arg token "$JIRA_TOKEN" '.env.JIRA_API_TOKEN = $token' \
    ~/.claude/settings.json > /tmp/settings.json && mv /tmp/settings.json ~/.claude/settings.json
"""
```

---

## Secret Management

All secrets are removed from config files and stored in 1Password. Two injection patterns:

### Shell environment variables (`.zshrc`)

Secrets injected inline at shell startup via `op read`:

```zsh
export GITHUB_TOKEN=$(op read "op://Personal/GitHub Token/credential")
export SNOWFLAKE_PASSWORD=$(op read "op://Work/Snowflake/password")
# AWS role ARNs, etc.
```

The `op` CLI handles auth — on a new machine, `op signin` is a one-time step.

### Tool config files (`~/.claude/settings.json`)

The Jira API token is removed from `settings.json` in the repo. `mise run inject-secrets` reads it from 1Password and writes it into the live config file. This task runs as part of `bootstrap` and can be re-run any time.

Items to migrate to 1Password before first commit:
- `settings.json` — `JIRA_API_TOKEN`
- `.zshrc` — GitHub token for Terraform
- `.zshrc` — any hardcoded AWS role ARNs or Snowflake credentials not yet using `op read`

---

## Bootstrap Flow

On a fresh machine:

```bash
# 1. Install Homebrew (if not present)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Install mise
curl https://mise.run | sh

# 3. Clone dotfiles
git clone <repo> ~/Repositories/dotfiles
cd ~/Repositories/dotfiles

# 4. Switch to machine branch (work machine only)
git checkout gametime

# 5. Activate mise in current shell
eval "$(mise activate zsh)"

# 6. Run full bootstrap
mise run bootstrap
```

`bootstrap` runs: `brew-install` → `inject-secrets` → `link`

After bootstrap, open a new shell — the stowed `.zshrc` activates mise permanently.

---

## Homebrew Brewfile

Generated from `brew leaves` (67 top-level formulae, not transitive deps). Transitive dependencies are resolved automatically by `brew bundle install`.

Current intentional installs include: `neovim`, `tmux`, `mise`, `uv`, `gh`, `fzf`, `ripgrep`, `lazygit`, `bat`, `eza`, `ghostty`, `stow`, and ~60 others.

Casks tracked: `1password-cli`, `aws-vault-binary`, font casks (Fira Code, Maple Mono), `mongodb-compass`, `session-manager-plugin`.

---

## What This Replaces

| Before | After |
|--------|-------|
| Nix / home-manager | Homebrew Brewfile + mise |
| Makefile / bootstrap.sh | `mise run bootstrap` |
| direnv | mise `[env]` section |
| Manual symlinks / no management | GNU Stow |
| Secrets in plain `.zshrc` | 1Password CLI via `op read` |
| Jira token in `settings.json` | `mise run inject-secrets` |

---

## Non-Goals

- Linux support (macOS only for now)
- Automated secret rotation
- GUI app preferences (e.g. iTerm2, system preferences)
- Managing SSH keys (handled separately via 1Password SSH agent)
