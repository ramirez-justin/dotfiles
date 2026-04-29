# Environment shared with pi sessions.
# Secrets are written to ~/.pi/agent/env.local.zsh by `mise run inject-secrets`.

export JIRA_HOST="gametime.atlassian.net"
export JIRA_EMAIL="justin.ramirez@gametime.co"

# Linear/Notion skills read these from env.local.zsh when configured.
# Linear is injected from 1Password item: Employee/linear_api_key/API key.
# To inject Notion via 1Password later, set NOTION_API_KEY_OP_REF
# in your shell before running `mise run inject-secrets`.

# Keep both spellings for tools/plugins that check either variable.
export ENABLE_LSP_TOOL="1"
export ENABLE_LSP_TOOLS="1"

[[ -f "$HOME/.pi/agent/env.local.zsh" ]] && source "$HOME/.pi/agent/env.local.zsh"
