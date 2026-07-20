# dotfiles

Personal macOS development environment managed with mise + GNU Stow + Homebrew + 1Password.

## Stack

| Tool                                                       | Role                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| [mise](https://mise.jdx.dev)                               | Task runner, tool version management                           |
| [GNU Stow](https://www.gnu.org/software/stow/)             | Symlink management                                             |
| [Homebrew](https://brew.sh)                                | Package management via `Brewfile`                              |
| [1Password CLI](https://developer.1password.com/docs/cli/) | Secret injection                                               |
| git branches                                               | Machine-specific config (`main` = personal, `gametime` = work) |

## Structure

Topic-based layout — each folder mirrors `$HOME`. Stow creates symlinks from the repo into the live system.

```
dotfiles/
├── mise.toml        # all tasks — single entry point
├── Brewfile         # curated intentional installs
├── zsh/             # → ~/.zshrc, ~/.zshenv, ~/.zprofile
├── nvim/            # → ~/.config/nvim/ (git submodule)
├── tmux/            # → ~/.config/tmux/
├── ghostty/         # → ~/.config/ghostty/
├── gh-dash/         # → ~/.config/gh-dash/
├── gh/              # → ~/.config/gh/config.yml
├── git/             # → ~/.gitconfig, ~/.config/git/
├── mise/            # → ~/.config/mise/
├── claude/          # → ~/.claude/settings.json, CLAUDE.md, statusline.sh
├── pi/              # → ~/.pi/agent/settings.json, AGENTS.md, env.zsh, prompts/
├── snowflake/       # → ~/.snowflake/connections.toml.example
├── eza/             # → ~/.config/eza/ (submodule: eza-themes)
└── marimo/          # → ~/.config/marimo/
```

## Fresh Machine Bootstrap

```bash
# 1. Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"

# 2. mise (official installer)
curl https://mise.run | sh
eval "$(~/.local/bin/mise activate zsh)"

# 3. Clone (with submodules)
git clone --recurse-submodules git@github.com:ramirez-justin/dotfiles.git ~/Repositories/dotfiles
cd ~/Repositories/dotfiles
git checkout gametime  # work machine — skip for personal

# 4. Install packages needed for authentication, including 1Password CLI
mise run brew-install

# 5. Authenticate 1Password CLI (open 1Password desktop app first)
op account add

# 6. Run the managed bootstrap, including Chalk CLI installation
mise run bootstrap

# 7. Authenticate Chalk through the browser with the work Google account
chalk login

# 8. Open a new shell, then create ~/.zshrc.local with machine-specific secrets
# 9. Copy snowflake/.snowflake/connections.toml.example to
#    ~/.snowflake/connections.toml and verify with:
#    snow connection test -c default
```

> On subsequent runs, `mise run bootstrap` updates managed packages, including
> the Chalk CLI. It requires 1Password to be authenticated. Chalk login state
> remains in `~/.chalk.yml`.

## Branches

| Branch     | Machine             |
| ---------- | ------------------- |
| `main`     | Personal Mac        |
| `gametime` | Work Mac (Gametime) |

Work on shared config on `main`. Merge into `gametime` to pick up changes:

```bash
git checkout main
# make changes, commit
git checkout gametime
git merge main
```

## Daily Commands

```bash
mise run link            # re-stow all topics without package changes
mise run update          # git pull --rebase + re-link
mise run inject-secrets  # re-inject 1Password secrets into ~/.claude/settings.json and ~/.pi/agent/env.local.zsh

# Optional Pi Notion secret, if IT grants an integration/OAuth token later:
# export NOTION_API_KEY_OP_REF="op://..."
# mise run inject-secrets
# Linear is injected from 1Password item: Employee/linear_api_key/API key.

mise run snowflake-ai-kit-install  # install/update Cortex Code for Pi Snowflake work
mise run chalk-install  # install/update Chalk CLI without full bootstrap

# pi workflow shortcuts, backed by the Superpowers skills package:
# /brainstorm, /write-plan, /execute-plan, /debug, /tdd, /finish, /code-review

# Pi personal workflows:
# - Subagents: npm:@tintinweb/pi-subagents with GPT-5.6 model-tiered agents.
#   Use Explore/Plan for built-in compatibility and /agents for management.
# - Memory: ~/.pi/agent/memory/*.md, managed through the memory-management
#   skill.
# - Skill creation: use the skill-creation skill to draft local skills under
#   pi/.pi/agent/skills/.
mise run brew-dump       # regenerate Brewfile after installing new packages
mise run nvim-update     # pull latest nvim config and commit the submodule pointer
mise run submodule-update # update all submodules to latest

dots                     # cd ~/Repositories/dotfiles
```

## Chalk and Pi

Pi reaches Chalk through the hosted MCP server using personal credentials from
the Chalk CLI. Authenticate once after installation:

```bash
chalk login
```

If Pi reports that Chalk is not installed, run:

```bash
mise run chalk-install
```

If Pi reports that Chalk is not authenticated, rerun `chalk login`, restart Pi,
and reconnect the `chalk` MCP server. Credentials remain in `~/.chalk.yml` and
must not be copied into this repository.

## Machine-Specific Secrets

Secrets never live in this repo. Each machine has a `~/.zshrc.local` (not committed) that sources credentials from 1Password:

```zsh
# ~/.zshrc.local
export GITHUB_TOKEN=$(op read "op://Work/GitHub Token/credential")
export TG_ROLE_ARN="arn:aws:iam::..."   # non-secret, machine-specific
# aws-ecr-login alias with account-specific ECR URL
```

## Editing a Config

**Repo files are real. `~/.config/...` paths are symlinks pointing into the repo.**

```
~/.config/tmux  →  ~/Repositories/dotfiles/tmux/.config/tmux  (real files here)
~/.zshrc        →  ~/Repositories/dotfiles/zsh/.zshrc          (real file here)
```

So editing `~/.config/tmux/tmux.conf` edits through the symlink directly into the repo. The change is live immediately and already staged — just commit:

```bash
nvim ~/.config/tmux/tmux.conf   # edits the repo file via symlink
dots
git add tmux/
git commit -m "feat(tmux): ..."
git push
```

## Adding a New Topic

```bash
# 1. Create the topic folder mirroring $HOME
mkdir -p ~/Repositories/dotfiles/mytool/.config/mytool

# 2. Copy existing config
cp -r ~/.config/mytool ~/Repositories/dotfiles/mytool/.config/mytool

# 3. Add topic to the stow commands in mise.toml (link, unlink tasks)
#    Current topics include:
#    zsh nvim tmux ghostty gh-dash gh git mise claude pi eza marimo snowflake

# 4. Stow it
stow --dir=~/Repositories/dotfiles --target=$HOME --restow mytool

# 5. Commit
git add mytool/ mise.toml
git commit -m "feat: add mytool topic"
```

## Submodules

`nvim` and `eza-themes` are git submodules with their own repos.

```bash
# Clone dotfiles with submodules
git clone --recurse-submodules <repo>

# Update a submodule to its latest commit
mise run nvim-update

# Update all submodules
mise run submodule-update
```
