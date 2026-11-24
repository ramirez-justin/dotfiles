# Agent test guardrails

The user-level Pi and Claude Code instructions require high-signal tests and
explicit approval for new test files. Use this workflow when you want to
verify that a task stayed within its approved test scope.

## Check the Git baseline

From the dotfiles root, run this in a Bash shell **before** handing off the
task. Continue only if `git status` prints nothing and exits successfully.
Keep the baseline commit ID outside the agent's control. Start from a clean
worktree for the scoped paths; do not reset or stash unrelated work for this.

```bash
baseline=$(git rev-parse --verify HEAD) || exit 1
test_paths=(
  pi/.pi/agent/evals/verification
  ':(glob)**/tests/**' ':(glob)**/test/**'
  ':(glob)**/*.test.*' ':(glob)**/*.spec.*' ':(glob)**/test_*'
)
git status --porcelain=v1 --untracked-files=all -- "${test_paths[@]}"
```

After the task, in the same shell, compare the worktree and index with the
original Git tree, then check for untracked files:

```bash
git diff --exit-code "$baseline" -- "${test_paths[@]}"
git diff --cached --exit-code "$baseline" -- "${test_paths[@]}"
git ls-files --others --exclude-standard -- "${test_paths[@]}"
```

For a task with no approved test changes, both diffs must exit zero and the
last command must succeed with no output. Otherwise review every reported
change against the approved paths and behavior. Adapt `test_paths` for other
repos or nonstandard fixtures. This detects changes in scope, including
committed edits and non-ignored new files; it does not prevent writes, cover
ignored files or submodule contents, or replace review of the full diff.

## Periodic pruning prompt

Run monthly or when CI test time noticeably grows:

> Audit the suite without editing it. For each proposed removal, consolidation,
> or flake fix, name the file and test, the contract it covers, the evidence
> that it is redundant or unreliable, and what check will retain that contract.
> Prioritize expensive duplicates and flaky tests with run-history evidence.
> Do not remove unique regression coverage to reduce the test count. Propose a
> small cleanup batch for approval, then run the affected suite after changes.
