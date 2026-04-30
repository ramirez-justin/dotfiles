# dotfiles

Personal macOS development environment managed with mise + GNU Stow + Homebrew + 1Password.

## Stack

| Tool | Role |
|------|------|
| [mise](https://mise.jdx.dev) | Task runner, tool version management |
| [GNU Stow](https://www.gnu.org/software/stow/) | Symlink management |
| [Homebrew](https://brew.sh) | Package management via `Brewfile` |
| [1Password CLI](https://developer.1password.com/docs/cli/) | Secret injection |
| git branches | Machine-specific config (`main` = personal, `gametime` = work) |

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
├── claude/          # → ~/.claude/CLAUDE.md, statusline.sh
├── pi/              # → ~/.pi/agent/settings.json, AGENTS.md, env.zsh, prompts/
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

# 4. Install packages (includes 1password-cli)
mise run brew-install

# 5. Install oh-my-zsh + third-party plugins (alias-tips, zsh-completions)
mise run install-omz

# 6. Authenticate 1Password CLI (open 1Password desktop app first)
op account add

# 7. Inject secrets and link
mise run inject-secrets
mise run link

# 8. Open a new shell, then create ~/.zshrc.local with machine-specific secrets
```

> On subsequent runs `mise run bootstrap` does steps 4, 5, and 7 in one command (requires 1Password already authenticated).

## Branches

| Branch | Machine |
|--------|---------|
| `main` | Personal Mac |
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
mise run link            # re-stow all topics (safe to run anytime)
mise run update          # git pull --rebase + re-link
mise run inject-secrets  # write 1Password secrets into local-only Pi/SOFIA env files
mise run brew-dump       # regenerate Brewfile after installing new packages
mise run nvim-update     # pull latest nvim config and commit the submodule pointer
mise run submodule-update # update all submodules to latest

dots                     # cd ~/Repositories/dotfiles
```

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
#    Current topics include: zsh nvim tmux ghostty gh-dash gh git mise claude pi eza marimo aws lazygit rectangle sofia

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
