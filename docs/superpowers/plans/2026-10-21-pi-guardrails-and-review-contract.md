# Pi guardrails and review contract

Status: Deliverables 0 and 0A approved and implemented locally; the user
explicitly waived the twice-failed plan-only Ponytail checkpoint for that
scope only. Both 0A plan pilots completed normally. Final acceptance is
tracked outside this active roadmap against the exact frozen diff and check
results. Deliverables 1-3 are roadmap-sized and not approved for
implementation; plan each in detail before execution.

## Goal and approved scope

Borrow oh-my-pi's just-in-time guardrails and explicit review results without
switching harnesses. Execute with local `executing-plans`, not upstream
orchestration. This document plans Phase 1; subsequent recommendations are a
sequenced roadmap, not permission to implement uninvestigated APIs.

Approved in chat: start with tool-call rules, reviewer reporting, and safe
memory pruning; pursue all remaining recommendations afterward. Justin chose
checker expectations of tier 3 for simplifier/verifier and approved removing
the stray `- that.` memory bullet. Preserve the existing reviewer tier-2
changes. Obtain plan approval before implementation.

## Architecture, stack, and constraints

- Stay on `gametime` in the current checkout; one implementation writer.
- Node-compatible TypeScript extension using Pi 1.3.0 `tool_call` hooks.
- Rules are a dotfiles-owned TypeScript table, not project-supplied policy.
- Bun tests for extension behavior; standard-library Python config checks.
- No package installation, provider traffic, work-system mutations, merge,
  destructive smoke commands, or global configuration changes for testing.
- This is a best-effort guardrail, not a sandbox or complete shell parser.
  Keep semantic approval instructions and secret-handling policy in context.
- Do not claim that a Markdown reporting contract enforces a runtime schema.
- Existing package discovery loads `extensions/<name>/index.ts` automatically.
  Import the rule table directly so Stow symlinks and launch cwd do not
  require separate policy-file resolution.

### Observed baseline

`mise run check` exits 1 at the tier checker. Independent Python execution
runs 33 tests with four failures, all caused by the two tier expectations.
Bun runs 147 tests: 146 pass, one fails importing `typebox` through the
installed subagents runner. Do not mask these failures with pipelines or skips.

Existing uncommitted changes before this plan:

- `agents/reviewer.md`: model/display name changed to tier 2; preserve.
- `bin/check-agent-tiers.py`: reviewer expectation tier 2; preserve.
- `memory/USER.md`: accidental final bullet; removal approved.

All paths below are relative to `pi/.pi/agent/` unless stated otherwise.

## Observable success criteria

1. Approved tier expectations agree; all existing suites pass, or an explicit
   dependency blocker stops execution before any completion claim.
2. Five fixed guardrails register without adding their bodies to the prompt.
3. Matching prohibited calls are blocked with a useful alternative. Matching
   approval-required calls need consent for that exact call; headless calls
   fail closed, with no session-wide allow switch.
4. Benign commands remain usable. Tests cover direct commands, common shell
   wrappers, multiple commands, scopes, confirmation, and malformed input.
5. Reviewer results distinguish completed/incomplete, severity/confidence,
   verified findings/unverified concerns, evidence, checks, and coverage gaps.
6. Memory sections remain valid; USER and WORKFLOWS fit 4,000 characters each.
   Broad safety instructions and dbt Cloud behavior remain available.
7. Simplicity review has a bounded, artifact-first remit and an explicit
   finish condition; its actual prompt/limit behavior is covered by tests.
   Representative pilot reviews finish without a turn-limit steer, or remain
   explicitly blocked. An incomplete review never becomes a pass.

## Deliverable 0: restore a trustworthy baseline

Modify `bin/check-agent-tiers.py`, `tests/test_check_agent_tiers.py`, and
`tests/model-tiers.test.ts`.

- [x] Run the current focused Python checker suite and save its failing exit.
- [x] Change only these expected model entries, keeping reasoning unchanged:

```python
"simplifier.md": ("tiers/tier-3", "max"),
"verifier.md": ("tiers/tier-3", "max"),
```

- [x] Add regression cases rejecting drift of each agent back to tier 4;
  retain current valid-configuration and unrelated-validation tests.
- [x] Extend the existing Bun SDK-resolution mapping with Pi's real TypeBox
  modules. Installed subagents 0.22.0 declares TypeBox as a peer; Pi's loader
  supplies these aliases, but the test currently omits them. Use:

```typescript
"typebox": realpathSync(Bun.resolveSync("typebox", PI_ENTRY)),
```

  Keep real validation and agent execution. Do not stub validation, skip the
  integration test, patch installed packages, or install a second SDK. Stop
  on any remaining baseline failure rather than expanding dependency scope.
- [x] From repository root, run:

```sh
python3 -m unittest discover -s pi/.pi/agent/tests \
  -p test_check_agent_tiers.py -v
mise exec -- bun test ./pi/.pi/agent/tests/model-tiers.test.ts
mise run check
```

Expected: zero exit codes; tier drift rejected, all agents still dispatched
through the installed runner, and existing isolation assertions retained.

## Deliverable 0A: make simplicity reviews finish reliably

Prioritize this immediately after the baseline repair and before guardrails.
The fix targets review scope and context, not larger budgets or relaxed gates.
Implemented after approval with the plan checkpoint waived for 0/0A only.
Verified pilot results are recorded in the verification section below.

### Diagnosis: observed behavior versus hypotheses

Assessed the two local runs for the same 21,839-byte frozen plan. This is
verified for these runs, not a claim about every historical review.

| Run | Model turns before limit | Tool calls | Duration |
| --- | --- | --- | --- |
| First review | 24 | 51 | 428 seconds |
| Retry, caller requested 8 turns | 24 | 45 | 335 seconds |

Both read the complete artifact in their first tool batch. They then made
49 and 43 further tool calls across repository files, dependency discovery,
Pi runtime, UI internals, context-mode, and the subagents package. The limit
was consumed by supporting investigation, not recovering a truncated artifact.

Installed subagents 0.22.0 confirms these configuration semantics:

- `invocation-config.ts:139` resolves
  `agentConfig?.maxTurns ?? params.max_turns`. The agent file's 24 overrides
  caller values of 8 or 48. A real offline resolver probe returned 24 for
  both, and 8 only when the agent's configured limit was absent.
- `agent-runner.ts:1146-1164` counts model turns, not tool calls, sends the
  wrap-up steer at the effective limit, then aborts after grace turns.
  Thus 45 or 51 tools do not mean a 24-turn ceiling was ignored.
- `prompts.ts:101-131` includes the full parent system prompt in append mode.
  `isolated: true` does not remove that inherited prompt. An offline marker
  probe confirmed append includes it and replace excludes it.
- `agents/simplifier.md` currently combines append mode, maximum thinking,
  a hard-pinned 24-turn limit, broad "trace the relevant real flow" wording,
  and no investigation budget or report-reservation rule.
- The generated capture prompt requires full-artifact reading but supplies
  no stopping condition for supporting research. A fresh retry repeats the
  same broad contract and rediscovers much of the same evidence.

Root mechanism: the simplicity role becomes a second implementation/runtime
investigation, then reports only when the runner forces it to stop. Parent
workflow inheritance reinforces the broad remit. The ignored caller limit is
an independently reproduced configuration trap, not a reason to retry with a
different number. Maximum thinking may add latency, but no controlled trial
establishes it as the cause; do not change model/effort in the first repair.
The long plan also broadens the search surface; keep later execution plans
focused on the active milestone, with short roadmap descriptions.

### Concrete changes

Modify these existing paths; do not add a dispatcher, watchdog, or new agent:

- `agents/simplifier.md`
- `skills/ponytail-review/SKILL.md`
- `skills/ponytail-review/scripts/capture.py`, specifically `prompt_for`
- `skills/writing-plans/SKILL.md`
- `tests/model-tiers.test.ts`
- `tests/test_ponytail_capture.py`
- `bin/check-agent-tiers.py` and `tests/test_check_agent_tiers.py`

- [x] Write failing semantic tests for the new role/prompt contract first.
  Keep all existing capture, freshness, tamper, full-read, and identity tests.
- [x] Make the simplifier standalone with `prompt_mode: replace` and
  `skills: false`. Preserve read-only tools, isolation, tier 3, max thinking,
  and `max_turns: 24` initially. Explicitly include confidentiality, untrusted
  artifact handling, no writes, no external mutations, and the existing
  identity/report contract in its own instructions; do not rely on inherited
  parent policy for these safeguards.
- [x] Give the role this bounded process, for plans and diffs alike:

```text
Read the complete supplied artifact first; never sample or truncate it.
Assess requirements and unnecessary machinery from that artifact.
Use supporting reads/searches only to test a specific candidate reduction.
Do not inventory the repository, resolve every plan API, or audit runtime,
UI, dependency, correctness, and test contracts as a second implementation.
Normally use at most 8 supporting tool calls after the full artifact read.
Reserve the final 4 of the configured 24 model turns for synthesis/reporting.
These are planning targets, not permission to omit required artifact bytes.
If a simpler replacement cannot be verified within that scope, report the
specific evidence gap; do not promote it to a blocking finding.
Once the artifact is fully assessed and candidate reductions are resolved,
report immediately. Do not seek extra findings or audit optional follow-ups.
```

- [x] Update `prompt_for` to carry that scope and finish condition in the
  canonical generated prompt, not a parent-added suffix. Keep source bytes,
  artifact identity, required report fields, and explicit requirements intact.
  Adjust the capture skill so supporting evidence means a hypothesis-directed
  check, not a requirement to reproduce all implementation verification.
- [x] Add a parent planning check in `writing-plans`: the active milestone
  gets detailed executable steps; later milestones stay roadmap-sized. Resolve
  important API uncertainties before review, so simplicity review need not
  discover an architecture. Preserve source-backed blockers and cross-step
  simplifications; do not cap the count of legitimate findings.
- [x] Keep effective-limit policy explicit: the configured 24 is authoritative
  in this package version. Do not attempt a caller-only limit override or
  assume `isolated` strips inherited instructions. No global default changes,
  package patch, or automatic budget increases are needed for this repair.
- [x] Retain strict acceptance: a steered/aborted lifecycle is incomplete even
  when its text says `state: completed`. Unread artifact bytes or unresolved
  essential approval evidence still block. Optional implementation research
  left to execution is not by itself an incomplete simplicity review.
- [x] Bound recovery without hiding incompleteness. Before any permitted
  retry, diagnose failure category and verify the same capture. A retry must
  not pretend a caller parameter overrides a pinned config. Preserve the
  current one-retry/second-failure gate; changing that policy needs separate
  explicit approval. Do not automatically rerun the blocked current plan.

### Verification and success criteria

Extend existing real installed-package tests rather than introducing a new
review-runner wrapper. Use host-resolved TypeBox from Deliverable 0.

```typescript
// Installed package precedence is pinned so caller assumptions cannot drift.
expect(resolveAgentInvocationConfig(
  { ...config, maxTurns: 24 }, { max_turns: 8 },
).maxTurns).toBe(24);
expect(resolveAgentInvocationConfig(
  { ...config, maxTurns: undefined }, { max_turns: 8 },
).maxTurns).toBe(8);

// Use buildAgentPrompt with the actual loaded simplifier configuration.
expect(simplifier.promptMode).toBe("replace");
expect(childPrompt).not.toContain("PARENT_WORKFLOW_SENTINEL");
expect(childPrompt).toContain(simplifier.systemPrompt);
```

- [x] Assert configured 24 also outranks caller 48. Assert replace-mode output
  retains the complete simplifier contract and strips the synthetic parent's
  workflow marker; do not merely assert a frontmatter string changed.
- [x] Extend checker invariants for standalone prompt mode and disabled skill
  inheritance, keeping its read-only and isolation invariants intact.
- [x] Extend capture CLI tests: generated prompts carry the artifact-first,
  bounded-support, finish/report instructions and all required identity
  sections; capture/verify still detects prompt tampering and stale plans.
  Use behavioral/structural assertions, not exact prose snapshots.
- [x] Confirm failure semantics in an offline faux-provider run that keeps
  requesting harmless reads until the pinned soft limit. Verify the installed
  runner returns `steered: true`, not a clean result merely because a final
  report says completed. No live provider or dangerous commands required.
- [x] Run from repository root:

```sh
python3 -m unittest discover -s pi/.pi/agent/tests \
  -p test_ponytail_capture.py -v
python3 -m unittest discover -s pi/.pi/agent/tests \
  -p test_check_agent_tiers.py -v
mise exec -- bun test ./pi/.pi/agent/tests/model-tiers.test.ts
mise run check
```

- [x] Run the approved repair's small-plan and representative-plan pilots.
  Record real lifecycle state, effective limit, turns, tool calls, coverage
  gaps, and duration. Compare with the two baseline traces, not just report
  wording. Both must complete without a turn-limit steer, preserve full
  artifact reading and justified findings, and avoid unrelated runtime
  investigation. A forced-stop pilot remains a blocker, not a waived pass.

Verified live pilot results: small plan completed lean in 5 model turns,
7 tool calls, 196.6 seconds; representative plan completed lean in 4 model
turns, 9 tool calls, 276.5 seconds. Both used the pinned 24-turn configuration,
read the full frozen artifact, passed before/after receipt verification, and
had no forced wrap-up steer. Neither produced a blocking finding. A suggested
optional pilot consolidation was not adopted: both artifact sizes were part
of this repair's approved validation. These are completion-reliability
results, not proof that latency is solved.

The observed timings are baselines, not an invented universal latency SLA.
If bounded remit alone is insufficient, inspect the pilot traces before a
separate model/effort experiment. Never respond with a blanket larger limit.

## Deliverable 1 (roadmap): small, explicit tool-call guardrails

Not approved for implementation. Goal: a dotfiles-owned TypeScript rule
table enforced through Pi 1.3.0 `tool_call` hooks in
`extensions/tool-rules/`, documented in root `README.md`. Best-effort
guardrail, not a sandbox or shell parser; keep semantic approval and
secret-handling instructions in context.

Seed rules: block Snowflake Terraform/Terragrunt plan/apply under
`snowflake-objects`; block `uv dbt`/`uv run dbt`; confirm `git merge`,
`gh pr merge`, force pushes, and recursive force deletes. Block wins over
confirm; consent applies to one exact call; headless calls fail closed; no
session-wide allow switch; never log command text or secrets.

Before detailed planning, verify producer tool names and cwd behavior for
Bash and context-mode shell inputs. Verification scope: pure matching tests
with real producer shapes, wrappers, chains, benign commands, documented
gaps, concurrent dialogs, and an offline faux-provider session proving a
blocked call never runs. No dangerous commands in tests.

## Deliverable 2 (roadmap): concise, explicit reviewer reporting

Not approved for implementation. Goal: a fixed reviewer report contract in
`agents/reviewer.md` and a shorter `prompts/code-review.md`, preserving the
reviewer tier-2 model. Distinguish completed/incomplete, severity and
confidence, verified findings versus unverified pre-merge concerns,
evidence, checks, coverage, and gaps. Instruction-level contract only; the
parent validates lifecycle and identity and never infers success from a
report's own state field. Verification scope: parseable examples, semantic
checks, and a labeled manual live smoke check.

## Deliverable 3 (roadmap): prune memory without weakening policy

Not approved for implementation. Remove only the approved stray `- that.`
bullet from `memory/USER.md`. Move the detailed Cortex key-pair fallback
from WORKFLOWS.md into the `snowflake` skill with a Cortex skill pointer,
preserving environment names, interactive zsh, in-memory credentials, and
authority checks. Keep safety, Snowflake Terraform, and dbt preferences.
Verification scope: character budgets (<=4,000 each), headings, diff
inspection, `mise run check-memory`, and `mise run check`.

## Final verification and handoff

- [ ] Use `verification-before-completion`; capture real exit codes and full
  output before summarizing. Never use a successful `tail` as test status.
- [ ] Inspect the actual diff, preserve unrelated edits, run relevant LSP
  diagnostics on changed TypeScript, and record unavailable analyzer coverage.
- [ ] Run independent correctness and frozen Ponytail diff reviews under
  `executing-plans`; fix verified findings through the sole writer.
- [ ] Run `mise run check` and `git diff --check` after final content changes.
- [ ] Remove this task-specific plan before finalizing implementation; removal
  must be included in final diff capture/verification. Keep stable README
  documentation, tests, and operational policy only.
- [ ] User authorized local commits at completion. Group baseline/tier fixes,
  review-reliability repair, guardrails, reviewer reporting, and memory
  cleanup into coherent commits
  after verification; include `Co-Authored-By: Pi <noreply@pi.dev>`. Preserve
  prior reviewer tier-2 edits in the tier-fix commit. Do not push or merge.
- [ ] Summarize test evidence, coverage gaps, rollback (remove extension/rules
  and reload), and the next roadmap milestone. No claim of full TTSR parity,
  secret filtering, cross-tool enforcement, or schema-enforced agents.

## Remaining recommendations: ordered roadmap

These remain in scope as follow-up milestones, not abandoned suggestions.
Plan each against verified runtime evidence once Phase 1 is accepted.

### 2. Reduce always-on prompt cost

Audit AGENTS, injected USER/WORKFLOWS/current-project memory, skill summaries,
and package instructions. Record initial/final character and estimated token
counts. Move repeatable procedures into existing skills, merge duplicate
policy, and preserve discovery pointers. Do not reduce mandatory safety or
review gates merely to hit a token target. Success: measurable reduction,
valid memory budgets, and no missing essential instruction path.

### 3. Audit and trial the tool surface

Inventory declared versus discoverable tools and schema sizes using Pi's
actual active registry plus installed package behavior. Treat MCP adapter,
pi-lens activation, and context-mode as distinct owners; changing built-in
settings alone may not affect them. Keep core editing/navigation and loaders
available. Trial one reversible opt-in loadout, verify lookup and activation,
compare declaration size, and exercise common research/code-review flows.
Do not uninstall packages or blindly set an active tool allowlist on startup.

### 4. Opt-in advisor after a run

Use the existing verifier/reviewer and model-tier routing where practical.
Default off; no background provider usage without explicit activation.
First determine whether an existing one-shot review command satisfies the
need. If not, design a single bounded end-of-run review that accounts for
usage, cancellation, failure, shutdown, and context/data disclosure. Notes are
advisory, not approval or an infinite continuation loop. No per-turn review
or persistent WATCHDOG framework in the first trial. Success: no idle cost,
one review per requested boundary, visible failure, and independent evidence.

### 5. Turn-local `ultrathink`

Inspect available input/thinking-level APIs and supported model levels before
implementation. Match standalone lowercase prose only, not code, paths, or
identifiers. Raise effort for the requested run, restore the prior level on
completion/cancellation/error, and never override a user's subsequent explicit
change. Unsupported model levels must clamp or fail visibly per host behavior.
Use existing controls rather than a second model router. Test consecutive
turns, retries, abort, reload, and user changes before enabling by default.
