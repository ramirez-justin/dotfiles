---
name: self-assess
description: >-
  Collect session evidence and request an independent improvement review when
  the user explicitly requests self-assessment of a recent task.
disable-model-invocation: true
metadata:
  status: stable
---

# Self-assess

Coordinate an evidence-backed improvement discussion about the recent task,
not a broad Pi configuration audit or an assessment of your own performance.

## Collect evidence

Assemble a bounded, neutral brief from existing session evidence:

- User intent, constraints, and corrections.
- Observed actions and delivered outcome versus the requested outcome.
- Successful checks and review results, plus failures and repetition.
- Source references and known gaps, including unavailable history.
- Material disconfirming evidence, not just examples favoring a change.

Distinguish direct observations from others' reports and inference. Do not
preselect a diagnosis, reconstruct unavailable history, or include secrets,
private transcript dumps, or raw prompts. Passing checks alone does not
establish that the outcome met the user's need.

## Request independent review

Make exactly one fresh `Agent` call using the existing role:

- `subagent_type: reviewer`
- `inherit_context: false`
- `isolated: true`
- `run_in_background: false`

Use the role's configured model and reasoning defaults without overrides.
Supply the brief explicitly; do not assume access to the parent conversation.
Include the goal, constraints, evidence, source references, known gaps, and
this finite finish condition: return one concise report identifying supported
actionable improvements or no change after bounded investigation.

In the reviewer prompt, require:

- Read-only, hypothesis-directed checks of relevant local sources only.
  No broad configuration audit, rerunning checks, external calls, or nested
  agents. Reuse existing evidence; label unavailable evidence explicitly.
- Its own nine-field JSON reporting contract in
  `~/.pi/agent/agents/reviewer.md`, not a replacement schema. Do not invent
  snapshot identities when none is supplied.
- Supported workflow improvements may be non-blocking `suggestions`; do not
  fabricate correctness defects to justify them. Prefer an existing relevant
  target over new machinery, and allow no change.

Check the returned contract, completion state, actual coverage/check evidence,
and gaps before using it. If the reviewer is unavailable, the report is
malformed or incomplete, or required evidence is missing, report the limits
and stop.
Do not automatically retry, launch another agent, or fall back to self-grading.
A fresh reviewer is another perspective, not objective proof.

## Discuss the result

Summarize at most one highest-value actionable recommendation, or no change:

- Target: the exact existing file, skill, prompt, or workflow; do not invent it.
- Change: what to alter.
- Evidence: the supported observation it addresses.
- Benefit: the expected practical improvement.
- Uncertainty: remaining gaps, contrary evidence, and limits.

Do not force a recommendation or assign numeric session scores. Ask for user
approval before any separate implementation under existing workflows.
Invoking this skill authorizes neither its recommendations nor automatic
planner or implementer dispatch.

## Boundaries

Remain read-only: no file edits, memory updates, configuration writes, or
external services. Do not replay sessions or run model experiments.

This is improvement discussion, not completion verification, evaluation
results, or proof of measured improvement. It does not replace `/finish`,
required verification, or independent correctness and simplicity reviews.
