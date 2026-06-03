# Hermes SOFIA Spike Profile

This dotfiles topic creates an isolated Hermes profile named `sofia-spike` that mirrors the parts of Pi Justin liked while keeping Pi as fallback.

## What this profile provides

- GPT-5.5 via `openai-codex`.
- Medium reasoning effort (`agent.reasoning_effort: medium`, `delegation.reasoning_effort: medium`).
- Rose Pine theme/skin, matching Pi's `theme: rose-pine`.
- Pi-style global workflow instructions via `SOUL.md` and `AGENTS.md`.
- SOFIA Cloud MCP server configured without committed secrets.
- Context7 MCP configured as a lazy server.
- Hermes local memory disabled/minimized so durable memory flows through SOFIA Cloud.
- Checkpoints enabled for safer coding experiments.

## Runbook

Operational commands and troubleshooting live in:

```text
hermes/RUNBOOK.md
```

Short version: use `sofia` for local CLI sessions (`sofia-local` for the legacy local SOFIA CLI) and `mise run hermes:sofia:gateway:*` for the launchd-backed Telegram gateway.

## Install/link

From the dotfiles repo:

```bash
mise run hermes:sofia:link
mise run hermes:sofia:inject-secrets
mise run hermes:sofia:run
```

Use `sofia` for normal starts. It fetches SOFIA boot context before launching Hermes and injects it into the session system prompt. Direct `hermes --profile sofia-spike` still has a static fallback instruction requiring the agent to call SOFIA `get_boot_context` before substantive work, but the wrapper is the preferred path because it gives Hermes context on turn 1.

The link task uses `stow --no-folding` and pre-creates the target profile directory. That is deliberate: generated `.env` must live in `~/.hermes/profiles/sofia-spike/.env`, not inside the git repo through a folded directory symlink.

## Secret handling

Tracked files contain placeholders only. Runtime secrets are written to:

```text
~/.hermes/profiles/sofia-spike/.env
```

The injection task reads existing environment variables first, then 1Password refs:

- `SOFIA_MCP_ACCESS_KEY` or `SOFIA_MCP_ACCESS_KEY_OP_REF` (default `op://dev_vault/SOFIA MCP/access key`)
- optional provider keys from environment or `*_OP_REF`
- optional Telegram values for chat/mobile tests

Unattended/headless caveat: `op read` may require local approval. If Hermes needs to run away from Justin's computer, prefer one of these:

1. write a local-only `.env` during an attended setup window and rely on file permissions afterward;
2. use Hermes/Bitwarden Secrets Manager (`hermes secrets`) for service-token style non-interactive secrets;
3. use platform OAuth/auth stores where Hermes supports them;
4. avoid unattended jobs that require fresh `op` approval.

"Attended setup" means Justin is physically present or otherwise able to unlock/approve 1Password once. The inject script reads `op://...` refs at that moment and writes the resulting values into `~/.hermes/profiles/sofia-spike/.env` with mode `0600` (`rw-------`). Later Hermes runs read that local file directly and do not need a fresh 1Password approval unless the file is deleted or secrets rotate.

## Commit safety

The repo has three layers of protection for Hermes generated state:

1. `.gitignore` excludes real `.env`, OAuth/auth stores, session DBs, logs, memories, cron jobs, and checkpoints under `hermes/.hermes/profiles/*/`.
2. `mise run hermes:sofia:guard` fails if any of those paths are tracked/staged or if tracked/staged files contain obvious secret material.
3. `mise run hermes:sofia:link` installs a local git pre-commit hook, when no hook already exists, that runs the same guard before commits.

Run this before committing profile changes:

```bash
mise run hermes:sofia:guard
git status --ignored --short hermes/.hermes/profiles/sofia-spike
```

## SOFIA boot context

Normal Hermes starts require SOFIA boot context:

```bash
sofia
```

Equivalent mise task:

```bash
mise run hermes:sofia:run
```

That task runs `scripts/hermes-sofia`, which fetches boot context and exports it through `HERMES_EPHEMERAL_SYSTEM_PROMPT` before `hermes --profile sofia-spike` starts. It fails closed if SOFIA cannot be reached. For an emergency local-only bypass, set `HERMES_SOFIA_BOOT_REQUIRED=0`, but do not use that for normal work.

Fetch boot context directly:

```bash
~/.hermes/profiles/sofia-spike/scripts/sofia-boot-context personal
```

Or in Hermes, use the SOFIA MCP tools once the profile is active.

## SOFIA gateway / Telegram

Telegram gateway sessions need the same SOFIA boot context as local CLI sessions. Use the dedicated gateway wrapper rather than plain `hermes --profile sofia-spike gateway install`:

```bash
mise run hermes:sofia:link
mise run hermes:sofia:inject-secrets
mise run hermes:sofia:gateway:doctor
mise run hermes:sofia:gateway:plist      # write plist only; does not start
mise run hermes:sofia:gateway:install    # install + start launchd service
```

The generated launchd service is `ai.hermes.gateway-sofia-spike` and runs:

```text
/Users/justinramirez/.hermes/profiles/sofia-spike/scripts/hermes-sofia gateway run --replace
```

That means Telegram/gateway sessions inherit `HERMES_EPHEMERAL_SYSTEM_PROMPT` from the SOFIA boot-context fetch before the gateway process starts. The plist lives at:

```text
~/Library/LaunchAgents/ai.hermes.gateway-sofia-spike.plist
```

Useful follow-ups:

```bash
mise run hermes:sofia:gateway:status
mise run hermes:sofia:gateway:restart
mise run hermes:sofia:gateway:stop
```

`hermes:sofia:inject-secrets` will copy already-materialized Telegram values from local-only `~/.hermes/.env` into local-only `~/.hermes/profiles/sofia-spike/.env` when explicit env vars or `*_OP_REF` values are not supplied. This avoids symlinking the default Hermes `.env` while still allowing the spike profile to receive Telegram messages.

Do not run the default Hermes gateway and `ai.hermes.gateway-sofia-spike` against the same Telegram bot token at the same time. Stop the default gateway first, then install/start the SOFIA gateway for the live Telegram ergonomics test.

## MCP verification checklist

After linking/injecting secrets:

```bash
hermes --profile sofia-spike mcp list
hermes --profile sofia-spike mcp test sofia-cloud
hermes --profile sofia-spike mcp test context7
```

Then start a session and verify:

- search SOFIA memory for a harmless known term;
- list recent items;
- fetch `boot_context.md` via `get_artifact` or the boot-context script;
- capture a disposable spike event only if you are comfortable creating a review candidate;
- review candidates and archive/delete the disposable test if needed.

## Pi parity notes

Pi setting | Hermes spike equivalent
--- | ---
`defaultProvider: openai-codex` | `model.provider: openai-codex`
`defaultModel: gpt-5.5` | `model.default: gpt-5.5`
`defaultThinkingLevel: medium` | `agent.reasoning_effort: medium`
`theme: rose-pine` | `display.skin: rose-pine` + `skins/rose-pine.yaml`
`pi-mcp-adapter` | Hermes native `mcp_servers`
`pi-powerline-footer` | `display.runtime_footer.enabled: true`
SOFIA skills/hooks | SOFIA MCP tools + profile scripts
local Pi memory behavior | Hermes memory disabled; SOFIA Cloud canonical
