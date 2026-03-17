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
├── Brewfile                   # generated from brew bundle dump, curated to intentional installs
├── .stow-global-ignore        # excludes .git, docs/, README.md from stow processing
├── zsh/
│   ├── .zshrc                 # sources .zshrc.local at end for machine-specific additions
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
│   └── .config/gh/
│       └── config.yml         # hosts.yml is NOT tracked — contains auth tokens
├── git/
│   ├── .gitconfig
│   └── .config/git/
├── mise/
│   └── .config/mise/
├── claude/
│   └── .claude/
│       ├── CLAUDE.md
│       ├── settings.json      # placeholder token ("") — real value written by inject-secrets
│       └── statusline.sh
├── eza/
│   └── .config/eza/
└── marimo/
    └── .config/marimo/        # marimo notebook/app configuration and preferences
```

**Note on `claude/`:** `settings.json` in the repo contains an empty string placeholder for `JIRA_API_TOKEN`. The `inject-secrets` task writes the real token to `~/.claude/settings.json` as a **real file** (not a symlink) — see Secret Management section. The claude topic is stowed normally for `CLAUDE.md` and `statusline.sh`; `settings.json` is excluded from stow via `.stow-local-ignore` inside the `claude/` topic.

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Personal machine base — clean, no work-specific config |
| `gametime` | Work machine — branches from main, adds/overrides work topics |

Work-specific differences on `gametime` branch:
- `git/` — work email (`justin.ramirez@gametime.co`)
- `gh-dash/` — Gametime org repo mappings
- `claude/` — work Jira settings placeholder

**Merge conflict strategy for shared files:** Files that differ between machines (e.g. `.zshrc`) use a local override pattern. `.zshrc` on `main` sources `~/.zshrc.local` at the end if it exists. Machine-specific aliases, env vars, and credentials live in `~/.zshrc.local` on each machine — this file is never committed. This keeps `.zshrc` itself mergeable between branches with no conflicts.

**Workflow:** Make shared improvements on `main`. Regularly `git merge main` into `gametime` to pull in shared updates. Work-specific commits stay isolated to `gametime`.

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
run = "git pull --rebase && mise run link"

[tasks.brew-dump]
description = "Regenerate Brewfile from currently installed packages (review output after running — removes previous curation)"
run = "brew bundle dump --force --file=Brewfile"

[tasks.inject-secrets]
description = "Write 1Password secrets into tool configs as real files (not symlinks)"
run = """
  JIRA_TOKEN=$(op read "op://Work/Jira API Token/credential")
  jq --arg token "$JIRA_TOKEN" '.env.JIRA_API_TOKEN = $token' \
    "$MISE_PROJECT_ROOT/claude/.claude/settings.json" > ~/.claude/settings.json
"""
```

**Task ordering in `bootstrap`:** `depends` in mise runs tasks in parallel by default unless there are explicit dependencies. `brew-install` must complete before `inject-secrets` (needs `jq`) and before `link` (needs `stow`). Declare these explicitly in the final `mise.toml`:

```toml
[tasks.inject-secrets]
depends = ["brew-install"]

[tasks.link]
depends = ["brew-install"]
```

---

## Secret Management

All secrets are removed from config files and stored in 1Password. Two injection patterns:

### Shell environment variables (`.zshrc` + `.zshrc.local`)

Shared, non-sensitive shell config lives in `.zshrc` (tracked). Secrets and machine-specific config live in `~/.zshrc.local` (never committed, sourced at end of `.zshrc`):

```zsh
# bottom of .zshrc
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local
```

Inside `~/.zshrc.local` on each machine:
```zsh
export GITHUB_TOKEN=$(op read "op://Personal/GitHub Token/credential")
export SNOWFLAKE_PASSWORD=$(op read "op://Work/Snowflake/password")
# AWS role ARNs, etc.
```

The `op` CLI handles auth — on a new machine, open the 1Password desktop app and run `op account add` to link the CLI. The desktop app must be open and unlocked for `op read` calls to succeed.

**AWS credentials** are managed by `aws-vault` (already in Brewfile as `aws-vault-binary`), which stores credentials in the macOS system keychain — not in 1Password or shell config. AWS role ARNs (non-secret) can live in `.zshrc.local`.

### Tool config files (`~/.claude/settings.json`)

The Jira API token is replaced with an empty string placeholder in the repo's `claude/.claude/settings.json`. The `inject-secrets` task reads the real token from 1Password and writes a rendered `~/.claude/settings.json` as a **real file** (not a symlink) so the live file can be modified at runtime without touching the repo.

`~/.claude/settings.json` is excluded from stow via a `.stow-local-ignore` file inside the `claude/` topic. `CLAUDE.md` and `statusline.sh` are stowed normally as symlinks.

**Pre-commit protection:** A pre-commit hook checks that `JIRA_API_TOKEN` in `settings.json` is an empty string before allowing a commit. This prevents accidentally committing a live token after `inject-secrets` has run.

Items to migrate to 1Password before first commit:
- `settings.json` — `JIRA_API_TOKEN`
- `.zshrc` — GitHub token for Terraform → move to `.zshrc.local`
- `.zshrc` — any hardcoded AWS role ARNs or Snowflake credentials → move to `.zshrc.local`

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

# 5. Activate mise in current shell session
eval "$(mise activate zsh)"

# 6. Install all packages (includes 1password-cli cask)
mise run brew-install

# 7. Install 1Password desktop app manually, open it, sign in, then link CLI
op account add

# 8. Run remaining bootstrap steps
mise run inject-secrets && mise run link
```

The full `mise run bootstrap` shortcut works on subsequent runs once 1Password is set up. On a fresh machine, steps 6–8 are split because `inject-secrets` requires the 1Password CLI (installed in step 6) and an authenticated session (step 7).

After bootstrap, open a new shell. The stowed `.zshrc` contains `eval "$(mise activate zsh)"` so mise is permanently active. Then create `~/.zshrc.local` with machine-specific secrets.

---

## Homebrew Brewfile

Generated with `brew bundle dump` and manually curated to remove purely transitive dependencies. `mise run brew-dump` regenerates it after installing new packages.

Current intentional installs include: `neovim`, `tmux`, `mise`, `uv`, `gh`, `fzf`, `ripgrep`, `lazygit`, `bat`, `eza`, `stow`, `jq`, and others.

Casks tracked: `1password-cli`, `aws-vault-binary`, font casks (Fira Code, Maple Mono), `mongodb-compass`, `session-manager-plugin`.

---

## What This Replaces

| Before | After |
|--------|-------|
| Nix / home-manager | Homebrew Brewfile + mise |
| Makefile / bootstrap.sh | `mise run bootstrap` |
| direnv | mise `[env]` section |
| Manual symlinks / no management | GNU Stow |
| Secrets in plain `.zshrc` | `~/.zshrc.local` (untracked) + `op read` |
| Jira token in `settings.json` | `mise run inject-secrets` from 1Password |

---

## Non-Goals

- Linux support (macOS only for now)
- Automated secret rotation
- GUI app preferences (e.g. system preferences, app-specific settings)
- Managing SSH keys (handled separately via 1Password SSH agent)
- AWS credential storage (handled by aws-vault + macOS keychain)
