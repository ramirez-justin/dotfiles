# Pi Memory Reliability Design

## Goal

Make durable Pi memory reliably available during normal work while preserving
reviewable Markdown as the source of truth. Prevent concurrent sessions from
silently losing updates, and isolate repository facts so unrelated repositories
cannot share memory by basename.

## Context

The current setup has three global Markdown files:

- `USER.md` for durable user preferences.
- `WORKFLOWS.md` for reusable process conventions.
- `PROJECTS.md` for facts from every repository.

The memory governor detects candidates and writes explicit `Remember:` requests,
but it does not load memory into the agent prompt. `AGENTS.md` only asks the
agent to read memory when it seems relevant. That makes retrieval probabilistic.

`PROJECTS.md` is also close to its configured size limit. All automatic project
entries currently target its `Dotfiles` section, and direct synchronous writes
have no cross-process lock or atomic replacement.

Context-mode remains responsible for episodic session continuity and broad FTS5
recall. This design does not add another database or transcript index.

## Requirements

1. Every normal agent run receives user, workflow, and current-repository
   memory without requiring a tool call.
2. Markdown remains the authoritative, version-controlled memory store.
3. Repository memory is stored centrally in the dotfiles-backed Pi directory,
   not written into work repositories.
4. Repository identity comes from the normalized `origin` remote, with a stable
   local fallback when no remote exists.
5. Concurrent Pi sessions cannot silently overwrite each other's updates.
6. Existing project facts are migrated exactly once without loss or duplicate
   copies.
7. The agent can read another repository's memory through a read-only tool.
8. No new user-facing retrieval commands are introduced.
9. The existing unrelated `pi/.pi/agent/settings.json` working-tree change must
   remain untouched.

## Non-Goals

- Autonomous LLM review of full conversations.
- A second SQLite or vector memory store.
- Semantic search across memory files.
- Automatic memory aging, eviction, or LLM-driven consolidation.
- Runtime migration machinery for the current one-time content migration.
- Writing memory into project-local `AGENTS.md` or `CLAUDE.md` files.
- Replacing context-mode session continuity.

## Architecture

Refactor the extension into modules with one responsibility each:

```text
pi/.pi/agent/extensions/memory-governor/
├── index.ts
├── candidate.ts
├── project-identity.ts
├── memory-store.ts
├── project-memory.ts
├── prompt-memory.ts
├── memory-read-tool.ts
└── *.test.ts
```

Responsibilities:

- `index.ts` registers Pi hooks, `/memory-audit`, and the agent-only tool.
- `candidate.ts` detects, classifies, distills, and rejects memory candidates.
- `project-identity.ts` resolves repository coordinates and safe filenames.
- `memory-store.ts` owns validation, locking, conflict checks, and atomic
  writes.
- `project-memory.ts` maps repository identity to scoped memory and the index.
- `prompt-memory.ts` validates and constructs deterministic prompt content.
- `memory-read-tool.ts` exposes bounded, read-only supplemental access.

The implementation uses Node built-ins and documented Pi extension APIs. It
adds no runtime package dependency.

## Storage Layout

```text
pi/.pi/agent/memory/
├── USER.md
├── WORKFLOWS.md
├── PROJECTS.md
└── projects/
    ├── github.com--owner--dotfiles.md
    ├── github.com--organization--dbt-analytics.md
    └── local--repository--<hash>.md
```

`PROJECTS.md` becomes a compact index and fallback. It contains:

- Storage and safety rules.
- Repository coordinates and their scoped file paths.
- A clearly labeled section for facts that are genuinely not tied to a
  repository.

Each scoped project file contains rules and a `Facts` section. The standard
size budgets remain:

- `USER.md`: 4,000 characters.
- `WORKFLOWS.md`: 4,000 characters.
- Each scoped project file: 5,000 characters.
- `PROJECTS.md`: 5,000 characters, although normal project facts no longer
  accumulate there.

## Repository Identity

Resolve identity in this order:

1. Run `git config --get remote.origin.url` in the active working directory.
2. Normalize HTTPS, SSH URL, and SCP-style remotes to
   `lowercase-host/lowercase-owner/lowercase-repository`.
3. Remove credentials, default SSH port 22, default HTTPS port 443, a trailing
   `.git`, redundant slashes, query strings, and fragments. Preserve a
   non-default port as a hyphenated host suffix.
4. Encode the three normalized segments as
   `host--owner--repository.md`, allowing only lowercase letters, digits,
   periods, underscores, and hyphens.

For repositories without `origin`, resolve Git's common directory so worktrees
share one identity. Hash its canonical real path with SHA-256 and use the first
12 hexadecimal characters in
`local--<sanitized-basename>--<hash>.md`. Outside a Git repository, apply the
same fallback to the canonical current working directory.

The resolver returns structured identity data rather than only a filename:

- Identity kind: `remote` or `local`.
- Canonical key.
- Display name.
- Scoped memory path.
- Diagnostic reason when the local fallback was required.

## Deterministic Prompt Retrieval

Register a `before_agent_start` handler. On every agent run it:

1. Resolves the active repository identity.
2. Reads `USER.md`.
3. Reads `WORKFLOWS.md`.
4. Reads the current repository's scoped file when it exists.
5. Validates structure, content safety, and size budgets.
6. Appends one stable `<durable_memory>` section to the system prompt.

The section includes each source path and full accepted file content. It states
that memory is historical context and must yield to:

1. The current user instruction.
2. Current repository instructions.
3. Verified repository and tool evidence.

Memory is reread for each agent run, so another session's committed update is
visible without restarting Pi. The content is stable between updates and should
remain eligible for provider prompt caching.

A missing scoped project file is not an error. User and workflow memory are
still injected, and diagnostics identify the expected path. No normal retrieval
depends on the model deciding to call a tool.

## Supplemental Agent Tool

Register `memory_read` as an agent-only, read-only tool. Its schema permits:

- User memory.
- Workflow memory.
- Current-project memory.
- A named repository coordinate in `host/owner/repository` form.
- The project-memory index.

The tool resolves only known memory paths under `~/.pi/agent/memory`. It does
not accept arbitrary filesystem paths, `..` segments, absolute paths, or file
URLs. Output includes the resolved source path and obeys the same file and tool
output limits as prompt retrieval.

This is not a user command. Users do not supply its schema arguments. The agent
uses it only for cross-project lookup or diagnostics; ordinary memory is already
present in the prompt.

## Candidate and Write Policy

Preserve the conservative write policy:

- Only an explicit `Remember:` request is eligible for automatic writing.
- Inferred corrections and preferences are advisory candidates.
- Secrets, prompt-injection-like text, transient instructions, unverified
  assumptions, raw questions, task-local details, and duplicates are rejected.
- Accepted entries must be distilled, standalone statements.

Route accepted entries as follows:

- Durable preferences to `USER.md` under `Preferences`.
- Reusable processes to `WORKFLOWS.md` under `Conventions`.
- Repository facts to the current scoped file under `Facts`.
- Genuinely unscoped project facts to the fallback section in `PROJECTS.md`.

Raw inferred candidates no longer appear as user-facing custom messages. A
strong correction must directly address agent behavior with an existing
`you keep`, `you always`, `you forgot`, `you missed`, `you do not`, or
`you don't` pattern, or state an explicit `I prefer` preference. It may be
supplied privately to the same agent run through `before_agent_start` for
evaluation under the memory-management policy. Other first-person negatives,
weak matches, and ordinary task discussion are ignored. The extension shows
user-facing notifications only for actual writes, explicit rejections,
conflicts, and audit results.

The correction about agent-only tool arguments is part of this feature design,
not a durable user preference, and must not be added to `USER.md`.

## Safe Mutation Protocol

All writes use one `mutateMemoryFile()` primitive.

### Locking

- Use an adjacent lock directory acquired with atomic `mkdir`.
- Record process ID, hostname, target path, and acquisition time in the lock.
- Retry with bounded jitter for at most two seconds.
- Treat `EPERM` from a process-liveness check as a live owner.
- Reclaim a lock only when it is older than 30 seconds, belongs to the current
  host, and its recorded process no longer exists.
- If ownership is uncertain, abort rather than breaking the lock.

### Read, validate, and commit

After acquiring the lock:

1. Read the latest target content.
2. Record a SHA-256 content hash.
3. Validate structure and safety.
4. Apply exactly one requested mutation in memory.
5. Reread the target and compare its hash before committing.
6. Abort on any external change.
7. Write a uniquely named temporary file in the target directory.
8. Preserve the existing permission mode, or use `0600` for a new file.
9. Flush and close the temporary file.
10. Atomically rename it over the target.
11. Remove temporary artifacts and release the owned lock in `finally`.

The lock covers the complete read-modify-write window. A rejected addition does
not perform incidental cleanup. Auditing is an explicit mutation with its own
result. `/memory-audit` processes `USER.md`, `WORKFLOWS.md`, `PROJECTS.md`, and
every indexed scoped project file sequentially through the same mutation
primitive. Creating a scoped project file also adds its coordinate to the index
through a separately locked update.

## Validation and Failure Handling

Read and write paths share validation rules.

- A secret or prompt-injection pattern blocks the affected content from prompt
  injection and automatic writing.
- Missing or duplicate required sections block mutation of that file.
- A file above its normal budget remains readable only within the hard total
  prompt limit, emits a warning, and rejects further automatic growth.
- Prompt construction never silently omits or truncates memory.
- If manually edited files exceed the hard total prompt limit, include an
  explicit truncation warning and source path in the prompt.
- Lock timeout, stale-lock uncertainty, and external-edit conflicts abort the
  write and identify the affected file.
- A missing project file does not block user or workflow retrieval.
- A Git lookup failure falls back to local identity and appears in diagnostics.
- `/memory-audit` works without a TUI and reports per-file outcomes.

The hard total prompt limit is 20,000 characters. Normal configured budgets keep
injected memory below this limit.

## One-Time Content Migration

Migrate the existing `PROJECTS.md` sections as tracked Markdown edits:

- `Dotfiles` facts to the scoped Dotfiles file.
- `Snowflake Objects` facts to the scoped `snowflake-objects` file.
- `dbt-analytics` facts to the scoped `dbt-analytics` file.
- `Gametime Data Review Lessons` facts to the scoped `gametime-data` file.

Derive actual filenames with the repository identity algorithm. Each existing
bullet must appear exactly once after migration. `PROJECTS.md` retains only its
rules, index, and unscoped fallback. There is no runtime legacy migrator.

## Testing Strategy

Use Bun tests with temporary directories and injected filesystem and Git-query
boundaries where needed.

### Candidate tests

- Preserve existing explicit-memory, classification, rejection, and duplicate
  behavior.
- Reject task-local first-person statements like the agent-only scope
  clarification.
- Verify raw inferred candidates are not displayed as user-facing messages.
- Verify rejected additions cannot trigger duplicate-cleanup writes.

### Identity tests

- Normalize HTTPS, SSH URL, and SCP-style remotes identically.
- Strip credentials, `.git`, query strings, and fragments.
- Keep worktrees and separate clones on the same remote identity.
- Produce stable, collision-resistant local fallback identities.
- Reject malformed repository coordinates and traversal attempts.

### Store tests

- Acquire and release locks.
- Time out on a live lock.
- Reclaim only a verified dead stale lock.
- Clean locks and temporary files after success and failure.
- Detect external edits by content hash.
- Atomically replace content.
- Preserve two accepted updates from concurrent writers.
- Preserve existing modes and use `0600` for new files.

### Prompt and tool tests

- Inject user, workflow, and current-project memory automatically.
- Reread updated memory on the next agent run.
- Continue when current-project memory is absent.
- Handle malformed, suspicious, and over-budget memory explicitly.
- Enforce the 20,000-character hard total limit without silent omission.
- Limit `memory_read` to approved scopes and known project coordinates.
- Reject absolute paths, traversal, file URLs, and unknown repository keys.

### Integration and migration tests

- Register `input`, `before_agent_start`, `/memory-audit`, and `memory_read`.
- Route explicit project memory to the resolved scoped file.
- Verify every project index entry resolves to an existing file.
- Verify migrated bullets occur exactly once across project memory files.

Add `mise run check-memory` with this exact test command:

```bash
mise exec -- bun test ./pi/.pi/agent/extensions/memory-governor
```

The repository doctor/check workflow invokes `check-memory`. Verification also
includes:

```bash
mise run check-memory
mise run doctor
mise exec -- pi --offline --list-models
```

## Success Criteria

The implementation is complete when:

1. User, workflow, and current-project memory are present in every normal agent
   run without a tool call.
2. Cross-project memory is available through the agent-only `memory_read` tool.
3. Two concurrent Pi sessions cannot silently lose accepted updates.
4. Repository facts cannot collide solely because repositories share a
   basename.
5. Every existing project fact remains present exactly once after migration.
6. Unsafe or malformed memory fails visibly and does not enter the prompt.
7. Memory tests, the repository doctor, Pi startup smoke checks, and diagnostics
   pass.
8. The existing unrelated `settings.json` change remains untouched.

## Risks and Mitigations

- **Prompt growth:** Enforce per-file budgets and a 20,000-character hard total.
  Reliability takes priority over minimizing the stable prompt.
- **Prompt injection from edited memory:** Validate reads as well as writes and
  mark memory as subordinate historical context.
- **Dead locks after crashes:** Use owner metadata and reclaim only verified
  dead stale locks.
- **Incorrect remote normalization:** Cover supported URL forms with
  table-driven tests and use local fallback on failure.
- **Index drift:** Audit that every index path exists; prompt lookup derives the
  current file directly from identity rather than trusting the index.
- **Refactor regression:** Preserve existing public helper behavior with tests
  before moving implementation into focused modules.
