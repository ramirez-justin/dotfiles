---
name: reviewing-prs-with-verification
description: Use when reviewing a GitHub pull request, drafting review comments, or posting review feedback — especially when findings should be anchored to specific lines rather than a top-level blob.
---

# Reviewing PRs With Verification

## Overview

**Core principle:** No finding gets posted without verification against real code. Every comment anchors to a specific file and line. Findings are posted as one GitHub review, not scattered comments.

The built-in review loop is easy to short-circuit: read the diff, write opinions, post. That produces generic feedback that often turns out to be wrong when someone checks it. This skill makes verification non-optional.

## When to use

- Asked to review a PR ("review PR 5577", "look at this PR", "what do you think of this diff")
- Drafting review comments before posting
- Re-reviewing after a push

**Don't use** (plain review is fine) for: docs-only PRs, trivial dep bumps, rename-only PRs, PRs you own that haven't been opened yet.

## The four phases

### 1. Scan

```bash
gh pr view <N> --json title,body,headRefOid,baseRefOid
gh pr diff <N> --name-only
gh pr diff <N>   # pipe to a file if large
```

Capture the HEAD SHA from `headRefOid` — you'll pin the review to it in phase 4. Read the PR body; it usually states motivation and post-merge plan, which should inform what you look for.

### 2. Verify (non-optional)

**Before writing any finding, fetch the PR branch locally so you can read real files, not just hunks:**

```bash
git fetch origin pull/<N>/head:pr-<N>
# or: gh pr checkout <N>
```

For every potential finding, verify against one of:

- **In-repo facts** — Read the surrounding file, not just the diff. Grep for callers, callees, related config.
- **Cross-references** — If the PR subclasses an operator, read the parent. If it relies on a consumer's message handling, read the consumer. If it depends on upstream library behavior, read the vendored source in `.venv/` or `node_modules/`.
- **Language semantics** — Claims like "`os.Exit` skips deferreds" or "`context.Background()` has no deadline" are standard language behavior. State them, don't hedge.

If a finding can't be verified from code alone (e.g. "does this Airflow Variable exist in staging?"), mark it **Unverified** and hand it back to the author as a pre-merge check.

### 3. Score

Every finding gets a row:

| Finding | Confidence | Severity | Action |
|---|---|---|---|
| ... | High / Medium / Unverified | Blocker / Medium / Low / Nit / Style | Fix / Optional / Doc only / **Withdraw** |

**Withdraw is a first-class action.** If verification contradicts a finding you drafted, drop it and say so. A withdrawn finding builds trust; a silently-posted wrong one destroys it.

**Upgrade when warranted.** If verification reveals a finding is worse than you first thought (e.g. "comment is inaccurate" → "comment describes behavior that never happens in the failure path"), promote the severity and say why.

### 4. Preview, then post

Show the human the full payload — top-level summary plus every inline comment with its `path` and `line` — **before** sending. Wait for explicit "post" / "go" / "looks good".

Post as **one review** with inline comments:

```bash
# Write payload to /tmp/pr<N>-review.json, then:
gh api repos/<owner>/<repo>/pulls/<N>/reviews --method POST --input /tmp/pr<N>-review.json
```

Payload schema:

```json
{
  "commit_id": "<HEAD SHA from phase 1>",
  "event": "COMMENT",
  "body": "<top-level summary + scoring table>",
  "comments": [
    {
      "path": "path/to/file",
      "line": 42,
      "side": "RIGHT",
      "body": "<inline comment>"
    }
  ]
}
```

- `side: "RIGHT"` = line number in the **new** file. Almost always what you want.
- `event: "COMMENT"` = neutral review. Only use `"REQUEST_CHANGES"` if the human asks.
- Multi-line range: add `"start_line": N, "start_side": "RIGHT"`.
- Return `.html_url` from the response so the human can open the review.

## Rationalizations to reject

| Excuse | Reality |
|---|---|
| "I already understand the code, skip verify" | Verification IS the value. Skip it and you're running plain `/review`. |
| "A top-level comment is easier than inline" | Inline anchors are the point. Don't make the reviewer hunt for the line. |
| "I'll post now and edit if wrong" | Edits don't un-notify. The preview gate exists for a reason. |
| "Finding is probably right, close enough" | "Probably right" is how reviewers lose credibility. Verify or drop. |
| "Withdrawing looks bad" | Silently leaving a wrong finding in a posted review looks worse. |
| "The PR is small, this is overkill" | Small PRs still benefit from verified, line-anchored comments. Skip only for truly trivial PRs (see When to use). |

## Red flags — STOP

- About to post without showing a preview
- Using line numbers from the diff's `@@` hunk header instead of the new file
- Reading only hunks, never opened the file or a cross-referenced dep
- Finding sits at "Unverified" but is being posted as a confident claim
- All findings are "Medium" severity — you're not actually scoring, you're labeling

## Common mistakes

- **No HEAD SHA pin** — the review attaches to whatever commit is current, which drifts if the author force-pushes mid-review. Always set `commit_id` to the SHA you verified against.
- **Diff line numbers instead of file line numbers** — GitHub wants the post-change file line. Use `grep -n` on the checked-out file, not hunk headers.
- **Old path after a rename** — use the new path in the `path` field.
- **Scattered top-level comments** — post once as a review, not N times as issue comments.

## Reference: phases at a glance

| Phase | Output | Gate |
|---|---|---|
| Scan | HEAD SHA, file list, PR motivation | — |
| Verify | Findings list, each tied to file+line | No finding without a verification source |
| Score | Confidence × severity × action table | Withdrawn findings removed before preview |
| Post | Preview → one `gh api .../reviews` call | Explicit human "post" before sending |
