# Pi improvements: active roadmap

## Current milestone: reviewer reports and memory cleanup

Approved document-only implementation is prepared for final frozen review:

- Reviewer Report defines a nine-field raw JSON contract, exact captured
  identity, verified findings, separate unverified pre-merge checks,
  suggestions, actual coverage/checks, and evidence gaps. Incomplete is
  inconclusive, never
  a pass. This is prompt guidance, not runtime schema enforcement.
- Code-review retains parent dispatch and acceptance, frozen full reads,
  independent correctness/simplicity, personal verification, and freshness.
  Correctness reviewers never receive the simplifier-specific generated prompt.
- USER loses only the approved stray bullet. WORKFLOWS replaces the full Cortex
  fallback with the approved pointer; the procedure moves intact into Snowflake
  and is linked from Cortex. No live authentication behavior is claimed.
- Reviewer configuration/investigation, other agents, guardrails, framework,
  code/tests, and unrelated gametime-data memory remain outside this milestone.

The frozen-plan simplicity checkpoint was accepted before implementation.
Requirements and subsequent acceptance evidence are kept privately under
`.git/`; do not edit this roadmap to record post-review acceptance.
Final working-tree capture base: `39631c7`.

## Remaining acceptance work

Parent owns actual-diff inspection, final frozen simplicity/correctness
reviews, bounded independent verification, full `mise run check`, and one local
reviewer-format smoke exercise. The pilot is not runtime enforcement or a
future correctness guarantee. Focused writer checks cover the actual embedded
JSON, unchanged reviewer configuration/investigation, validated memory budgets,
complete procedure relocation, local link, Markdown widths, `check-memory`,
and diff whitespace. Acceptance is pending until parent verifies the evidence.
No provider/work-service calls, installs, push, or merge are part of this work.

## Deferred roadmap

Measured always-on prompt reduction; reversible active-tool surface trial;
opt-in bounded end-of-run advisor; turn-local ultrathink. Model/effort trials
for other agents remain evidence-driven and separately approved.
