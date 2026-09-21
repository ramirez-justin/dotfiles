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

Freeze all writers before capture and keep them frozen until the foreground
review finishes. Capture the approved scope, not an agent-reconstructed summary.
Use Python `Path.read_bytes()`, subprocess byte output, and
`hashlib.sha256(data).hexdigest()` to avoid newline normalization. Decode as
UTF-8 strictly for the prompt, without trimming, reformatting, or truncation.
If complete UTF-8 capture is impossible, report the gap and block; do not omit
unsupported content or pretend a partial artifact is complete.

For a `plan` artifact:

- Read the complete plan bytes, preserving newlines, and compute their SHA-256.
- Supply `artifact-kind: plan` and `artifact-sha256: <digest>`.
- Supply the complete plan inside explicit artifact begin/end delimiters.

For a `diff` artifact:

- Resolve the requested base and head to full commit IDs with
  `git rev-parse <ref>^{commit}`. Record the review scope: committed changes
  only, or changes through the current working tree. Never silently assume an
  unrelated base. For execution review, include all implementation changes.
- Capture complete diff bytes using `git diff --no-ext-diff --no-textconv
  --binary <base> <head> --` for committed scope, or the same command with
  `<head>` omitted for working-tree scope. The latter includes the net staged
  and unstaged changes against the base. Record current HEAD as `head` in that
  case; the artifact digest identifies the uncommitted contents.
- Obtain changed paths with the matching `git diff --name-only -z` scope.
  For working-tree scope, also use `git ls-files --others --exclude-standard
  -z` and include each untracked created file. Capture its full addition with
  `git diff --no-index --no-ext-diff --no-textconv --binary -- /dev/null
  <path>`; exit 1 means a diff, not a capture failure. Other failures block.
- Deduplicate and sort the complete changed-path list deterministically. Hash
  its UTF-8 encoding joined with newline characters, with no final newline.
  Reject paths containing newlines rather than creating an ambiguous identity.
- Append untracked addition diffs in that same path order to the tracked diff
  bytes. Hash the exact combined bytes. Never substitute a diffstat, selected
  hunks, or only tracked changes for the complete artifact.
- Supply `artifact-kind: diff`, `artifact-sha256`, `base`, `head`,
  `paths-sha256`, the ordered path list, and complete diff bytes in explicit
  artifact begin/end delimiters. Include the scope description.

Choose delimiters absent from the artifact. Keep artifact bytes distinct from
metadata and delimiters; hash only the artifact bytes. Repository reads may
support evidence but cannot replace the supplied snapshot.

## Foreground Dispatch and Acceptance

Call the Agent tool with these explicit parameters:

```text
subagent_type: simplifier
run_in_background: false
isolated: true
```

Supply the frozen artifact, metadata, approved requirements, and the request
for the report envelope defined in `../../agents/simplifier.md`. Do not permit
fallback to another agent or replace this review with the parent's self-review.
Wait for the result before proceeding.

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
successful report is reusable only if kind, artifact digest, and every
applicable base, head, and path-list identity field remain unchanged.

Report the accepted identity, findings and dispositions, verification gaps,
and any explicit waiver. Keep normal correctness review independent.
