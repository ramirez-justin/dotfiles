#!/usr/bin/env bash
set -euo pipefail

repo_root="${DOTFILES_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../../" && pwd)}"
profile_dir="$HOME/.hermes/profiles/sofia-spike"

mkdir -p "$profile_dir" "$profile_dir/skins" "$profile_dir/scripts"

# --no-folding is important: it prevents Stow from symlinking the whole
# profile directory, which would make a generated .env land inside the repo.
stow --dir="$repo_root" --target="$HOME" --restow --no-folding hermes

# Install a local pre-commit guard for this repo when possible. Git hooks are
# intentionally not tracked, so the hook delegates to the tracked script.
hook_path="$repo_root/.git/hooks/pre-commit"
guard_script="$repo_root/hermes/.hermes/profiles/sofia-spike/scripts/check-sensitive-state.sh"
if [ -d "$repo_root/.git/hooks" ]; then
  if [ ! -e "$hook_path" ]; then
    cat > "$hook_path" <<EOF
#!/usr/bin/env bash
set -euo pipefail
bash "$guard_script"
EOF
    chmod 700 "$hook_path"
    echo "Installed local git pre-commit guard at $hook_path"
  elif ! grep -q "check-sensitive-state.sh" "$hook_path"; then
    echo "Existing pre-commit hook left unchanged: $hook_path"
    echo "Consider adding: bash $guard_script"
  fi
fi

echo "Linked Hermes SOFIA spike profile into $profile_dir"
echo "Next: mise run hermes:sofia:inject-secrets"
echo "Run:  hermes --profile sofia-spike"
