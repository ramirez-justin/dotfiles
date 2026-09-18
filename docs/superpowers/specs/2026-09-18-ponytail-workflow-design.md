# Ponytail Workflow Integration Design

## Goal

Make Ponytail's balanced simplicity discipline a dependable part of the local
Pi development workflow. Apply it during design, planning, implementation, and
review without allowing minimum line count to override correctness or clarity.

## Non-goals

- Install Ponytail's runtime hooks or plugin machinery.
- Copy every upstream command or mode.
- Replace correctness, security, performance, or verification reviews.
- Automatically launch a specialist for direct typo-level or similarly trivial
  edits that bypass formal planning and review workflows.
- Automatically apply suggested simplifications.

## Source Alignment

The design adapts the core behavior from
[`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail):

1. Determine whether the work needs to exist.
2. Reuse an existing repository solution when possible.
3. Prefer the standard library.
4. Prefer native platform capabilities.
5. Prefer an already-installed dependency.
6. Prefer a direct solution over a new abstraction.
7. Only then write the smallest complete implementation.

As in Ponytail, the ladder runs after the agent understands the task and traces
the relevant code flow. Simplicity must not remove required validation, tests,
security, accessibility, observability, operational safety, or maintainability.

The mandatory specialist checkpoints are a local extension. Upstream
`ponytail-review` is normally invoked explicitly; this workflow makes the
independent simplicity pass deterministic.

Ponytail supports `lite`, `full`, `ultra`, and `off`. This integration adopts
balanced, full-like behavior as the always-on default and adds no mode-switching
machinery initially. That is an intentional local divergence.

## Architecture

### Always-on baseline

Add the balanced ladder to the global Pi instructions in
`pi/.pi/agent/AGENTS.md`. The rule applies to every coding task, including
small direct changes that do not enter a formal planning or review workflow.

Repeat the operational parts in agent contracts where enforcement matters:

- planning agents must justify new machinery and reject speculative steps;
- writer agents must use the first viable rung and avoid unrelated cleanup;
- review agents must keep correctness review distinct from simplification.

### Focused review skill

Add `pi/.pi/agent/skills/ponytail-review/SKILL.md` as the user-facing,
read-only review workflow. It launches `simplifier` synchronously against the
requested plan or diff, waits for its report, and does not apply fixes.

The skill must exclude correctness, security, performance, and test adequacy
from its findings and direct those concerns to the normal review process. It
must protect required tests and smoke checks from being classified as bloat.

### Simplifier agent

Add `pi/.pi/agent/agents/simplifier.md` as a read-only Terra specialist with
maximum reasoning. Set `isolated: true` in its frontmatter so it receives no
extension or MCP tools. Its explicit built-in tool allowlist contains only
`read`, `grep`, and `find`; it cannot receive `bash`, `edit`, or `write`. It
accepts either a plan or a diff and checks the Ponytail ladder against verified
repository context.

Its report contains:

- blocking unnecessary complexity;
- non-blocking reductions worth considering;
- rejected simplifications that would weaken requirements;
- verification performed and evidence gaps;
- a clear "lean already" result when nothing should change.

Findings must identify concrete files, lines, plan steps, or dependencies. The
agent must not optimize for line count alone. A finding is blocking only when
new machinery is unnecessary for an approved requirement and a verified,
simpler replacement exists. Style preferences and speculative reductions are
non-blocking or omitted.

### Strict dispatch

Set `fallbackSubagent` to `none` in `pi/.pi/agent/subagents.json`. Unknown,
disabled, ambiguous, or misspelled agent names must fail closed rather than
silently running `general-purpose` with broader tools.

This guarantee uses Pi's normal trust boundary. Trusted project-local agent or
subagent configuration remains authoritative; the integration does not add
runtime machinery to defend against deliberate trusted-project overrides.

### Artifact contract

Every invocation supplies an immutable artifact snapshot. For a plan, pass the
complete UTF-8 bytes with newlines preserved and their SHA-256 digest. For a
diff, pass the base and head identifiers, ordered changed paths, and complete
UTF-8 diff bytes with newlines preserved. Include the SHA-256 digest of the diff
bytes and of the newline-joined UTF-8 path list. Prevent concurrent writes while
the foreground review runs. Repository reads provide supporting context but
cannot replace the supplied artifact.

The parent accepts only an Agent lifecycle result in the completed state. A
valid report must echo `state: completed`, `artifact-kind: plan|diff`, and
`artifact-sha256: <digest>`. Diff reports must also echo `base: <id>`,
`head: <id>`, and `paths-sha256: <digest>`. The report includes
`status: lean` or `status: changes-required`, blocking findings, non-blocking
findings, rejected simplifications, and evidence gaps. Blank, aborted,
malformed, mismatched, or substituted-agent results count as failures and use
the same retry-and-block policy.

## Mandatory Checkpoints

The specialist pass is required at these workflow boundaries:

1. `writing-plans` launches `simplifier` with `run_in_background: false` and
   `isolated: true` on every generated implementation plan before approval or
   execution.
2. `executing-plans` launches `simplifier` with `run_in_background: false` and
   `isolated: true` on the final diff before independent verification and
   completion.
3. `/code-review` launches `simplifier` with `run_in_background: false` and
   `isolated: true` alongside the correctness-focused reviewer, even when the
   explicitly requested review is small.

Each workflow waits for and evaluates the result before continuing. If dispatch
or result collection fails, retry once. A second failure blocks that formal
workflow unless the user explicitly waives the checkpoint.

The parent validates findings before acting. Before continuing, every blocking
finding must either be fixed and reassessed or rejected with documented
technical evidence. An unresolved blocking finding stops approval, execution,
or completion. Keep the normal reviewer focused on correctness, safety, tests,
and regressions; reserve unnecessary-machinery findings for `simplifier`.

Rerun `simplifier` after any content change to the assessed artifact,
regardless of which review prompted it. A successful report may satisfy a later
checkpoint only when the artifact digest, base and head identifiers, and path
list digest are unchanged.

Small edits that bypass these formal workflows still receive the always-on
ladder through global and writer instructions.

## Files

Create:

- `pi/.pi/agent/agents/simplifier.md`
- `pi/.pi/agent/skills/ponytail-review/SKILL.md`

Modify:

- `pi/.pi/agent/AGENTS.md`
- `pi/.pi/agent/agents/Plan.md`
- `pi/.pi/agent/agents/AstraPlan.md`
- `pi/.pi/agent/agents/worker.md`
- `pi/.pi/agent/agents/implementer.md`
- `pi/.pi/agent/agents/reviewer.md`
- `pi/.pi/agent/skills/writing-plans/SKILL.md`
- `pi/.pi/agent/skills/executing-plans/SKILL.md`
- `pi/.pi/agent/prompts/code-review.md`
- `pi/.pi/agent/subagents.json`
- `mise.toml`

No upstream Ponytail package or runtime hook is installed.

## Validation

- Add `simplifier` and `ponytail-review` to `check-agent-tiers` validation.
- Assert the simplifier model, reasoning tier, `isolated: true`, and exact
  read-only built-in tool list.
- Assert `fallbackSubagent` is `none`.
- Validate skill frontmatter and reject `TBD` or `TODO` markers in created or
  modified Pi agent, skill, prompt, and instruction files.
- Run `mise run check-agent-tiers`.
- Check Markdown line lengths for all changed files.
- Inspect the final diff for artifact, synchronous checkpoint, and retry rules.
- Confirm the specialist cannot edit files and does not replace normal review.
- Run the new process against its own plan and final diff.
