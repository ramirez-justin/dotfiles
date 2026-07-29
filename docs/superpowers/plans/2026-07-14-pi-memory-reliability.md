# Pi Memory Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject validated user, workflow, and scoped repository memory into
normal Pi runs while preventing cooperating Pi sessions from silently losing
memory updates.

**Architecture:** Split the existing memory governor into pure candidate,
repository-identity, storage, project-memory, prompt, and tool modules. Keep
Markdown authoritative, append deterministic memory through
`before_agent_start`, and serialize writes with adjacent directory locks plus
same-directory atomic replacement.

**Tech Stack:** TypeScript, Bun tests, Node.js built-ins, Pi 0.81 extension
APIs, TypeBox, and GNU Stow/mise.

---

## Implementation Clarifications

These points refine the approved design after implementation review:

- Cooperating memory-governor writers are serialized. Detection of arbitrary
  manual edits remains best-effort because POSIX rename has no portable
  compare-and-swap operation.
- Remote identities support nested namespaces rather than assuming exactly one
  owner segment. Canonical coordinates use
  `host[:port]/namespace/.../repository`.
- Non-default ports use a separate filename segment such as
  `host--port-2222--namespace--repository.md` to avoid hostname collisions.
- New files are created with mode `0600`, but Git does not preserve that mode
  across clones. Memory must remain secret-free; permission mode is local
  defense in depth rather than a durable repository guarantee.
- Transient inferred-correction guidance is appended to that agent run's
  system prompt. It is never persisted with `pi.sendMessage()`.

## Preconditions

The primary worktree currently contains unrelated changes to:

```text
pi/.pi/agent/memory/PROJECTS.md
pi/.pi/agent/memory/USER.md
pi/.pi/agent/memory/WORKFLOWS.md
pi/.pi/agent/settings.json
```

Do not stash, reset, overwrite, or include those changes accidentally. Before
starting implementation, either let their owner commit them or obtain explicit
instructions for incorporating them. The migration must operate from the
latest committed memory content, including the `Gametime Notebooks` section if
it has been committed by then.

Because this is a multi-file persistence refactor and the primary worktree is
dirty, execute in an isolated worktree after the precondition is satisfied.

## File Structure

Create or modify these files:

```text
pi/.pi/agent/extensions/memory-governor/
├── index.ts
├── index.test.ts
├── candidate.ts
├── candidate.test.ts
├── project-identity.ts
├── project-identity.test.ts
├── memory-store.ts
├── memory-store.test.ts
├── project-memory.ts
├── project-memory.test.ts
├── prompt-memory.ts
├── prompt-memory.test.ts
├── memory-read-tool.ts
└── memory-read-tool.test.ts

pi/.pi/agent/memory/
├── PROJECTS.md
└── projects/
    ├── github.com--ramirez-justin--dotfiles.md
    ├── github.com--gametimesf--snowflake-objects.md
    ├── github.com--gametimesf--dbt-analytics.md
    └── github.com--gametimesf--gametime-data.md
```

Also modify:

- `pi/.pi/agent/AGENTS.md`
- `mise.toml`

Do not modify `pi/.pi/agent/settings.json`.

## Shared Contracts

Use these types consistently across modules:

```ts
export type MemoryScope =
  | "user"
  | "workflow"
  | "project"
  | "unscoped";

export type MemoryFileKind =
  | "user"
  | "workflow"
  | "project-index"
  | "scoped-project";

export interface MemoryCandidate {
  content: string;
  reason:
    | "explicit-memory"
    | "workflow-rule"
    | "behavioral-correction";
  scope: MemoryScope;
  autoWrite: boolean;
}

export interface RepositoryIdentity {
  kind: "remote" | "local";
  canonicalKey: string;
  coordinate?: string;
  displayName: string;
  filename: string;
  diagnostic?: string;
}

export type MutationResult =
  | { status: "written"; text: string; summary: string }
  | { status: "unchanged"; text: string; summary: string }
  | { status: "rejected"; text: string; reason: string }
  | { status: "conflict"; path: string }
  | { status: "lock-timeout"; path: string }
  | { status: "lock-uncertain"; path: string };
```

## Task 0: Isolate Work and Establish the Baseline

**Files:** None.

- [ ] **Step 1: Verify the primary worktree is ready**

Run in the primary worktree:

```bash
git status --short
```

Expected: no uncommitted memory or settings changes remain. If any listed
precondition file is still modified, stop and ask before proceeding.

- [ ] **Step 2: Create the feature worktree**

Run:

```bash
mkdir -p ~/.config/superpowers/worktrees/dotfiles
git worktree add \
  ~/.config/superpowers/worktrees/dotfiles/feat-pi-memory-reliability \
  -b feat/pi-memory-reliability HEAD
```

Expected: a clean worktree on `feat/pi-memory-reliability`. Worktree creation is
non-destructive and does not modify the primary worktree's files.

- [ ] **Step 3: Record the baseline**

Run in the feature worktree:

```bash
git status --short
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor
mise exec -- bun test ./pi/.pi/agent/extensions
```

Expected: clean status, 15 existing memory-governor tests pass, and all current
extension tests pass. Stop if the baseline fails.

## Task 1: Extract Candidate Policy

**Files:**

- Create: `pi/.pi/agent/extensions/memory-governor/candidate.ts`
- Create: `pi/.pi/agent/extensions/memory-governor/candidate.test.ts`
- Modify later: `pi/.pi/agent/extensions/memory-governor/index.ts`

- [ ] **Step 1: Write failing candidate tests**

Create table-driven tests covering the old accepted behavior and the new false
positive boundary:

```ts
import { describe, expect, test } from "bun:test";
import {
  applyMemoryAddition,
  auditMemoryText,
  detectMemoryCandidate,
  shouldRejectMemory,
} from "./candidate.ts";

describe("candidate detection", () => {
  test("only explicit Remember auto-writes", () => {
    expect(
      detectMemoryCandidate("Remember: Prefer concise answers.")?.autoWrite,
    ).toBe(true);
    expect(
      detectMemoryCandidate("I prefer concise answers.")?.autoWrite,
    ).toBe(false);
  });

  test("ignores agent-only task clarification", () => {
    expect(
      detectMemoryCandidate(
        "I don't use these scope commands right. They are for the agent.",
      ),
    ).toBeUndefined();
  });

  test("recognizes only strong correction forms", () => {
    expect(
      detectMemoryCandidate("You keep forgetting to verify the diff."),
    ).toMatchObject({ reason: "behavioral-correction" });
    expect(
      detectMemoryCandidate("I don't know why this failed."),
    ).toBeUndefined();
  });
});

describe("candidate mutation", () => {
  test("rejected addition has no cleanup side effect", () => {
    const existing = "## Preferences\n\n- Keep this.\n- Keep this.\n";
    const result = applyMemoryAddition({
      content: "For this session only, be verbose.",
      existingText: existing,
      section: "Preferences",
      maxChars: 4_000,
    });
    expect(result.text).toBe(existing);
  });

  test("audit is the explicit duplicate cleanup path", () => {
    const existing = "## Preferences\n\n- Keep this.\n- Keep this.\n";
    expect(auditMemoryText(existing).removedDuplicates).toBe(1);
  });
});
```

Retain equivalent tests for secret-like text, prompt injection, transient
content, questions, task context, unverified assumptions, and duplicates from
`index.test.ts`.

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/candidate.test.ts
```

Expected: failure because `candidate.ts` does not exist.

- [ ] **Step 3: Implement the pure candidate module**

Move normalization, extraction, classification, rejection, addition, and audit
logic from `index.ts`. Export this API:

```ts
export function detectMemoryCandidate(
  text: string,
): MemoryCandidate | undefined;

export function shouldRejectMemory(
  content: string,
  existingText: string,
): string | undefined;

export function applyMemoryAddition(input: {
  content: string;
  existingText: string;
  section: string;
  maxChars: number;
}): {
  changed: boolean;
  text: string;
  summary: string;
};

export function auditMemoryText(text: string): {
  text: string;
  removedDuplicates: number;
};
```

Only `Remember:` sets `autoWrite: true`. Strong inferred candidates are limited
to direct `you keep`, `you always`, `you forgot`, `you missed`, `you do not`,
`you don't`, and explicit `I prefer` forms. Keep the existing secret and
transience guards. Remove `// @ts-nocheck` from moved code and define concrete
input/result types.

- [ ] **Step 4: Verify GREEN and regression safety**

Run:

```bash
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/candidate.test.ts
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/index.test.ts
```

Expected: both test files pass.

- [ ] **Step 5: Commit candidate extraction**

```bash
git add pi/.pi/agent/extensions/memory-governor/candidate.ts \
  pi/.pi/agent/extensions/memory-governor/candidate.test.ts
git commit -m "refactor(memory-governor): extract candidate policy" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

## Task 2: Add Repository Identity Resolution

**Files:**

- Create: `pi/.pi/agent/extensions/memory-governor/project-identity.ts`
- Create: `pi/.pi/agent/extensions/memory-governor/project-identity.test.ts`

- [ ] **Step 1: Write failing identity tests**

Use a fake Git boundary rather than invoking Git in unit tests:

```ts
import { describe, expect, test } from "bun:test";
import {
  normalizeRemoteIdentity,
  resolveRepositoryIdentity,
} from "./project-identity.ts";

const equivalent = [
  "https://github.com/gametimesf/dbt-analytics.git",
  "ssh://git@github.com/gametimesf/dbt-analytics.git",
  "git@github.com:gametimesf/dbt-analytics.git",
];

test("normalizes common remote forms identically", () => {
  const identities = equivalent.map(normalizeRemoteIdentity);
  expect(new Set(identities.map((item) => item?.canonicalKey)).size).toBe(1);
  expect(identities[0]?.filename).toBe(
    "github.com--gametimesf--dbt-analytics.md",
  );
});

test("encodes non-default ports without hostname collision", () => {
  expect(
    normalizeRemoteIdentity("ssh://git@example.com:2222/team/repo.git")
      ?.filename,
  ).toBe("example.com--port-2222--team--repo.md");
});

test("supports nested namespaces", () => {
  expect(
    normalizeRemoteIdentity("https://gitlab.com/group/subgroup/repo.git")
      ?.filename,
  ).toBe("gitlab.com--group--subgroup--repo.md");
});
```

Add tests for stripped credentials, default ports, queries/fragments, malformed
remotes, canonical common-directory fallback, same-basename collision
avoidance, and 12-character SHA-256 suffixes.

- [ ] **Step 2: Run the test to verify RED**

```bash
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/project-identity.test.ts
```

Expected: missing module/export failure.

- [ ] **Step 3: Implement identity resolution**

Use these interfaces:

```ts
export interface GitQuery {
  origin(cwd: string): Promise<string | undefined>;
  commonDir(cwd: string): Promise<string | undefined>;
}

export function normalizeRemoteIdentity(
  remote: string,
): RepositoryIdentity | undefined;

export async function resolveRepositoryIdentity(input: {
  cwd: string;
  memoryProjectsDir: string;
  git: GitQuery;
  realpath(path: string): Promise<string>;
}): Promise<RepositoryIdentity>;
```

Normalize coordinates as
`host[:port]/namespace/.../repository`. Sanitize every path segment and reject
empty, dot, dot-dot, URL, slash-bearing, or control-character segments. Do not
include raw remote URLs in diagnostics.

The production `GitQuery` uses `pi.exec()`:

```ts
const origin = await pi.exec(
  "git",
  ["-C", cwd, "config", "--get", "remote.origin.url"],
  { timeout: 2_000 },
);
const commonDir = await pi.exec(
  "git",
  ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
  { timeout: 2_000 },
);
```

Use a canonical common directory for local Git fallback and canonical `cwd`
outside Git. Hash with `createHash("sha256")` and retain 12 hexadecimal
characters.

- [ ] **Step 4: Verify and commit**

```bash
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/project-identity.test.ts
mise exec -- bun test ./pi/.pi/agent/extensions/memory-governor
git add pi/.pi/agent/extensions/memory-governor/project-identity.*
git commit -m "feat(memory-governor): add repository identity" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

## Task 3: Implement Validated Locked Storage

**Files:**

- Create: `pi/.pi/agent/extensions/memory-governor/memory-store.ts`
- Create: `pi/.pi/agent/extensions/memory-governor/memory-store.test.ts`

- [ ] **Step 1: Write failing validation and lock tests**

Use a temporary directory for each test. Cover:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mutateMemoryFile,
  readValidatedMemory,
} from "./memory-store.ts";

test("concurrent writers preserve both additions", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "memory-store-")), "USER.md");
  await writeFile(
    path,
    "# User Memory\n\n## Rules\n\n- Safe.\n\n## Preferences\n",
  );

  const add = (bullet: string) =>
    mutateMemoryFile({
      path,
      spec: USER_MEMORY_SPEC,
      mutate: (text) => ({
        changed: true,
        text: `${text}\n- ${bullet}\n`,
        summary: `added ${bullet}`,
      }),
    });

  await Promise.all([add("First."), add("Second.")]);
  const final = await readFile(path, "utf8");
  expect(final).toContain("- First.");
  expect(final).toContain("- Second.");
});
```

Add tests for required and duplicate headings, strict UTF-8, unsafe content,
normal-budget warnings, live-lock timeout, dead same-host stale-lock reclaim,
`EPERM`, malformed ownership metadata, external hash conflict, temp cleanup,
mode preservation, and new-file `0600`.

- [ ] **Step 2: Run the test to verify RED**

```bash
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/memory-store.test.ts
```

Expected: missing module/export failure.

- [ ] **Step 3: Implement file specifications and validation**

Export explicit specs:

```ts
export interface MemoryFileSpec {
  kind: MemoryFileKind;
  requiredSections: readonly string[];
  normalMaxChars: number;
}

export const USER_MEMORY_SPEC: MemoryFileSpec = {
  kind: "user",
  requiredSections: ["Rules", "Preferences"],
  normalMaxChars: 4_000,
};

export const WORKFLOW_MEMORY_SPEC: MemoryFileSpec = {
  kind: "workflow",
  requiredSections: ["Rules", "Conventions"],
  normalMaxChars: 4_000,
};

export const PROJECT_INDEX_SPEC: MemoryFileSpec = {
  kind: "project-index",
  requiredSections: ["Rules", "Scoped Projects", "Unscoped Facts"],
  normalMaxChars: 5_000,
};

export const SCOPED_PROJECT_SPEC: MemoryFileSpec = {
  kind: "scoped-project",
  requiredSections: ["Rules", "Facts"],
  normalMaxChars: 5_000,
};
```

`readValidatedMemory()` returns accepted text, warnings, and blocked reasons.
Scan extension-written and manually edited content before prompt or tool output.
Never return suspicious raw text in an error message.

- [ ] **Step 4: Implement lock and mutation protocol**

Use an adjacent `${path}.lock` directory. Its `owner.json` contains:

```ts
interface LockOwner {
  token: string;
  pid: number;
  hostname: string;
  targetPath: string;
  acquiredAt: string;
}
```

Acquire with `mkdir()`, retry with randomized 25–75 ms delay for at most
2,000 ms, and reclaim only a lock older than 30 seconds whose same-host PID is
verified absent. Treat `EPERM`, foreign host, invalid JSON, and uncertain age as
owned.

`mutateMemoryFile()` must:

1. Acquire the lock.
2. Read the latest content and hash it.
3. Validate and call the pure mutation callback.
4. Reread and compare immediately before commit.
5. Write a unique same-directory file with `open(..., "wx", mode)`.
6. `writeFile()`, `sync()`, close, and rename.
7. Remove only temp/lock artifacts owned by its unique token in `finally`.

Document in code that noncooperating editor detection has a narrow unavoidable
race after the final hash check.

- [ ] **Step 5: Verify and commit**

```bash
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/memory-store.test.ts
mise exec -- bun test ./pi/.pi/agent/extensions/memory-governor
git add pi/.pi/agent/extensions/memory-governor/memory-store.*
git commit -m "feat(memory-governor): add safe memory storage" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

## Task 4: Add Scoped Project Memory and Index

**Files:**

- Create: `pi/.pi/agent/extensions/memory-governor/project-memory.ts`
- Create: `pi/.pi/agent/extensions/memory-governor/project-memory.test.ts`

- [ ] **Step 1: Write failing project-memory tests**

Test the Markdown contract rather than exact incidental formatting:

```ts
import { expect, test } from "bun:test";
import {
  createScopedMemoryText,
  parseProjectIndex,
} from "./project-memory.ts";

test("scoped template has required sections", () => {
  const text = createScopedMemoryText("github.com/acme/service");
  expect(text).toContain("## Rules");
  expect(text).toContain("## Facts");
});

test("index rejects duplicate coordinates and paths", () => {
  const text = `## Scoped Projects

- \`github.com/acme/a\` → \`projects/a.md\`
- \`github.com/acme/a\` → \`projects/b.md\`
`;
  expect(() => parseProjectIndex(text)).toThrow(/duplicate coordinate/i);
});
```

Add tests for path containment, direct current-project lookup independent of the
index, safe creation, index update, and sequential audit enumeration.

- [ ] **Step 2: Run the test to verify RED**

```bash
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/project-memory.test.ts
```

Expected: missing module/export failure.

- [ ] **Step 3: Implement scoped memory helpers**

Export:

```ts
export interface ProjectIndexEntry {
  coordinate: string;
  relativePath: string;
}

export function createScopedMemoryText(coordinate: string): string;
export function parseProjectIndex(text: string): ProjectIndexEntry[];
export function renderProjectIndex(
  baseText: string,
  entries: readonly ProjectIndexEntry[],
): string;
export async function ensureScopedProjectMemory(input: {
  root: string;
  identity: RepositoryIdentity;
}): Promise<{ path: string; created: boolean }>;
export async function resolveIndexedProjectMemory(input: {
  root: string;
  coordinate: string;
}): Promise<string | undefined>;
export async function listAuditTargets(root: string): Promise<string[]>;
```

Accept only index paths whose relative form is `projects/` followed by the
filename returned by `RepositoryIdentity`. Resolve each path and check
containment under the canonical projects directory. Create the scoped file
first, then add the separately locked index entry. Prompt lookup derives the
current file from identity and does not depend on index availability.

- [ ] **Step 4: Verify and commit**

```bash
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/project-memory.test.ts
mise exec -- bun test ./pi/.pi/agent/extensions/memory-governor
git add pi/.pi/agent/extensions/memory-governor/project-memory.*
git commit -m "feat(memory-governor): add scoped project memory" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

## Task 5: Build Deterministic Prompt Memory

**Files:**

- Create: `pi/.pi/agent/extensions/memory-governor/prompt-memory.ts`
- Create: `pi/.pi/agent/extensions/memory-governor/prompt-memory.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Use temporary files and assert source ordering and explicit diagnostics:

```ts
import { expect, test } from "bun:test";
import { buildPromptMemory } from "./prompt-memory.ts";

test("injects normal memory in deterministic order", async () => {
  const result = await buildPromptMemory(fixtureInput);
  expect(result.text.indexOf("USER.md")).toBeLessThan(
    result.text.indexOf("WORKFLOWS.md"),
  );
  expect(result.text.indexOf("WORKFLOWS.md")).toBeLessThan(
    result.text.indexOf("projects/"),
  );
  expect(result.text).toContain("<durable_memory>");
  expect(result.text).toContain("</durable_memory>");
});

test("rereads changes on each build", async () => {
  const before = await buildPromptMemory(fixtureInput);
  await fixtureInput.writeUser("- Prefer newly written behavior.");
  const after = await buildPromptMemory(fixtureInput);
  expect(after.text).not.toBe(before.text);
  expect(after.text).toContain("Prefer newly written behavior.");
});
```

Add cases for missing project memory, unsafe and malformed source omission,
normal-budget warnings, hard-total overflow diagnostics, and byte-identical
unchanged output.

- [ ] **Step 2: Run the test to verify RED**

```bash
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/prompt-memory.test.ts
```

Expected: missing module/export failure.

- [ ] **Step 3: Implement prompt construction**

Export:

```ts
export const HARD_PROMPT_MEMORY_CHARS = 20_000;

export async function buildPromptMemory(input: {
  memoryRoot: string;
  identity: RepositoryIdentity;
  advisoryCandidate?: MemoryCandidate;
}): Promise<{
  text: string;
  warnings: string[];
}>;

export function appendDurableMemory(
  systemPrompt: string,
  memoryText: string,
): string;
```

Build one `<durable_memory>` block in fixed user, workflow, project order.
Include source paths relative to the memory root. State this precedence
exactly: current user instruction, current repository instructions, verified
repository and tool evidence, then durable memory.

Do not inject `PROJECTS.md` normally. Exclude unsafe raw content and include
only a source path plus safe reason. If the hard limit is reached, include an
explicit source-specific omission/truncation diagnostic; never fail silently.
Append a strong advisory candidate only to this transient prompt result.

- [ ] **Step 4: Verify and commit**

```bash
mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/prompt-memory.test.ts
mise exec -- bun test ./pi/.pi/agent/extensions/memory-governor
git add pi/.pi/agent/extensions/memory-governor/prompt-memory.*
git commit -m "feat(memory-governor): build deterministic prompt memory" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

## Task 6: Add the Agent-Only `memory_read` Tool

**Files:**

- Create: `pi/.pi/agent/extensions/memory-governor/memory-read-tool.ts`
- Create: `pi/.pi/agent/extensions/memory-governor/memory-read-tool.test.ts`

- [ ] **Step 1: Write failing tool tests**

Test tool execution through a factory so registration remains an integration
concern:

```ts
import { expect, test } from "bun:test";
import { createMemoryReader } from "./memory-read-tool.ts";

test("requires coordinate only for named project reads", async () => {
  const reader = createMemoryReader(fixtureDeps);
  await expect(reader({ scope: "project" })).rejects.toThrow(/coordinate/i);
  await expect(
    reader({ scope: "user", coordinate: "github.com/acme/repo" }),
  ).rejects.toThrow(/only valid for project/i);
});

test("rejects traversal and arbitrary paths", async () => {
  const reader = createMemoryReader(fixtureDeps);
  for (const coordinate of ["../USER.md", "/tmp/x", "file:///tmp/x"]) {
    await expect(reader({ scope: "project", coordinate })).rejects.toThrow();
  }
});
```

Add tests for user, workflow, current project, named indexed project, index,
missing current project, unknown coordinate, unsafe memory, and bounded output.

- [ ] **Step 2: Run the test to verify RED**

```bash
NODE_PATH="$HOME/.pi/agent/npm/node_modules" \
  mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/memory-read-tool.test.ts
```

Expected: missing module/export failure. `NODE_PATH` exposes Pi's installed
runtime copies of `typebox` and `@earendil-works/pi-ai` to Bun.

- [ ] **Step 3: Implement reader and tool definition**

Import `Type` from `typebox` and `StringEnum` from `@earendil-works/pi-ai`:

```ts
export const memoryReadParameters = Type.Object({
  scope: StringEnum(
    ["user", "workflow", "current_project", "project", "index"] as const,
  ),
  coordinate: Type.Optional(Type.String()),
});
```

Export a pure `createMemoryReader(deps)` and a `createMemoryReadTool(deps)`
wrapper. Throw on invalid parameters so Pi records an error result. Return
validated text and relative source path. Use a 5,000-character output cap with
an explicit truncation marker.

Do not register a slash command or expect the user to provide tool arguments.

- [ ] **Step 4: Verify and commit**

```bash
NODE_PATH="$HOME/.pi/agent/npm/node_modules" \
  mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/memory-read-tool.test.ts
NODE_PATH="$HOME/.pi/agent/npm/node_modules" \
  mise exec -- bun test ./pi/.pi/agent/extensions/memory-governor
git add pi/.pi/agent/extensions/memory-governor/memory-read-tool.*
git commit -m "feat(memory-governor): add scoped memory reader" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

## Task 7: Rewire the Pi Extension

**Files:**

- Modify: `pi/.pi/agent/extensions/memory-governor/index.ts`
- Modify: `pi/.pi/agent/extensions/memory-governor/index.test.ts`
- Modify: `pi/.pi/agent/AGENTS.md`

- [ ] **Step 1: Replace tests with integration-focused failures**

Create a fake `ExtensionAPI` that captures event handlers, commands, tools,
notifications, and `sendMessage` calls. Test:

```ts
test("registers the reliable memory lifecycle", () => {
  const harness = createExtensionHarness();
  createMemoryGovernor(harness.pi, harness.deps);
  expect(harness.events.has("input")).toBe(true);
  expect(harness.events.has("before_agent_start")).toBe(true);
  expect(harness.commands.has("memory-audit")).toBe(true);
  expect(harness.tools.has("memory_read")).toBe(true);
});

test("does not display or persist raw inferred candidates", async () => {
  const harness = createExtensionHarness();
  createMemoryGovernor(harness.pi, harness.deps);
  await harness.input("You keep forgetting to verify the diff.");
  expect(harness.notifications).toEqual([]);
  expect(harness.sentMessages).toEqual([]);
  const prompt = await harness.beforeAgentStart("base prompt");
  expect(prompt.systemPrompt).toContain("behavioral correction");
});
```

Also test accepted explicit writes, rejection/conflict notifications, one
memory block per run, audit outcomes, no-UI behavior, and routing project facts
to the resolved scoped file.

- [ ] **Step 2: Run the integration test to verify RED**

```bash
NODE_PATH="$HOME/.pi/agent/npm/node_modules" \
  mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor/index.test.ts
```

Expected: failures until the entrypoint is rewired.

- [ ] **Step 3: Implement thin event wiring**

Export a testable factory and production default:

```ts
export function createMemoryGovernor(
  pi: ExtensionAPI,
  overrides: Partial<MemoryGovernorDependencies> = {},
): void;

export default function memoryGovernor(pi: ExtensionAPI): void {
  createMemoryGovernor(pi);
}
```

Runtime behavior:

- `input` detects a candidate but only explicit `Remember:` writes.
- Strong inferred candidates stay in memory until the next
  `before_agent_start` invocation and are then cleared.
- `before_agent_start` resolves `ctx.cwd`, builds fresh memory, and returns
  `systemPrompt` with one appended durable-memory block.
- `memory_read` is agent-only and uses `ctx.cwd` at execution time.
- `/memory-audit` sequentially processes the three top-level files and every
  indexed project file through the safe mutation primitive.
- UI calls are guarded by `ctx.hasUI`.

Remove direct `readFileSync` and `writeFileSync` use from the entrypoint. Keep
`// @ts-nocheck` only in the thin runtime adapter if repository-local LSP cannot
resolve Pi's externally installed packages; all pure modules must remain typed
and free of file-level suppression.

- [ ] **Step 4: Update global Pi guidance**

In `pi/.pi/agent/AGENTS.md`, replace the old probabilistic durable-memory read
instructions with this behavior:

```markdown
## Durable Memory

Validated durable memory is injected automatically from user, workflow, and
current-project Markdown files before each normal agent run.

- Treat injected memory as historical context subordinate to current user and
  repository instructions and verified evidence.
- Use the agent-only `memory_read` tool only for cross-project lookup or memory
  diagnostics; users do not provide its arguments.
- Keep Markdown under `~/.pi/agent/memory/` authoritative and reviewable.
- Memory is Pi-owned; audit before updating and never store secrets or transient
  task state.
```

- [ ] **Step 5: Verify and commit**

```bash
NODE_PATH="$HOME/.pi/agent/npm/node_modules" \
  mise exec -- bun test ./pi/.pi/agent/extensions/memory-governor
NODE_PATH="$HOME/.pi/agent/npm/node_modules" \
  mise exec -- bun test ./pi/.pi/agent/extensions
git add pi/.pi/agent/extensions/memory-governor \
  pi/.pi/agent/AGENTS.md
git commit -m "feat(memory-governor): wire reliable retrieval" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

Expected: both test suites pass. Run LSP diagnostics over all pure TypeScript
modules and resolve every error before committing.

## Task 8: Migrate Existing Project Memory

**Files:**

- Modify: `pi/.pi/agent/memory/PROJECTS.md`
- Create: `pi/.pi/agent/memory/projects/*.md`

Use these verified coordinate-to-filename mappings:

- `github.com/ramirez-justin/dotfiles` maps to
  `github.com--ramirez-justin--dotfiles.md`.
- `github.com/gametimesf/snowflake-objects` maps to
  `github.com--gametimesf--snowflake-objects.md`.
- `github.com/gametimesf/dbt-analytics` maps to
  `github.com--gametimesf--dbt-analytics.md`.
- `github.com/gametimesf/gametime-data` maps to
  `github.com--gametimesf--gametime-data.md`.

- [ ] **Step 1: Capture complete pre-migration section bodies**

Before editing, run this exact script. It preserves wrapped bullet lines rather
than comparing only their first lines:

```bash
python3 - <<'PY'
from pathlib import Path
import json
import re

path = Path('pi/.pi/agent/memory/PROJECTS.md')
text = path.read_text()
sections = {
    name: body.strip()
    for name, body in re.findall(
        r'^## ([^\n]+)\n(.*?)(?=^## |\Z)',
        text,
        flags=re.MULTILINE | re.DOTALL,
    )
}
required = {
    'Rules',
    'Dotfiles',
    'Snowflake Objects',
    'dbt-analytics',
    'Gametime Data Review Lessons',
}
missing = required - sections.keys()
assert not missing, f'missing legacy sections: {sorted(missing)}'
selected = {
    name: sections[name]
    for name in [
        'Rules',
        'Dotfiles',
        'Snowflake Objects',
        'dbt-analytics',
        'Gametime Notebooks',
        'Gametime Data Review Lessons',
    ]
    if name in sections
}
Path('/tmp/pi-memory-project-sections.json').write_text(
    json.dumps(selected, indent=2, sort_keys=True) + '\n'
)
print(f'captured {len(selected) - 1} project sections')
PY
```

Expected: at least four project sections are captured.

- [ ] **Step 2: Write failing structure tests**

Add general migration assertions to `project-memory.test.ts`:

```ts
test("tracked index resolves every scoped project file", async () => {
  const entries = parseProjectIndex(await readTrackedProjectIndex());
  for (const entry of entries) {
    expect(await fileExists(resolveMemoryPath(entry.relativePath))).toBe(true);
  }
});
```

Run the test before creating files. Expected: failure because the compact index
and scoped files do not exist.

- [ ] **Step 3: Generate scoped files and the compact index**

Run this deterministic one-time migration script:

```bash
python3 - <<'PY'
from pathlib import Path
import json

root = Path('pi/.pi/agent/memory')
projects = root / 'projects'
projects.mkdir(exist_ok=True)
sections = json.loads(
    Path('/tmp/pi-memory-project-sections.json').read_text()
)

mappings = [
    (
        'Dotfiles',
        'github.com/ramirez-justin/dotfiles',
        'github.com--ramirez-justin--dotfiles.md',
        ['Dotfiles'],
    ),
    (
        'Snowflake Objects',
        'github.com/gametimesf/snowflake-objects',
        'github.com--gametimesf--snowflake-objects.md',
        ['Snowflake Objects'],
    ),
    (
        'dbt analytics',
        'github.com/gametimesf/dbt-analytics',
        'github.com--gametimesf--dbt-analytics.md',
        ['dbt-analytics'],
    ),
    (
        'Gametime Data',
        'github.com/gametimesf/gametime-data',
        'github.com--gametimesf--gametime-data.md',
        [
            'Gametime Notebooks',
            'Gametime Data Review Lessons',
        ],
    ),
]

rules = '''- Do not store secrets, credentials, transient state, or unverified
  guesses.
- Keep facts stable, actionable, and specific to this repository.
- Audit existing facts before adding or changing entries.'''

index_lines = []
for display, coordinate, filename, source_names in mappings:
    facts = '\n\n'.join(
        sections[name]
        for name in source_names
        if name in sections
    )
    assert facts, f'no facts found for {coordinate}'
    text = (
        f'# Project Memory: {display}\n\n'
        f'Stable facts for `{coordinate}`.\n\n'
        f'## Rules\n\n{rules}\n\n'
        f'## Facts\n\n{facts}\n'
    )
    (projects / filename).write_text(text)
    index_lines.extend([
        f'- `{coordinate}` →',
        f'  `projects/{filename}`',
    ])

index = (
    '# Project Memory\n\n'
    'Repository-scoped memory index and unscoped fallback.\n\n'
    f"## Rules\n\n{sections['Rules']}\n\n"
    '## Scoped Projects\n\n'
    + '\n'.join(index_lines)
    + '\n\n## Unscoped Facts\n'
)
(root / 'PROJECTS.md').write_text(index)
PY
```

Expected: four scoped files exist and `PROJECTS.md` contains only the required
index sections.

- [ ] **Step 4: Verify every captured section moved exactly once**

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import json

root = Path('pi/.pi/agent/memory')
sections = json.loads(
    Path('/tmp/pi-memory-project-sections.json').read_text()
)
combined = '\n'.join(
    path.read_text()
    for path in sorted((root / 'projects').glob('*.md'))
)
for name, body in sections.items():
    if name == 'Rules':
        continue
    count = combined.count(body)
    assert count == 1, f'{name}: expected once, found {count}'
for legacy in [
    '## Dotfiles',
    '## Snowflake Objects',
    '## dbt-analytics',
    '## Gametime Notebooks',
    '## Gametime Data Review Lessons',
]:
    assert legacy not in (root / 'PROJECTS.md').read_text()
print('all captured project sections migrated exactly once')
PY
```

Expected: prints the success message and exits zero.

- [ ] **Step 5: Run memory tests and commit**

```bash
NODE_PATH="$HOME/.pi/agent/npm/node_modules" \
  mise exec -- bun test ./pi/.pi/agent/extensions/memory-governor
git diff --check
git add pi/.pi/agent/memory/PROJECTS.md \
  pi/.pi/agent/memory/projects \
  pi/.pi/agent/extensions/memory-governor/project-memory.test.ts
git commit -m "feat(memory): migrate facts to scoped files" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

## Task 9: Add Repeatable Verification

**Files:**

- Modify: `mise.toml`

- [ ] **Step 1: Verify the task does not exist**

```bash
mise run check-memory
```

Expected: failure because `check-memory` is not defined.

- [ ] **Step 2: Add the memory test task**

Add:

```toml
[tasks.check-memory]
description = "Run Pi memory-governor tests"
run = """
NODE_PATH="$HOME/.pi/agent/npm/node_modules" \
  mise exec -- bun test \
  ./pi/.pi/agent/extensions/memory-governor
"""
```

In `[tasks.doctor]`, add this check before the offline Pi startup check:

```sh
check "Pi memory governor" mise run check-memory
```

- [ ] **Step 3: Validate TOML and run verification**

```bash
python3 - <<'PY'
import tomllib
with open('mise.toml', 'rb') as handle:
    tomllib.load(handle)
print('mise.toml valid')
PY
mise run check-memory
mise run doctor
mise exec -- pi --offline --list-models
```

Expected: TOML parses and all three commands exit zero.

- [ ] **Step 4: Commit verification automation**

```bash
git add mise.toml
git commit -m "chore(mise): verify Pi memory reliability" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

## Task 10: Review and Verify the Completed Implementation

**Files:** None unless findings require fixes.

- [ ] **Step 1: Run proactive diagnostics**

Run Pi/LSP diagnostics on every changed TypeScript and Markdown file before
running broader checks. Resolve all blocking findings.

- [ ] **Step 2: Run fresh evidence**

```bash
mise run check-memory
NODE_PATH="$HOME/.pi/agent/npm/node_modules" \
  mise exec -- bun test ./pi/.pi/agent/extensions
mise run doctor
mise exec -- pi --offline --list-models
git diff --check
git status --short
```

Expected: all commands pass. Status contains no unrelated file, especially
`pi/.pi/agent/settings.json`.

- [ ] **Step 3: Review the actual diff**

Confirm:

- No SQLite, transcript index, background model call, or new dependency exists.
- Normal prompt retrieval does not depend on `memory_read`.
- `memory_read` is agent-only and accepts no filesystem path.
- Memory writes go only through the locked mutation primitive.
- Project identity never logs raw credential-bearing remote URLs.
- The four project coordinate mappings are exact.
- All migrated bullets occur once.

- [ ] **Step 4: Obtain independent review**

Use one reviewer for correctness and one verifier for fresh command evidence.
Fix validated findings before proceeding. Do not allow either agent to modify
the implementation worktree.

## Task 11: Remove Temporary Design and Plan Documents

**Files:**

- Delete:
  `docs/superpowers/specs/2026-07-14-pi-memory-reliability-design.md`
- Delete:
  `docs/superpowers/plans/2026-07-14-pi-memory-reliability.md`

Perform this only after Task 10 passes and before opening or finalizing a PR.

- [ ] **Step 1: Remove only the temporary artifacts**

```bash
git rm -- \
  docs/superpowers/specs/2026-07-14-pi-memory-reliability-design.md \
  docs/superpowers/plans/2026-07-14-pi-memory-reliability.md
```

Expected: exactly those two tracked documents are staged for deletion.

- [ ] **Step 2: Verify cleanup and preserve unrelated files**

```bash
test ! -e \
  docs/superpowers/specs/2026-07-14-pi-memory-reliability-design.md
test ! -e \
  docs/superpowers/plans/2026-07-14-pi-memory-reliability.md
if git diff --name-only HEAD | grep -Fx \
  'pi/.pi/agent/settings.json'
then
  echo 'unexpected settings.json change' >&2
  exit 1
fi
git diff --check
```

Expected: both files are absent, `settings.json` is unchanged, and the diff is
clean.

- [ ] **Step 3: Commit temporary-document cleanup**

```bash
git commit -m "chore(docs): remove temporary memory artifacts" \
  -m "Co-Authored-By: Pi <noreply@pi.dev>"
```

- [ ] **Step 4: Run final post-cleanup status check**

```bash
git status --short
git log --oneline --decorate -12
```

Expected: clean feature worktree and the focused implementation commits are
visible. Do not merge or delete the worktree without explicit user approval.
