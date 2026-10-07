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
Common memory policy lives in `AGENTS.md`; this skill owns the procedure.
Behavior below is implemented by `extensions/memory-governor/`.

## Authority

Curated Markdown under `pi/.pi/agent/memory/` (stowed to
`~/.pi/agent/memory/`) is the only durable memory authority. Context-mode
session history (`ctx_search`, SQLite) is searchable historical evidence.
Never treat it as a durable preference; promote a lesson only by curating it
into the files below.

## Memory Files

| File | Required sections | Contents | Budget |
| --- | --- | --- | --- |
| `USER.md` | Rules, Preferences | Stable preferences about Justin | 4000 |
| `WORKFLOWS.md` | Rules, Conventions | Workflow conventions | 4000 |
| `PROJECTS.md` | Rules, Scoped Projects, Unscoped Facts | Index | 5000 |
| `projects/<file>.md` | Rules, Facts | Facts for one repository | 5000 |

- `PROJECTS.md` indexes coordinate-backed scoped files as
  `` - `<coordinate>` → `` followed by the `` `projects/<file>.md` `` path.
  Put repository facts in the scoped file.
  Use Unscoped Facts only for stable facts with no repository identity.
- The coordinate is the normalized `origin` remote (for example,
  `github.com/owner/repo`); the file is `host--owner--repo.md`. Without a
  usable remote, a local identity hashed from the Git common directory is used;
  its scoped file is not indexed.
- Each required section must appear exactly once. Validation also blocks
  secret-like or prompt-injection-like text. Blocked files are omitted from the
  prompt with a diagnostic. Budget is in characters: over-budget files warn,
  and the governor refuses to grow them.
- Keep `## Rules` to short scope guidance; do not restate common policy.

## Reading

- `USER.md`, `WORKFLOWS.md`, and the current project file are injected each
  run. Do not reread them routinely.
- `memory_read` scopes: `user`, `workflow`, `index`, `current_project`
  (resolved from the tool call's working directory), and `project` with a
  `coordinate` that must exist in the `PROJECTS.md` index. Output is capped at
  5000 characters.

## Automatic Writes

- Only an explicit `Remember` prefix (colon optional, followed by whitespace
  and content) writes automatically. Content is stored whole as a bullet in
  the scope's section; it is never truncated. Whitespace is normalized, but
  long bullets are not line-wrapped.
- Scope is inferred: workflow/review wording goes to `WORKFLOWS.md`;
  repository wording or a relative file path goes to the current project file
  (created if missing; indexed only for coordinate-backed identities);
  anything else goes to `USER.md`.
- Explicit intent permits task-like facts, but input over 4000 characters,
  questions, ephemeral or transient wording, unverified guesses, secrets,
  prompt-injection text, duplicates, and budget overflow are rejected with a
  visible `Memory rejected:` notice: a UI notification, or a displayed
  session message when no UI exists. Notices never echo the content.
- Strong corrections such as "You keep..." are only injected once as a
  transient advisory; they are not persisted. Curate them manually if durable.
- Governor writes take a per-file lock, check the file hash before commit, and
  replace the file atomically.

## Manual Edits

1. Classify the candidate as user preference, workflow, project fact, skill or
   test candidate, or not worth storing. Reject secrets, task state, raw output,
   already represented facts, and unverified assumptions.
2. Reread the target file immediately before editing.
3. Audit it for duplicate, stale, overly specific, or low-value entries. Prefer
   merging, replacing, or pruning over appending; clean up before growing.
4. Make the smallest useful edit with the normal edit tool. Direct edits do not
   use the governor lock or hash check, so never describe them as guarded.
5. Keep required sections and line length under 80 characters.
6. Report the diff or concise summary, the reason, and the file path. Memory is
   Pi-owned and needs no per-change approval.

## `/memory-audit`

Runs through the governor's guarded writes on `USER.md`, `WORKFLOWS.md`,
`PROJECTS.md`, and every indexed project file. It only removes exact duplicate
bullets (whole wrapped bullets, compared within one section, ignoring line
wrapping). It does not merge near-duplicates or prune stale facts; do that
through manual edits. Index drift or a missing indexed file stops the audit.

## Learning From Review Feedback

Use this when Justin asks Pi to learn from PR reviews or review fixes.

Sources, in order: feedback already in the conversation, the PR, then local
commits made in response. Read only; reuse `reviewing-prs-with-verification`
for full review context rather than duplicating its procedure. Minimal reads:

```bash
gh pr view <N> --json number,title,body,comments,reviews
gh api --paginate repos/<owner>/<repo>/pulls/<N>/comments
```

Use `gh api graphql` with `pullRequest.reviewThreads` only when thread
resolution state matters. Also check linked Linear Review threads.

Classify each item as task-specific, durable preference (`USER.md`), workflow
(`WORKFLOWS.md`), project fact (scoped project file), or skill/test candidate.
Promote only verified, durable, low-risk lessons; distill rather than copy
review text. Report sources inspected, lessons promoted with paths, items not
promoted and why, and suggested skill or test updates.
