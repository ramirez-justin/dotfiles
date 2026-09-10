# Omni Analytics Project Memory

## Rules

- Prefer the official Omni CLI with browser OAuth over handling a personal
  access token directly.
- Never store Omni tokens or OAuth credentials in the repository or durable
  memory.

## Facts

- The repository stores Omni semantic-model and topic YAML under
  `omni/snowflake/`.
- Pull requests that change Omni YAML use the repository workflow to push the
  files to a per-PR Omni branch and run server-side validation.
- The Omni CLI is managed in the dotfiles `Brewfile` through
  `exploreomni/tap/omni`; its tap is trusted by the opt-in mise task
  `trust-third-party-brew-taps`.
- The local OAuth profile is named `gametime`. Use
  `omni --profile gametime <command>` for API-backed CLI operations.
- If the profile is absent, initialize it with `omni config init --name
  gametime --endpoint <org-endpoint> --auth oauth`, using the organization
  endpoint already declared in this repository's validation workflow.
