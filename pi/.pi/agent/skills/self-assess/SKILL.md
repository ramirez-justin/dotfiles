---
name: self-assess
description: >-
  Review how a recent task was handled when the user explicitly requests
  self-assessment. Identify avoidable overhead and propose concrete,
  evidence-backed improvements.
disable-model-invocation: true
metadata:
  status: stable
---

# Self-assess

Assess the recent task, not the entire Pi configuration.

Use the user's request, feedback, observable actions, diffs, and recorded
check/review results. Do not reconstruct unavailable history.

## Assess

- Did the delivered outcome address the user's actual need?
  Passing tests or creating artifacts alone does not establish usefulness.
- Which claims are supported, and what remains uncertain?
- What complexity, repetition, or effort was avoidable?
- What concrete change would address a supported finding, if any?
  Removing work or clarifying the goal may be better than adding machinery.

Ground conclusions in specific evidence. Do not invent shortcomings,
assign scores, or force a recommendation.

Turn supported findings into a concrete proposal, not just a general lesson.
Prefer tightening an existing relevant artifact over adding new machinery.

## Report

Keep the report brief:

- Outcome: what was delivered versus needed.
- Evidence and gaps: what is known and unconfirmed.
- Avoidable overhead: specific examples, or none.
- Proposed improvement: the highest-value concrete change, or none.
  Include:
  - Target: the specific file, skill, prompt, or workflow to change.
  - Change: exactly what to alter; do not invent an unknown target path.
  - Evidence: the observed problem this addresses.
  - Benefit: the expected practical improvement.

If proposing a change, ask whether the user wants it applied. Invoking this
skill does not authorize implementing its recommendations.

## Boundaries

Read-only: do not edit files, update memory, change configuration, or
contact external services.

Reuse existing evidence. Do not automatically rerun checks or dispatch
agents. Report missing evidence rather than inventing it.

This supplements discussion; it does not replace /finish, independent
review, or required verification.
