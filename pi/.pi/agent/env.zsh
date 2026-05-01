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

# SOFIA cloud MCP. Keep 1Password as the source of truth; this only exports
# a runtime env var for MCP clients that support header interpolation.
if [[ -z "${SOFIA_MCP_ACCESS_KEY:-}" ]] && command -v op >/dev/null 2>&1; then
  export SOFIA_MCP_ACCESS_KEY="$(op read 'op://dev_vault/SOFIA MCP/access key' 2>/dev/null || true)"
fi
