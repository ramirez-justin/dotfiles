# Pi improvements: active roadmap

## Current milestone

Justin approved standalone, bounded verifier and Explore contracts before
resuming command-guardrail verification. The role changes and focused offline
regressions are implemented. Models, max effort, 16/12-turn limits, tools, and
isolation are unchanged. Other roles and reasoning-effort trials are outside
this milestone. Guardrail implementation and unrelated memory edits remain
preserved and uncommitted.

The pre-execution plan simplicity checkpoint was accepted. Final acceptance
is external to this roadmap: the parent owns private evidence, checkpoint
artifacts, test logs, and pilot results. Do not edit this document merely to
record acceptance after the final capture. No live pilot is claimed here.

## Remaining acceptance work

- Parent inspects the actual diff and runs fresh full checks (`mise run check`
  and `git diff --check`), preserving the existing guardrail coverage.
- Freeze the writer and capture the complete implementation working-tree scope
  against `548c5ac`, including untracked guardrails and role changes. Complete
  the required final-diff simplicity checkpoint; it is not waived.
- After checkpoint acceptance, run the repaired verifier on finite guardrail
  and role claims with exact owned checks and a finish condition. Run one
  bounded Explore source-location pilot. Record real lifecycle, turns, calls,
  evidence, and gaps; a forced-stop run does not count as completed.
- Resolve justified findings through the same writer. Any content change
  after capture requires refreshing the checkpoint. Preserve unrelated work.
  This writer will not commit, push, merge, install, or call work services.

## Later roadmap

Reviewer report format; safe memory pruning; measured always-on prompt
reduction; reversible tool-surface trial; opt-in bounded end-of-run advisor;
turn-local ultrathink. Other agent contract/effort experiments require their
own evidence and approval. Retain only this compact overall roadmap while
later phases remain unfinished; do not imply they are already implemented.
