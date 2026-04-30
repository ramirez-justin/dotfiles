# Environment shared with pi sessions.
# Put personal, machine-local secrets/overrides in ~/.pi/agent/env.local.zsh.
# Example:
#   export NOTION_API_KEY='...'

# Keep both spellings for tools/plugins that check either variable.
export ENABLE_LSP_TOOL="1"
export ENABLE_LSP_TOOLS="1"

# SOFIA second-brain defaults. Put machine-local overrides and secrets in
# ~/.pi/agent/env.local.zsh (for example OBSIDIAN_API_KEY via `op read`).
export SOFIA_VAULT="${SOFIA_VAULT:-$HOME/dev/SOFIA}"
export OBSIDIAN_API_URL="${OBSIDIAN_API_URL:-https://127.0.0.1:27124}"
export OBSIDIAN_API_CERT="${OBSIDIAN_API_CERT:-$HOME/.config/sofia/cert.pem}"

[[ -f "$HOME/.pi/agent/env.local.zsh" ]] && source "$HOME/.pi/agent/env.local.zsh"
