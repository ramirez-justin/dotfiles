# Pi Claude Code Provider Design

## Goal

Replace the custom Claude Code planning bridge with the maintained
`pi-claude-code-provider` package. Keep Claude available through Pi's native
provider and subagent interfaces while preserving the current default model.

Pi package updates must continue to flow through the existing Mise tasks.

## Configuration

Update `pi/.pi/agent/settings.json` as follows:

- Change the Superpowers source from the pinned
  `git:https://github.com/obra/superpowers.git@v5.0.7` reference to the
  unpinned `git:https://github.com/obra/superpowers.git` source.
- Add the unpinned `npm:pi-claude-code-provider` package.
- Keep `openai-codex/gpt-5.6-sol` as the default provider and model.
- Add no provider-specific environment overrides.

The existing `mise run pi-update` task runs `pi update --extensions`, which
will update both unpinned packages. The broader `mise run update` task invokes
`pi-update` and therefore retains the same behavior.

## Planner Removal

Delete the tracked custom planner files under
`pi/.pi/agent/extensions/claude-code-planner/`:

- `index.ts`
- `index.test.ts`
- `pty-runner.py`
- `stop-hook.mjs`

No repository files outside that directory reference the planner's tool,
command, or implementation. Native Claude-backed Pi subagents replace its
planning use case without a custom pseudo-terminal or transcript parser.

## Runtime Behavior

Pi will discover the provider extension from the npm package and expose its
Claude model aliases. Selecting Claude remains explicit; installing the
provider does not change the default Pi model.

Provider and Superpowers updates remain automatic through the existing Mise
update tasks. This accepts upstream package updates in exchange for consistent
operator behavior across all unpinned Pi packages.

## Verification

Implementation is successful when:

1. `pi/.pi/agent/settings.json` parses as valid JSON.
2. `mise run pi-update` installs and reconciles the configured packages.
3. Pi starts offline and lists the Claude provider aliases.
4. No repository references to `claude-code-planner`, `claude_code_plan`, or
   `/claude-plan` remain.
5. Relevant repository checks pass, or unrelated pre-existing failures are
   identified explicitly.

A paid Claude request is not required for configuration verification. The
provider's interactive doctor command can validate subscription readiness when
Pi is next used interactively.

## Rollback

Reverting the implementation commit restores the custom planner and previous
package sources. Running `mise run pi-update` afterward reconciles the local Pi
package installation with the restored settings.
