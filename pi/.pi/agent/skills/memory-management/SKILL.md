---
name: memory-management
description: >-
  Audit, prune, and apply durable Pi memory updates. Use when the user asks to
  remember something, update memory, forget stale facts, learn from PR review
  feedback/comments, or preserve a reusable preference or workflow across
  sessions.
---

# Memory Management

Use this skill to manage durable memory in Justin's dotfiles-backed Pi setup.

## Memory Files

Keep each memory file intentionally small and scoped:

- `pi/.pi/agent/memory/USER.md` contains durable user preferences only.
- `pi/.pi/agent/memory/WORKFLOWS.md` contains reusable workflows only.
- `pi/.pi/agent/memory/PROJECTS.md` contains stable project facts only.

## Process

1. Classify the candidate memory as user preference, workflow, project fact, or
   not worth storing.
2. Reject secrets, credentials, private keys, tokens, transient session details,
   already represented facts, overly session-specific notes, and unverified
   assumptions.
3. Read the target memory file before editing.
4. Audit the file for duplicate, stale, overly specific, or low-value entries.
5. Prefer updating, merging, deduplicating, or pruning existing entries over
   appending.
6. If the file is getting long, make a cleanup edit before adding more memory.
7. Apply the smallest useful edit directly; memory is Pi-owned and does not
   require per-change user approval.
8. Show the diff or concise change summary, the reason for the change, and the
   resulting file path.

## Learning From Review Feedback

Use this when Justin asks Pi to learn from PR reviews, review comments, or
post-review fixes. This is part of memory management, not a separate memory
system.

### Sources

Use the available source, in this order:

1. Review feedback already present in the Pi conversation.
2. GitHub PR metadata and comments, when a PR number or URL is provided.
3. Local commits/diffs made in response to review feedback.

For GitHub, gather read-only evidence first:

```bash
gh pr view <N> --json number,title,body,comments,reviews,reviewThreads
```

If inline review comments are needed and `gh pr view` is insufficient, use the
GitHub API read-only endpoints for PR review comments before mutating anything.

### Classification

For each review item, classify it as one of:

- **Task-specific**: applies only to the current branch or implementation.
- **Durable preference**: stable Justin preference; route to `USER.md`.
- **Reusable workflow**: process rule; route to `WORKFLOWS.md`.
- **Project fact**: stable repo/project caveat; route to `PROJECTS.md`.
- **Skill/test candidate**: repeated procedural lesson that should become a
  skill update, script, or regression test instead of memory only.

### Promotion Rules

Promote only durable, low-risk lessons. Distill the lesson; do not copy raw
review text.

Good examples:

- Prefer broad behavior regressions over exact prompt fixtures.
- For PR replies, use inline review-thread replies rather than top-level
  comments.
- In this repo, run `<stable command>` before claiming review feedback is fixed.

Reject or archive:

- One-off implementation details.
- Raw code snippets from review unless they describe a reusable rule.
- Reviewer opinions that were not verified against the codebase.
- Secrets, credentials, internal URLs, or private config.

### Output

When done, report:

- Review source inspected.
- Durable lessons promoted, with target file paths.
- Items intentionally not promoted and why.
- Any suggested skill/test updates that should be made separately.

## Size Control

Keep memory compact enough to audit quickly. Never silently grow memory. If a
memory file starts to feel long, make or propose a cleanup diff before adding
more:

- Merge overlapping entries.
- Remove stale or low-value details.
- Keep examples only when they change future behavior.
- Prefer one durable rule over several narrow anecdotes.

## Good Memory

Good memory is stable, actionable, and likely to affect future sessions.
Examples:

- Preferred tools or workflows.
- Repeated project caveats.
- Durable communication preferences.
- Explicitly approved rejected approaches.

## Bad Memory

Do not store:

- Secrets or credential material.
- Temporary task state.
- Raw command output.
- Guesses about the user or workplace.
- Duplicates or facts already represented by existing memory.
- Details so narrow they are unlikely to change future behavior.
- Unverified assumptions.
