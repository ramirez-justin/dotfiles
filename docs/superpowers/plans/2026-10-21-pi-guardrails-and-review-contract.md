# Pi improvements: measured prompt reduction

## Approved scope and evidence

Reduce redundant wording only in `pi/.pi/agent/AGENTS.md` and its
`memory/WORKFLOWS.md`; preserve all policy and USER/project memory, including
unowned gametime-data changes. This compact roadmap is the only other edit.
No runtime, tools, settings, skills, agents, templates, dependencies, provider
calls, installs, commits, pushes, or work-service actions in this writer pass.

The frozen-plan simplicity checkpoint was accepted. Private requirements,
source snapshots, semantic map, hashes, and check logs live under `.git/`.
Baseline `059b278`: global 5,584; USER 3,474; WORKFLOWS 3,989; rendered memory
8,483; combined 14,068 UTF-16 units; rough length/4 estimate 3,517 tokens;
warnings empty. Measure with `.git/measure-owned-prompt.ts`, the production
renderer, actual dotfiles identity, and complete unchanged source set. Require
a strictly smaller slice with no blocked, omitted, or truncated memory.
This excludes Pi core, tools, skill catalog, conversation, and other project
context; it is not an actual tokenizer count or a latency/cost guarantee.

## Remaining acceptance roadmap

1. Sole writer condenses eligible global sections and only the four approved
   workflow bullets. Preserve protected sections, seven simplicity rungs/full
   preservation clause, other workflow bullets, USER, and ALL project memory.
2. Before freezing, record private old-to-new semantic homes for every edited
   requirement; compare protected bytes/hashes, validate actual memory, measure
   the complete slice, check introduced Markdown lines <80, run focused
   `mise run check-memory` and `git diff --check`, and report exact exits.
3. Freeze writes. Parent inspects the actual diff and evidence, captures the
   full working-tree diff against `059b278`, and runs required final-diff
   Ponytail review and bounded independent verification. No checkpoint waiver.
   Meaning loss blocks acceptance; corrections return to the same writer and
   require refreshed checkpoints. Do not edit source to record acceptance.
4. Parent runs fresh `mise run check` (baseline 37 Python, 179 Bun) and final
   checks. Preserve unrelated work; no completion claim before acceptance.
   Remove task artifacts from worktree AND final diff before PR creation or
   finalization unless Justin requests retention. No commit/push in this pass.

## Deferred

Reversible active-tool surface trial; opt-in bounded end-of-run advisor;
turn-local ultrathink. Model/effort experiments remain evidence-driven.
