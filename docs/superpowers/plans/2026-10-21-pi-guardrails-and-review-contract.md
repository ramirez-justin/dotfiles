# Pi guardrails and review contract

Draft: not approved for execution. Both simplicity-review attempts exhausted
their turn limits. The following revision incorporates verified reductions
from their feedback; an explicit waiver of the plan checkpoint is required
before approval/execution. Implementation review gates remain unchanged.

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

## Deliverable 0: restore a trustworthy baseline

Modify `bin/check-agent-tiers.py`, `tests/test_check_agent_tiers.py`, and
`tests/model-tiers.test.ts`.

- [ ] Run the current focused Python checker suite and save its failing exit.
- [ ] Change only these expected model entries, keeping reasoning unchanged:

```python
"simplifier.md": ("tiers/tier-3", "max"),
"verifier.md": ("tiers/tier-3", "max"),
```

- [ ] Add regression cases rejecting drift of each agent back to tier 4;
  retain current valid-configuration and unrelated-validation tests.
- [ ] Extend the existing Bun SDK-resolution mapping with Pi's real TypeBox
  modules. Installed subagents 0.22.0 declares TypeBox as a peer; Pi's loader
  supplies these aliases, but the test currently omits them. Use:

```typescript
"typebox": realpathSync(Bun.resolveSync("typebox", PI_ENTRY)),
```

  Keep real validation and agent execution. Do not stub validation, skip the
  integration test, patch installed packages, or install a second SDK. Stop
  on any remaining baseline failure rather than expanding dependency scope.
- [ ] From repository root, run:

```sh
python3 -m unittest discover -s pi/.pi/agent/tests \
  -p test_check_agent_tiers.py -v
mise exec -- bun test ./pi/.pi/agent/tests/model-tiers.test.ts
mise run check
```

Expected: zero exit codes; tier drift rejected, all agents still dispatched
through the installed runner, and existing isolation assertions retained.

## Deliverable 1: small, explicit tool-call guardrails

Create `extensions/tool-rules/index.ts`,
`extensions/tool-rules/rules.ts`, and `tests/tool-rules.test.ts`.
Use a typed constant table for the five rules, not a Markdown configuration
format, loader, or new dependency. Add brief operational documentation to
root `README.md`, linking to the rule definitions instead of duplicating them.

### Rule interface

One regex per rule, applied to normalized shell-command strings. No
config parser, templating, inheritance, project overrides, live watcher,
AST matching, output filtering, stream interruption, or automatic rewrites.

Normalize only these known executable surfaces into Bash-shaped calls:
`bash.input.command`, `ctx_execute.input.code` when language is `shell`, and
`ctx_batch_execute.input.commands[].command`. Confirm the installed tools'
registered names before binding adapters; do not guess namespace aliases.
Keep rules defined once against normalized shell commands. Other languages
and arbitrary nested input are not scanned. A matching batch blocks
or confirms the entire exact invocation; consent is never reused per item.
Derive effective cwd from each producer's verified execution behavior and
explicit cwd argument, not blindly from the parent session. Test overrides
and relative paths; if cwd cannot be established, retain the scoped-policy
evidence gap rather than silently asserting the Snowflake rule covers it.

```typescript
export interface Rule {
  name: string;
  condition: RegExp;
  cwd?: RegExp;
  action: "block" | "confirm";
  message: string;
}

export interface Call {
  toolName: string;
  input: Record<string, unknown>;
}

export function matchingRules(
  rules: readonly Rule[], call: Call, cwd: string,
): Rule[];
```

Example fixed rule entry in `rules.ts`:

```typescript
const uvDbt: Rule = {
  name: "uv-dbt",
  action: "block",
  condition: /\buv\s+(?:run\s+)?dbt\b/,
  message: "Use installed dbt, not uv. Missing local profiles or " +
    "packages alone is not a reason to skip dbt Cloud parse.",
};
```

- [ ] Define all five entries in `export const RULES: readonly Rule[]`.
  Validate the shipped table's count and unique names in tests. Keep regexes
  non-stateful (`g`/`y` forbidden) and reload changes with Pi `/reload`.
- [ ] Write pure matching tests with real producer shapes:

```typescript
const call = {
  toolName: "bash", input: { command: "uv run dbt parse" },
};
expect(matchingRules(rules, call, "/repo").map(r => r.name))
  .toContain("uv-dbt");
expect(matchingRules(rules, {
  toolName: "bash", input: { command: "dbt parse" },
}, "/repo")).toEqual([]);
```

- [ ] Implement deterministic matching of the selected string field and cwd.
  Add explicit normalization tests for each supported producer, including
  whole-batch decisions, missing/malformed fields, and JavaScript/Python
  context-mode calls that are deliberately outside this coverage. Never
  stringify entire tool inputs or recursively inspect arbitrary data.
- [ ] Add the five fixed rules and the following behavior cases. Use bounded,
  reviewed regexes for this finite set, not a new shell parsing framework.
  Broad raw-command matching may flag quoted examples. Document that limit;
  do not promise complete command semantics or bypass-proof detection.

| Rule name | Scope and expected behavior |
| --- | --- |
| `snowflake-terraform` | Block Terraform/Terragrunt plan/apply in cwd |
| | named `snowflake-objects` or a descendant; message: Justin runs these. |
| `uv-dbt` | Block `uv dbt`, `uv run dbt`; suggest installed `dbt`. |
| `merge` | Confirm `git merge` and `gh pr merge`, including options. |
| `force-push` | Confirm `git push -f`, `--force`, `--force-with-lease`. |
| `recursive-force-delete` | Confirm `rm -rf`, `-fr`, `-r -f`, long flags. |

Tests must include executable absolute paths, `git -C`, environment prefixes,
newline/semicolon/AND chains, and `zsh -ic`/`bash -lc` wrappers for the seed
operations. Include `terraform -chdir=... plan` within scoped cwd. Allow
`git status`, `git diff`, ordinary `git push`, `gh pr view`, `dbt parse`,
`uv run pytest`, `rm file`, and Terraform outside the defined cwd scope.
Explicit gaps: directory changes inside a command, targeting Snowflake from
other cwd paths, aliases, script bodies, dynamic/eval execution, other tool
executors, and isolated subagents. Retain instructions for these cases.

### Extension lifecycle and per-call approval

- [ ] Test the registered hook with a fake Pi/context before implementation:
  no match passes unchanged; block returns `{ block: true, reason }`; approval
  accepts only affirmative consent, cancel/refusal blocks; no UI blocks;
  missing command field is handled safely; a block wins over confirmations.
- [ ] Resolve matching rules, then apply the strongest action. A prohibited
  match never becomes confirmable merely because another rule matches.
  Aggregate approval-required matches into one dialog for the exact call.
- [ ] Use `ctx.hasUI` and the host's supported confirmation dialog. Never
  infer approval from model-authored arguments or remembered chat text.
  Headless results tell the user to perform the operation manually or rerun
  interactively; there is no persistent override or permit-next mechanism.
- [ ] Serialize simultaneous confirmation dialogs using a small promise
  queue, not a new task scheduler. Consent belongs to only the shown call.
  Test two concurrent calls with opposite answers and rejection cleanup.
- [ ] Never log/persist command text, matched input, or secret values in rule
  errors or telemetry. No secret scanner is promised. The ordinary host
  transcript and user-controlled dialog remain subject to existing policy.
  Include tool, cwd, and exact invocation in confirmation, not in extra
  stored messages. Later extension handlers can mutate inputs, so do not
  claim immutable-call enforcement against other trusted extensions.
- [ ] Dialog exceptions block the call and release the queue. No runtime
  policy loader or separate failed-load recovery state is needed.
- [ ] Test a real offline Pi session with a faux provider and a harmless Bash
  sentinel: an attempted matched operation is blocked before the underlying
  tool runs. Use mocked confirmation for affirmative/negative paths; never
  execute real deletion, merges, force pushes, Terraform, or dbt in tests.
  Reuse the SDK-loading pattern in `tests/model-tiers.test.ts` without
  extracting a new shared test framework.
- [ ] Document trust scope, the five rules, confirmation/headless behavior,
  reload instructions, regex limits, and extension-removal rollback in README.
  Document that direct child-process execution inside extensions and tools
  is not automatically intercepted by the parent's Bash hook.

Run from repository root:

```sh
mise exec -- bun test ./pi/.pi/agent/tests/tool-rules.test.ts
mise run check
```

Expected: all behavior cases pass with no provider requests or unsafe calls.
Fold automatic extension discovery into that real-session test using a
temporary Stow-like agent directory. Do not add a separate discovery test,
restow, or change live package settings just to make tests pass.

## Deliverable 2: concise, explicit reviewer reporting

Modify `agents/reviewer.md` and `prompts/code-review.md`. Preserve reviewer
model/display name tier 2. No undocumented agent frontmatter fields, package
patches, mandatory workflow orchestration, or additional reviewer agent.

- [ ] Replace the existing Report section with this fixed output contract.
  The reviewer emits one JSON object, not a fenced code block or extra prose.
  It is an instruction-level contract; the parent still validates the result.

```json
{
  "state": "completed",
  "verdict": "no-confirmed-findings",
  "snapshot": null,
  "confidence": 0.8,
  "findings": [],
  "pre_merge_checks": [],
  "suggestions": [],
  "coverage": ["paths and execution flows inspected"],
  "checks": [{"command": "actual command", "result": "actual result"}],
  "evidence_gaps": []
}
```

`state`: completed or incomplete. `verdict`: changes-required,
no-confirmed-findings, or inconclusive. An incomplete lifecycle always means
inconclusive, never a clean result. `snapshot` is null only when no identity
is supplied. Otherwise it echoes `artifact_sha256`, `base`, `head`, and
`paths_sha256` from the supplied capture; fields not applicable to a plan
capture are null. The parent verifies every applicable identity field against
the frozen snapshot. Confidence is numeric 0..1, not a correctness guarantee.

Each verified finding has `title`, `priority` (P0..P3), `confidence`, `path`,
`line_start`, `line_end`, `impact`, `evidence`, and `recommendation`. Require
positive, ordered line numbers and the smallest relevant range, normally at
most 10 lines; wider context belongs in evidence. Priorities: P0 urgent,
P1 high, P2 normal, P3 low. Sort by severity, not confidence.

Each unverified `pre_merge_checks` item has `concern`, `priority`,
`confidence`, `missing_evidence`, and `verification_step`. Optional suggestions
are explicitly non-blocking. Serious plausible concerns stay visible even
with low confidence. No findings does not prove correctness.

- [ ] Shorten duplicated investigation wording in the slash prompt by
  delegating investigation/report details to reviewer.md. Retain dispatch
  ownership, frozen identity, independent correctness/simplicity checks,
  freshness, personal verification, retry/acceptance, and incomplete handling.
- [ ] Parent acceptance: require a completed Agent lifecycle result and
  well-formed contract; reject missing/invalid fields or mismatched identity.
  Request one corrected report; if unavailable/malformed again, report an
  incomplete review. Never infer success from a JSON `state` field alone.
- [ ] Validate Markdown/frontmatter and the example with JSON.parse.
  Reuse existing all-agent dispatch tests for loading; do not add canned
  report-transport tests that pass even if the contract text disappears.
  Keep parent acceptance explicit, without a new JSON schema runtime.
- [ ] Verify both severity and confidence, a serious unverified concern,
  empty findings with evidence gaps, and incomplete status survive the
  report examples and parent instructions. Use semantic checks and manual
  inspection, not exact prose snapshots.

Run `mise run check` from repository root. Live model report compliance
remains a labeled manual smoke check, not a claimed automated guarantee.

## Deliverable 3: prune memory without weakening policy

Modify `memory/USER.md`, `memory/WORKFLOWS.md`,
`skills/snowflake/SKILL.md`, and `skills/cortex-code/SKILL.md`.
Reread each immediately before editing.

- [ ] Remove only the approved final `- that.` bullet from USER.md.
- [ ] Preserve the Snowflake Terraform preference, installed-dbt preference,
  dbt Cloud explanation, and all broad safety/approval instructions. Bash
  matching does not cover every execution path, so these are not redundant.
- [ ] Move the detailed Cortex-to-Snowflake staging key-pair fallback from
  WORKFLOWS.md into a `Cortex authentication fallback` section in the
  Snowflake skill. Preserve the account, environment-variable names,
  interactive zsh requirement, in-memory credentials, and authority checks;
  add no credential values. In the Cortex skill, add a short pointer to that
  Snowflake section so the fallback is discoverable for Cortex failures.
- [ ] Replace the original workflow bullet with:

```markdown
- If Cortex cannot access Snowflake, use the existing 1Password key-pair
  fallback in the `snowflake` skill; do not rely only on saved CLI profiles.
```

- [ ] Validate budgets using character counts, not bytes; USER/WORKFLOWS must
  each be <=4,000 characters and retain exactly one copy of required headings.
  Read final diffs to verify there was no loss of safety or procedural detail.
- [ ] Run the memory-governor suite and the full check. Report paths, moved
  content, and why it no longer needs always-on injection.

```sh
mise run check-memory
mise run check
```

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
  guardrails, reviewer reporting, and memory cleanup into coherent commits
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
