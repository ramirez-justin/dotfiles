---
name: ponytail-review
description: >-
  Use for an explicit plan or diff simplicity review, or the required
  simplicity checkpoint in writing-plans, executing-plans, or code-review.
---

# Ponytail Review

Run a read-only simplicity review with `simplifier`. Do not use this as a
correctness, security, performance, or test-adequacy review. Do not launch it
for trivial direct edits outside the formal workflows unless requested.
Never apply findings automatically or treat required tests as bloat.

## Freeze and Capture

Freeze all writers before capture and keep them frozen through acceptance.
Capture the approved scope, not an agent-reconstructed summary. Use the
standard-library helper at `scripts/capture.py`, relative to this skill's
installed directory. Do not manually assemble payloads or depend on prior
capture output reaching a child. The helper never launches Pi or an Agent.

Put the approved requirements in a strict UTF-8 file. Keep that input outside
tracked/untracked review scope, for example in Git's private directory. Do not
put secrets in requirements or review artifacts. Choose the base explicitly;
never silently assume an unrelated base. For execution review, include all
implementation changes. From the reviewed repository:

```sh
helper="$HOME/.pi/agent/skills/ponytail-review/scripts/capture.py"
# Complete changes through the working tree, including untracked files:
python3 "$helper" capture-diff --repo "$PWD" --base "$base" \
  --requirements-file "$requirements"
# Committed changes only (excludes staged, unstaged, and untracked changes):
python3 "$helper" capture-diff --repo "$PWD" --base "$base" --head "$head" \
  --requirements-file "$requirements"
# Complete plan bytes; no newline normalization:
python3 "$helper" capture-plan --repo "$PWD" --plan "$plan" \
  --requirements-file "$requirements"
```

Use exactly one capture command for the intended scope. It returns JSON with
absolute `packet`, `artifact`, and `prompt` paths plus `packet-sha256`. Retain
that receipt in the parent; its digest pins the metadata and requirements.
The helper creates a unique private directory under the repository's Git
worktree directory, mode 0700, with files mode 0600. Its output cannot enter
its own untracked diff. Do not edit/rewrite those frozen files. Do not add
packets to commits or use them as temporary plan/spec files in the worktree.

The helper enforces this capture contract:

- Plans use exact `Path.read_bytes()` bytes and SHA-256.
- Diffs resolve requested refs to full commit IDs. Committed scope captures
  `git diff --no-ext-diff --no-textconv --binary <base> <head> --`.
  Working-tree scope omits `<head>` and records current HEAD. The net tracked
  diff includes staged and unstaged changes against the explicit base.
  Working-tree capture and verification block if any tracked entry has
  assume-unchanged or skip-worktree index flags, which can hide edits. Resolve
  those flags intentionally before retrying; never clear them automatically.
  Committed scope is unaffected.
- Changed paths use matching `git diff --name-only -z`. Working-tree scope
  adds `git ls-files --others --exclude-standard -z`. Each untracked addition
  uses `git diff --no-index --no-ext-diff --no-textconv --binary -- /dev/null
  <path>`, allowing exit 1 but blocking other failures.
- Deduplicated paths are sorted; `paths-sha256` hashes their newline-joined
  UTF-8 encoding with no final newline. Newline paths are rejected.
  Untracked addition diffs, including binary patches, are appended in that
  order. `artifact-sha256` hashes the exact combined bytes, not metadata.
- Artifact and input decoding is strict UTF-8. No trimming, reformatting,
  truncation, lossy decoding, selected hunks, or binary omissions are allowed.
  Unsupported or incomplete capture blocks review.

A supplied frozen file is the complete artifact, not a pointer to reconstruct
live changes. The generated prompt includes approved requirements, complete
metadata, exact snapshot path and digest, and full-read continuation guidance.
Repository reads may support evidence but cannot replace that snapshot.
Line-based continuation cannot recover a single physical line exceeding the
read tool's 50 KB output cap. If a line cannot be read completely, report the
limitation and block review; never infer or skip the missing bytes.

## Foreground Dispatch and Acceptance

Call the Agent tool with these explicit parameters:

```text
subagent_type: simplifier
run_in_background: false
isolated: true
```

Before dispatch, verify using the receipt's pinned digest:

```sh
python3 "$helper" verify --packet "$packet" \
  --packet-sha256 "$packet_sha256"
```

Read the complete returned `prompt` file and pass its contents verbatim as the
Agent prompt with the parameters above. Do not append a generic prompt, copy
the diff manually, or use inherited context; previous tool output is not a
supplied artifact. Do not permit fallback to another agent or replace this
review with the parent's self-review. Wait for the result before proceeding.

Run the same verification command after collection, before acceptance or reuse.
It checks pinned packet bytes, metadata schema, snapshot bytes/digest, and
exact generated prompt. It recaptures the declared scope to detect stale
contents, path lists, or resolved base/head refs. A stale scope requires fresh
capture and review, not a retry of the obsolete packet. Verification does not
parse Agent reports, prove an agent read the file, authorize work, or imply
correctness; those checks remain the parent's responsibility.

Accept only an Agent lifecycle result in the completed state from the resolved
`simplifier` agent. The report must contain all of:

```text
state: completed
artifact-kind: plan|diff
artifact-sha256: <digest>
base: <id>                 # diff only
head: <id>                 # diff only
paths-sha256: <digest>     # diff only
status: lean|changes-required
blocking-findings:
non-blocking-findings:
rejected-simplifications:
verification-performed:
evidence-gaps:
```

Validate the echoed kind and digest against the captured identity, and every
diff identity field against its captured value. Require explicit contents or
`none` for each report section. A `lean` report cannot have blocking findings.
A report's `state` field alone is not proof of completed Agent lifecycle state.

Dispatch errors, unavailable tools, failed collection, blank, aborted,
malformed, substituted-agent, or identity-mismatched results are failures.
Retry once with the same frozen artifact and explicit parameters. A second
failure blocks the formal workflow unless the user explicitly waives the
checkpoint; record any waiver and its scope. Never silently continue.

## Evaluate Findings

The parent verifies every finding against concrete file, line, plan-step, or
dependency evidence. Blocking findings require a verified simpler replacement
that satisfies the approved requirements. Fix and reassess each blocker, or
reject it with recorded technical evidence before proceeding. Unresolved
blockers stop approval, execution, or completion.

Send justified changes to the existing sole writer; do not create a competing
writer. After any artifact content change, capture a new identity and rerun
this checkpoint, regardless of which review prompted the change. A prior
successful report is reusable only after helper verification succeeds and
kind, artifact digest, and every applicable base, head, and path-list identity
field remain unchanged.

Report the accepted identity, findings and dispositions, verification gaps,
and any explicit waiver. Keep normal correctness review independent.
