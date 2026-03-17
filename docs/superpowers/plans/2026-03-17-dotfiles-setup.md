# Dotfiles Repository Setup Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate an existing macOS development environment into a reproducible dotfiles repo managed by mise + GNU Stow + Homebrew + 1Password.

**Architecture:** Topic-based folder structure where each folder mirrors `$HOME`. GNU Stow creates symlinks from the repo into the live system. mise.toml orchestrates all setup tasks. Secrets never live in the repo — injected at runtime from 1Password.

**Tech Stack:** mise, GNU Stow, Homebrew (brew bundle), 1Password CLI (op), git (branch-per-machine), zsh, jq

---

## File Map

| File | What it does |
|------|-------------|
| `mise.toml` | All tasks (bootstrap, link, unlink, update, inject-secrets, brew-dump) + tool versions |
| `Brewfile` | Curated list of intentional Homebrew installs |
| `.stow-global-ignore` | Prevents stow from symlinking repo meta-files (docs/, .git, README) |
| `.git/hooks/pre-commit` | Blocks commits where `JIRA_API_TOKEN` is non-empty in settings.json |
| `zsh/.zshrc` | Shell config — secrets removed, sources `~/.zshrc.local` at end |
| `zsh/.zshenv` | Cargo env sourcing |
| `zsh/.zprofile` | Homebrew shellenv, SnowSQL PATH |
| `nvim/.config/nvim/` | Neovim Lua config (lazy.nvim) |
| `tmux/.config/tmux/` | Tmux config + plugins |
| `ghostty/.config/ghostty/config` | Ghostty terminal config |
| `gh-dash/.config/gh-dash/config.yml` | GitHub dashboard config |
| `gh/.config/gh/config.yml` | gh CLI config (hosts.yml excluded — contains auth token) |
| `git/.gitconfig` | Git user config |
| `git/.config/git/ignore` | Global gitignore |
| `mise/.config/mise/config.toml` | mise global tool versions and settings |
| `claude/.claude/CLAUDE.md` | Claude Code global instructions |
| `claude/.claude/settings.json` | Claude settings with empty JIRA_API_TOKEN placeholder |
| `claude/.claude/statusline.sh` | Claude status line script |
| `claude/.claude/.stow-local-ignore` | Excludes settings.json from stow (written as real file by inject-secrets) |
| `eza/.config/eza/` | eza theme config |
| `marimo/.config/marimo/` | Marimo config |

---

## Task 1: Repo skeleton and mise.toml

**Files:**
- Create: `mise.toml`
- Create: `.stow-global-ignore`

- [ ] **Step 1: Write `.stow-global-ignore`**

```
# Repo meta — never symlink these
.git
.gitignore
docs
README.md
mise.toml
Brewfile
```

- [ ] **Step 2: Write `mise.toml` with all tasks**

```toml
[tools]
python = "3.12"

[tasks.bootstrap]
description = "Full machine setup (after 1Password is authenticated)"
depends = ["brew-install", "inject-secrets", "link"]

[tasks.brew-install]
description = "Install all packages from Brewfile"
run = "brew bundle --file={{config_root}}/Brewfile"

[tasks.link]
description = "Stow all topics into $HOME"
depends = ["brew-install"]
run = "stow --dir={{config_root}} --target=$HOME --restow zsh nvim tmux ghostty gh-dash gh git mise claude eza marimo"

[tasks.unlink]
description = "Remove all stow symlinks"
run = "stow --dir={{config_root}} --target=$HOME --delete zsh nvim tmux ghostty gh-dash gh git mise claude eza marimo"

[tasks.update]
description = "Pull latest dotfiles and re-link"
run = "git -C {{config_root}} pull --rebase && mise run link"

[tasks.brew-dump]
description = "Regenerate Brewfile (review and curate after running)"
run = "brew bundle dump --force --file={{config_root}}/Brewfile"

[tasks.inject-secrets]
description = "Write 1Password secrets into live tool configs"
depends = ["brew-install"]
run = """
  JIRA_TOKEN=$(op read "op://Work/Jira API Token/credential")
  jq --arg token "$JIRA_TOKEN" '.env.JIRA_API_TOKEN = $token' \
    "{{config_root}}/claude/.claude/settings.json" > ~/.claude/settings.json
"""
```

- [ ] **Step 3: Verify mise.toml is valid**

```bash
cd ~/Repositories/dotfiles && mise tasks
```

Expected: lists `bootstrap`, `brew-install`, `link`, `unlink`, `update`, `brew-dump`, `inject-secrets`

- [ ] **Step 4: Commit**

```bash
git add mise.toml .stow-global-ignore
git commit -m "feat: add mise.toml task runner and stow ignore rules"
```

---

## Task 2: Generate and curate Brewfile

**Files:**
- Create: `Brewfile`

- [ ] **Step 1: Generate Brewfile from brew leaves**

`brew leaves` shows only top-level intentional installs (not transitive deps). Use this as the base for curation — it's already 67 packages vs 210 total.

```bash
cd ~/Repositories/dotfiles
brew bundle dump --force --file=Brewfile
```

- [ ] **Step 2: Filter to intentional installs**

Open `Brewfile`. Remove entries that are clearly transitive dependencies (libraries like `abseil`, `ada-url`, `aom`, `apr`, `argon2`, `brotli`, `cairo`, etc.). Keep everything that is a tool you directly use.

Known intentional keeps: `autojump`, `awscli`, `bat`, `chafa`, `dbt`, `deno`, `diffnav`, `direnv`, `eza`, `fd`, `fzf`, `gh`, `ghostty`, `imagemagick`, `jq`, `lazydocker`, `lazygit`, `luarocks`, `mise`, `neovim`, `pngpaste`, `postgresql@14`, `pre-commit`, `prettier`, `rbenv`, `ripgrep`, `shellcheck`, `shfmt`, `sops`, `spaceship`, `stow`, `stylua`, `tmux`, `tree`, `uv`, `viu`

Add casks section if not present:
```ruby
cask "1password-cli"
cask "aws-vault-binary"
cask "font-fira-code-nerd-font"
cask "font-maple-mono"
cask "mongodb-compass"
cask "session-manager-plugin"
```

- [ ] **Step 3: Verify Brewfile is valid**

```bash
brew bundle check --file=Brewfile
```

Expected: `The Brewfile's dependencies are satisfied.`

- [ ] **Step 4: Commit**

```bash
git add Brewfile
git commit -m "feat: add curated Brewfile from brew leaves"
```

---

## Task 3: Migrate Jira API token to 1Password

**Files:**
- Modify: `~/.claude/settings.json` (remove live token before it ever touches the repo)

- [ ] **Step 1: Create 1Password item for Jira API token**

Open 1Password app → New Item → API Credential
- Title: `Jira API Token`
- Vault: `Work`
- Field name: `credential`
- Value: paste the current token from `~/.claude/settings.json` (the `JIRA_API_TOKEN` value)

Save.

- [ ] **Step 2: Verify op can read it**

```bash
op read "op://Work/Jira API Token/credential"
```

Expected: prints the token value.

- [ ] **Step 3: Manually replace token in live settings.json with empty string**

```bash
jq '.env.JIRA_API_TOKEN = ""' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json
```

- [ ] **Step 4: Restore the live settings.json with the real token**

The claude topic template doesn't exist yet (created in Task 6). For now, write the token back directly:

```bash
jq --arg token "$(op read "op://Work/Jira API Token/credential")" \
  '.env.JIRA_API_TOKEN = $token' /tmp/s.json > ~/.claude/settings.json
```

Or simply re-open Claude Code — it will work once the live file has the real token.
Full end-to-end verification of `mise run inject-secrets` happens in Task 10.

---

## Task 4: Set up zsh topic

**Files:**
- Create: `zsh/.zshrc`
- Create: `zsh/.zshenv`
- Create: `zsh/.zprofile`

- [ ] **Step 1: Create topic directory**

```bash
mkdir -p ~/Repositories/dotfiles/zsh
```

- [ ] **Step 2: Copy zsh files into topic**

```bash
cp ~/.zshrc ~/Repositories/dotfiles/zsh/.zshrc
cp ~/.zshenv ~/Repositories/dotfiles/zsh/.zshenv
cp ~/.zprofile ~/Repositories/dotfiles/zsh/.zprofile
```

- [ ] **Step 3: Strip secrets from `zsh/.zshrc`**

Open `~/Repositories/dotfiles/zsh/.zshrc` and remove ALL of the following — they will live in `~/.zshrc.local`:
- Any `export GITHUB_TOKEN=...` or similar hardcoded tokens
- AWS role ARN exports
- Snowflake credential exports
- Any `export` that contains an actual secret value (not a reference to `op read`)

- [ ] **Step 4: Add `.zshrc.local` sourcing at the bottom of `zsh/.zshrc`**

Append to `zsh/.zshrc`:
```zsh
# Machine-specific config and secrets (not tracked in dotfiles)
[[ -f ~/.zshrc.local ]] && source ~/.zshrc.local
```

- [ ] **Step 5: Add mise activation to `zsh/.zshrc`** (if not already present)

Ensure this line exists in `zsh/.zshrc`:
```zsh
eval "$(mise activate zsh)"
```

- [ ] **Step 6: Create `~/.zshrc.local` on this machine with the stripped secrets**

```bash
cat > ~/.zshrc.local << 'EOF'
# Gametime work machine — secrets injected from 1Password
export GITHUB_TOKEN=$(op read "op://Work/GitHub Token/credential")
# Add AWS role ARNs, Snowflake credentials, etc. here
EOF
```

Populate with any secrets you removed from `.zshrc` in Step 3.

- [ ] **Step 7: Verify shell still works**

```bash
source ~/.zshrc
echo $GITHUB_TOKEN  # should be non-empty if op is authenticated
```

- [ ] **Step 8: Commit**

```bash
cd ~/Repositories/dotfiles
git add zsh/
git commit -m "feat: add zsh topic with secrets moved to .zshrc.local"
```

---

## Task 5: Copy remaining topic configs

**Files:**
- Create: all remaining topic directories and their contents

- [ ] **Step 1: Create topic directories and copy configs**

```bash
cd ~/Repositories/dotfiles

# nvim
mkdir -p nvim/.config
cp -r ~/.config/nvim nvim/.config/nvim

# tmux
mkdir -p tmux/.config
cp -r ~/.config/tmux tmux/.config/tmux

# ghostty
mkdir -p ghostty/.config/ghostty
cp ~/.config/ghostty/config ghostty/.config/ghostty/config

# gh-dash
mkdir -p gh-dash/.config/gh-dash
cp ~/.config/gh-dash/config.yml gh-dash/.config/gh-dash/config.yml

# gh (config.yml only — NOT hosts.yml)
mkdir -p gh/.config/gh
cp ~/.config/gh/config.yml gh/.config/gh/config.yml

# git
mkdir -p git/.config/git
cp ~/.gitconfig git/.gitconfig
cp ~/.config/git/ignore git/.config/git/ignore

# mise
mkdir -p mise/.config/mise
cp ~/.config/mise/config.toml mise/.config/mise/config.toml

# eza
mkdir -p eza/.config/eza
cp -r ~/.config/eza/eza-themes eza/.config/eza/eza-themes 2>/dev/null || true

# marimo
mkdir -p marimo/.config/marimo
cp -r ~/.config/marimo/. marimo/.config/marimo/ 2>/dev/null || true
```

- [ ] **Step 2: Add `.gitignore` for gh hosts.yml**

```bash
echo ".config/gh/hosts.yml" >> ~/Repositories/dotfiles/gh/.gitignore
```

This prevents accidentally committing the GitHub auth token if `gh/` ever picks up `hosts.yml`.

- [ ] **Step 3: Commit**

```bash
cd ~/Repositories/dotfiles
git add nvim/ tmux/ ghostty/ gh-dash/ gh/ git/ mise/ eza/ marimo/
git commit -m "feat: add nvim, tmux, ghostty, gh-dash, gh, git, mise, eza, marimo topics"
```

---

## Task 6: Set up claude topic

**Files:**
- Create: `claude/.claude/CLAUDE.md`
- Create: `claude/.claude/settings.json` (placeholder token)
- Create: `claude/.claude/statusline.sh`
- Create: `claude/.claude/.stow-local-ignore`

- [ ] **Step 1: Create topic directory**

```bash
mkdir -p ~/Repositories/dotfiles/claude/.claude
```

- [ ] **Step 2: Copy CLAUDE.md and statusline.sh**

```bash
cp ~/.claude/CLAUDE.md ~/Repositories/dotfiles/claude/.claude/CLAUDE.md
cp ~/.claude/statusline.sh ~/Repositories/dotfiles/claude/.claude/statusline.sh
```

- [ ] **Step 3: Copy settings.json with placeholder token**

```bash
jq '.env.JIRA_API_TOKEN = ""' ~/.claude/settings.json \
  > ~/Repositories/dotfiles/claude/.claude/settings.json
```

Verify the placeholder is in place:
```bash
jq '.env.JIRA_API_TOKEN' ~/Repositories/dotfiles/claude/.claude/settings.json
```
Expected: `""`

- [ ] **Step 4: Create `.stow-local-ignore` to exclude `settings.json` from stow**

```bash
cat > ~/Repositories/dotfiles/claude/.claude/.stow-local-ignore << 'EOF'
settings.json
EOF
```

This tells stow not to create a symlink for `settings.json` — it's written as a real file by `inject-secrets` instead.

- [ ] **Step 5: Verify stow dry-run for claude topic**

```bash
cd ~/Repositories/dotfiles
stow --dir=. --target=$HOME --simulate claude
```

Expected: no errors. Should show it will link `CLAUDE.md` and `statusline.sh` but NOT `settings.json`.

- [ ] **Step 6: Commit**

```bash
git add claude/
git commit -m "feat: add claude topic with settings.json placeholder and stow ignore"
```

---

## Task 7: Add pre-commit hook to guard secrets

**Files:**
- Create: `.git/hooks/pre-commit`

- [ ] **Step 1: Write the pre-commit hook**

```bash
cat > ~/Repositories/dotfiles/.git/hooks/pre-commit << 'EOF'
#!/usr/bin/env bash
# Prevent committing a live JIRA_API_TOKEN in claude/settings.json

SETTINGS="claude/.claude/settings.json"

if [[ -f "$SETTINGS" ]]; then
  TOKEN=$(jq -r '.env.JIRA_API_TOKEN // ""' "$SETTINGS")
  if [[ -n "$TOKEN" ]]; then
    echo "ERROR: JIRA_API_TOKEN is non-empty in $SETTINGS"
    echo "Run: jq '.env.JIRA_API_TOKEN = \"\"' $SETTINGS > /tmp/s.json && mv /tmp/s.json $SETTINGS"
    echo "Then re-stage and commit."
    exit 1
  fi
fi

exit 0
EOF
chmod +x ~/Repositories/dotfiles/.git/hooks/pre-commit
```

- [ ] **Step 2: Test the hook blocks a live token**

```bash
cd ~/Repositories/dotfiles

# Temporarily inject a fake token
jq '.env.JIRA_API_TOKEN = "fake-token"' claude/.claude/settings.json > /tmp/s.json
cp /tmp/s.json claude/.claude/settings.json

git add claude/.claude/settings.json
git commit -m "test"
```

Expected: commit is blocked with `ERROR: JIRA_API_TOKEN is non-empty`

- [ ] **Step 3: Restore placeholder and verify hook passes**

```bash
jq '.env.JIRA_API_TOKEN = ""' claude/.claude/settings.json > /tmp/s.json
cp /tmp/s.json claude/.claude/settings.json

git add claude/.claude/settings.json
git commit -m "test"
```

Expected: commit succeeds (or "nothing to commit" if the file was already clean).

---

## Task 8: Run stow and verify all symlinks

**Files:** (no new files — this wires everything together)

- [ ] **Step 1: Check for conflicts before stowing**

```bash
cd ~/Repositories/dotfiles
stow --dir=. --target=$HOME --simulate zsh nvim tmux ghostty gh-dash gh git mise claude eza marimo 2>&1
```

Expected: no `CONFLICT` lines. If conflicts appear, the real file still exists at the target path — remove it first:
```bash
# Example: if ~/.zshrc already exists as a real file
rm ~/.zshrc   # stow will replace it with a symlink
```

- [ ] **Step 2: Remove existing real files that conflict**

For each conflict reported in Step 1, remove the original file. The copy already lives in the topic directory.

```bash
# Common ones to remove:
rm ~/.zshrc ~/.zshenv ~/.zprofile ~/.gitconfig
rm -rf ~/.config/nvim ~/.config/tmux ~/.config/ghostty
rm -rf ~/.config/gh-dash ~/.config/gh ~/.config/git
rm -rf ~/.config/mise ~/.config/eza ~/.config/marimo
rm -rf ~/.claude/CLAUDE.md ~/.claude/statusline.sh
```

**Do not remove `~/.claude/settings.json`** — it is a real file managed by `inject-secrets`, not stow.

- [ ] **Step 3: Run stow**

```bash
cd ~/Repositories/dotfiles
stow --dir=. --target=$HOME --restow zsh nvim tmux ghostty gh-dash gh git mise claude eza marimo
```

Expected: no errors.

- [ ] **Step 4: Verify symlinks exist**

```bash
ls -la ~/.zshrc ~/.gitconfig ~/.config/nvim ~/.config/tmux ~/.config/ghostty ~/.claude/CLAUDE.md
```

Expected: each shows as a symlink (`->`) pointing into `~/Repositories/dotfiles/`.

- [ ] **Step 5: Verify `~/.claude/settings.json` is a real file (not a symlink)**

```bash
ls -la ~/.claude/settings.json
```

Expected: regular file, not a symlink.

- [ ] **Step 6: Open a new shell and verify everything loads**

Open a new Ghostty tab/window. Run:
```bash
echo $SHELL    # should be zsh
mise --version # should work
nvim --version # should work
```

---

## Task 9: Create the gametime branch

**Files:**
- Modify: `git/.gitconfig` (work email on gametime branch)

- [ ] **Step 1: Verify main branch is clean and committed**

```bash
cd ~/Repositories/dotfiles
git status
git log --oneline -5
```

- [ ] **Step 2: Create and switch to gametime branch**

```bash
git checkout -b gametime
```

- [ ] **Step 3: Update git config with work email**

Edit `git/.gitconfig` — change the `[user]` section:
```ini
[user]
  name = jramirez
  email = justin.ramirez@gametime.co
```

- [ ] **Step 4: Commit the work-specific override**

```bash
git add git/.gitconfig
git commit -m "chore(gametime): use work email in git config"
```

- [ ] **Step 5: Re-stow git topic to update the live symlink**

```bash
cd ~/Repositories/dotfiles
stow --dir=. --target=$HOME --restow git
```

- [ ] **Step 6: Verify git uses work email**

```bash
git config user.email
```

Expected: `justin.ramirez@gametime.co`

- [ ] **Step 7: Switch back to main and verify personal email would be used there**

```bash
git checkout main
git config user.email  # would show personal email after stowing on personal machine
git checkout gametime  # back to work branch
```

---

## Task 10: Push to remote and document

**Files:**
- No new files

- [ ] **Step 1: Create a GitHub repo named `dotfiles`**

```bash
gh repo create dotfiles --private --description "Personal dotfiles managed with mise + stow"
```

- [ ] **Step 2: Push both branches**

Replace `<username>` with your GitHub username (e.g. `jramirez` or your personal handle):

```bash
cd ~/Repositories/dotfiles
git remote add origin git@github.com:<username>/dotfiles.git  # substitute your username
git push -u origin main
git push -u origin gametime
```

- [ ] **Step 3: Set gametime as the default branch on this machine**

```bash
git checkout gametime
```

- [ ] **Step 4: Final end-to-end verification**

```bash
cd ~/Repositories/dotfiles
mise tasks        # lists all tasks
mise run link     # re-stows everything (should be no-op, no errors)
mise run inject-secrets  # re-injects Jira token into live settings.json
jq '.env.JIRA_API_TOKEN' ~/.claude/settings.json  # should be non-empty
```

---

## Fresh Machine Bootstrap Reference

For future reference — complete sequence on a brand new Mac:

```bash
# 1. Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
eval "$(/opt/homebrew/bin/brew shellenv)"

# 2. mise (official installer, not brew)
curl https://mise.run | sh
eval "$(~/.local/bin/mise activate zsh)"

# 3. Clone dotfiles
git clone git@github.com:<username>/dotfiles.git ~/Repositories/dotfiles
cd ~/Repositories/dotfiles
git checkout gametime  # work machine; skip for personal

# 4. Install packages (includes 1password-cli)
mise run brew-install

# 5. Authenticate 1Password CLI (requires desktop app installed and signed in)
op account add

# 6. Finish setup
mise run inject-secrets
mise run link

# 7. Open new shell, then create ~/.zshrc.local with machine secrets
```
