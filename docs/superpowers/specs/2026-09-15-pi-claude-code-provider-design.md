# Pi Claude Code Provider Design

## Goal

Replace the custom Claude Code planning bridge with the maintained
`pi-claude-code-provider` package. Use Claude selectively through Pi's native
provider and subagent interfaces while preserving the current default model.

Pilot Claude Sonnet for read-only research while retaining the established GPT
models for other agent roles. Enforce the mixed routing matrix through the
existing Mise checks. Pi package updates must continue to flow through the
existing Mise tasks.

## Configuration

Update `pi/.pi/agent/settings.json` as follows:

- Change the Superpowers source from the pinned
  `git:https://github.com/obra/superpowers.git@v5.0.7` reference to the
  unpinned `git:https://github.com/obra/superpowers.git` source.
- Add the unpinned `npm:pi-claude-code-provider` package.
- Keep `openai-codex/gpt-5.6-sol` as the default provider and model.
- Change the Researcher agent to
  `pi-claude-code-provider/sonnet` at `high` thinking.
- Keep every other custom agent on its existing GPT model and thinking level.
- Update user instructions and workflow memory to describe the mixed routing.
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

## Mixed Model Routing

The initial routing matrix is:

| Agent | Model | Thinking |
| --- | --- | --- |
| Explore | `openai-codex/gpt-5.6-luna` | `max` |
| Verifier | `openai-codex/gpt-5.6-luna` | `max` |
| Plan | `openai-codex/gpt-5.6-terra` | `max` |
| Oracle | `openai-codex/gpt-5.6-terra` | `max` |
| Reviewer | `openai-codex/gpt-5.6-terra` | `max` |
| Researcher | `pi-claude-code-provider/sonnet` | `high` |
| Worker | `openai-codex/gpt-5.6-sol` | `medium` |
| AstraPlan | `openai-codex/gpt-6-astra` | `max` |
| Implementer | `openai-codex/gpt-6-astra` | `low` |

Sonnet is a reversible pilot for a read-only role. No repository-specific
benchmark currently proves that a Claude model is superior for the other
roles. Opus may be evaluated later for Reviewer or Oracle. Haiku and Fable
remain explicit-only choices until their effort behavior, availability, and
usage implications are validated.

`mise run check-agent-tiers` will enforce the exact model and thinking level for
every custom agent. It will also require the unpinned provider package, reject
noncanonical Claude model identifiers, preserve the OpenAI default, and verify
that every configured model appears in Pi's offline model catalog.

Explicit per-call model overrides remain available for experiments. They do not
change the enforced defaults and should state why the default route is being
bypassed.

## Verification

Implementation is successful when:

1. `pi/.pi/agent/settings.json` parses as valid JSON.
2. `mise run pi-update` installs and reconciles the configured packages.
3. `mise run check-agent-tiers` validates the complete routing matrix.
4. Pi starts offline and lists every configured GPT and Claude model.
5. User instructions and workflow memory match the enforced matrix.
6. No repository references to `claude-code-planner`, `claude_code_plan`, or
   `/claude-plan` remain.
7. Relevant repository checks pass, or unrelated pre-existing failures are
   identified explicitly.

Normal checks must not make paid Claude requests. The provider's interactive
doctor can validate runtime and bridge readiness without consuming model quota.
An optional live smoke test must require explicit invocation and should verify
the served model from Pi's `responseModel` metadata rather than generated
self-identification.

The Sonnet route is an evidence-gathering pilot, not a claim of established
cross-provider superiority. A future opt-in comparison should use sanitized,
read-only historical research tasks and score grounding, source quality,
completeness, latency, and the served model before promoting Claude to more
roles.

## Rollback

Reverting the implementation commit restores the custom planner and previous
package sources. Running `mise run pi-update` afterward reconciles the local Pi
package installation with the restored settings.
