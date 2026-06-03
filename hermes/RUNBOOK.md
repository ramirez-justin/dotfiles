# Hermes SOFIA Runbook

This runbook is for the `sofia-spike` Hermes profile. Use these commands when you want Hermes sessions, Telegram gateway sessions, and SOFIA Cloud memory to stay wired together.

## Golden rule

Use the SOFIA wrappers, not plain `hermes --profile sofia-spike`, for normal work.

The wrappers fetch SOFIA boot context before Hermes starts and inject it into `HERMES_EPHEMERAL_SYSTEM_PROMPT`, so Hermes has SOFIA memory context on turn 1.

## Daily CLI use

After dotfiles are linked, start SOFIA-backed Hermes with:

```bash
sofia
```

The tracked `~/.local/bin/sofia` wrapper executes:

```bash
~/.hermes/profiles/sofia-spike/scripts/hermes-sofia
```

The legacy local SOFIA second-brain CLI is still available as:

```bash
sofia-local
```

Equivalent mise command:

```bash
cd ~/dev/dotfiles
mise run hermes:sofia:run
```

Pass normal Hermes arguments after the alias when needed:

```bash
sofia chat -q "check my Hermes status"
sofia --continue
sofia --skills sofia-cloud-memory
```

Avoid this for normal work:

```bash
hermes --profile sofia-spike
```

Direct profile launches have a static fallback instruction to fetch SOFIA context, but they do not get boot context before the first model call.

## First-time setup / relink

From the dotfiles repo:

```bash
cd ~/dev/dotfiles
mise run hermes:sofia:link
mise run hermes:sofia:inject-secrets
mise run hermes:sofia:doctor
```

What these do:

- `link` installs the tracked profile files into `~/.hermes/profiles/sofia-spike` without folding the whole profile directory into a symlink.
- `inject-secrets` writes local-only secrets to `~/.hermes/profiles/sofia-spike/.env` with restrictive permissions.
- `doctor` validates the profile config and SOFIA MCP wiring.

## Gateway / Telegram setup

Telegram gateway sessions must also use the SOFIA wrapper so gateway-created Hermes sessions receive boot context.

Initial install/start:

```bash
cd ~/dev/dotfiles
mise run hermes:sofia:link
mise run hermes:sofia:inject-secrets
mise run hermes:sofia:gateway:doctor
mise run hermes:sofia:gateway:install
```

The launchd service is:

```text
ai.hermes.gateway-sofia-spike
```

The generated plist is:

```text
~/Library/LaunchAgents/ai.hermes.gateway-sofia-spike.plist
```

It runs:

```text
~/.hermes/profiles/sofia-spike/scripts/hermes-sofia gateway run --replace
```

Do not run the default Hermes gateway and the SOFIA gateway against the same Telegram bot token at the same time.

## Gateway operations

Status:

```bash
mise run hermes:sofia:gateway:status
```

Restart after config, secret, or profile changes:

```bash
mise run hermes:sofia:gateway:restart
```

Stop:

```bash
mise run hermes:sofia:gateway:stop
```

Write/update plist without starting:

```bash
mise run hermes:sofia:gateway:plist
```

Tail logs:

```bash
~/.hermes/profiles/sofia-spike/scripts/hermes-sofia-gateway logs
```

## Health checks

Profile guard before committing profile changes:

```bash
cd ~/dev/dotfiles
mise run hermes:sofia:guard
```

MCP checks:

```bash
hermes --profile sofia-spike mcp list
hermes --profile sofia-spike mcp test sofia-cloud
hermes --profile sofia-spike mcp test context7
```

Boot context check:

```bash
~/.hermes/profiles/sofia-spike/scripts/sofia-boot-context personal
```

Hermes status for the SOFIA profile:

```bash
HERMES_HOME="$HOME/.hermes/profiles/sofia-spike" hermes --profile sofia-spike status --all
```

## Troubleshooting

### `sofia` command not found

Reload zsh config or open a new shell:

```bash
source ~/.zshrc
```

The alias is tracked in:

```text
zsh/.config/zsh/aliases.zsh
```

and loaded by `~/.zshrc` from:

```text
~/.config/zsh/aliases.zsh
```

### Gateway says loaded but not running

Run:

```bash
mise run hermes:sofia:gateway:status
```

A healthy status includes:

```text
Launchd: loaded
state = running
pid = ...
last exit code = (never exited)
```

If it is loaded but not running, restart it:

```bash
mise run hermes:sofia:gateway:restart
```

### Bootstrap failed: 5: Input/output error

This can happen if launchd has not fully unloaded the previous service yet. The gateway script now waits and retries during install. If you still hit it, run:

```bash
mise run hermes:sofia:gateway:stop
mise run hermes:sofia:gateway:install
```

### SOFIA boot context failed or empty

Normal startup fails closed. Check SOFIA directly:

```bash
mise run hermes:sofia:boot-context
mise run hermes:sofia:doctor
```

Only for emergency local-only work, bypass the fail-closed behavior:

```bash
HERMES_SOFIA_BOOT_REQUIRED=0 sofia
```

Do not use that for normal work.

### Secrets changed or Telegram stopped receiving messages

Refresh local-only profile secrets and restart the gateway:

```bash
cd ~/dev/dotfiles
mise run hermes:sofia:inject-secrets
mise run hermes:sofia:gateway:restart
```

## Commit checklist

Before committing SOFIA profile changes:

```bash
cd ~/dev/dotfiles
git diff --check
mise run hermes:sofia:guard
```

Then commit normally.
