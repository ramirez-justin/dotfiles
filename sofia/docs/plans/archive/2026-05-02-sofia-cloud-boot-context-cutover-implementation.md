# SOFIA Cloud Boot Context Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi agent boot context come from SOFIA Cloud only, with a cloud `get_boot_context` tool/HTTP endpoint and no local Obsidian/SOFIA-vault boot fallback.

**Architecture:** Add a deterministic cloud boot-context compiler over active durable memories plus `compiled_artifacts`, expose it through both MCP and a simple authenticated HTTP endpoint, then update the Pi SOFIA extension to fetch/inject that cloud content at session start. Keep the first compiler compact and boring: shared + requested context active memories, grouped by memory type, persisted as `boot_context.md`.

**Tech Stack:** Supabase Edge Functions on Deno, Hono, MCP SDK, Supabase JS, Zod, Pi TypeScript extension, mise tasks.

---

## Scope choices locked by this plan

- `personal` and `work` boot contexts include active `shared` memories plus active memories for the requested context.
- `shared` boot context includes only active `shared` memories.
- First compiler reads latest `compiled_artifacts` if present; if absent or `force_refresh=true`, it compiles from memories and upserts `boot_context.md`.
- Initial boot artifact budget is `12_000` characters. Truncate by memory order with an explicit truncation note.
- Cloud failure does **not** fall back to local `_agent/` files. Pi injects a visible diagnostic block.
- Local pre-compact/session-end hooks can remain for now; local session-start boot hook is removed.

## File structure

- Modify `sofia/cloud/supabase/functions/sofia-core/classifier.ts` — normalize verbose `recommended_action` phrases like `Promote to durable memory.`.
- Modify `sofia/cloud/supabase/functions/sofia-core/classifier_test.ts` — regression tests for action normalization.
- Create `sofia/cloud/supabase/functions/sofia-core/boot_context.ts` — compile/load/upsert boot-context artifacts and render markdown.
- Create `sofia/cloud/supabase/functions/sofia-core/boot_context_test.ts` — unit tests with fake Supabase client.
- Modify `sofia/cloud/supabase/functions/sofia-core/types.ts` — boot-context request/response types.
- Modify `sofia/cloud/supabase/functions/sofia-core/http.ts` — helper for `/boot-context` path and context validation.
- Modify `sofia/cloud/supabase/functions/sofia-core/http_test.ts` — tests for helper behavior.
- Modify `sofia/cloud/supabase/functions/sofia-core/index.ts` — register MCP `get_boot_context`; route HTTP `GET /boot-context` before MCP health response.
- Modify `pi/.pi/agent/env.zsh` — add `SOFIA_CLOUD_URL` default for Pi extension fetches.
- Modify `pi/.pi/agent/extensions/sofia.ts` — remove local session-start hook and fetch cloud boot context.
- Optionally modify `sofia/cloud/README.md` — document the boot-context endpoint after live verification.

---

## Task 1: Fix classifier `recommended_action` phrase normalization

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/classifier_test.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/classifier.ts`

- [ ] **Step 1: Add failing regression tests**

Append these tests to `sofia/cloud/supabase/functions/sofia-core/classifier_test.ts`:

```ts
Deno.test(
  "parseClassifierResponse normalizes verbose promote recommendation",
  () => {
    const parsed = parseClassifierResponse(
      JSON.stringify({
        candidates: [
          {
            candidate_type: "decision",
            candidate_text:
              "SOFIA Cloud should provide boot context directly to Pi.",
            title: "Use SOFIA Cloud boot context",
            worthiness_score: 0.91,
            confidence: 0.9,
            risk_level: "low",
            recommended_action: "Promote to durable memory.",
            reasoning: "Explicit architecture decision.",
            entities: [],
            metadata: {},
          },
        ],
      }),
    );

    assert.equal(parsed[0].recommended_action, "auto_promote");
  },
);

Deno.test(
  "parseClassifierResponse normalizes review/archive/reject phrases",
  () => {
    const actions = [
      ["Needs review by Justin", "review"],
      ["Archive this low value note", "archive"],
      ["Discard / reject", "reject"],
    ] as const;

    for (const [rawAction, expected] of actions) {
      const parsed = parseClassifierResponse(
        JSON.stringify({
          candidates: [
            {
              candidate_type: "fact",
              candidate_text: `Action should normalize: ${rawAction}`,
              title: "Normalize action",
              worthiness_score: 0.75,
              confidence: 0.8,
              risk_level: "low",
              recommended_action: rawAction,
              reasoning: "Parser hardening test.",
              entities: [],
              metadata: {},
            },
          ],
        }),
      );

      assert.equal(parsed[0].recommended_action, expected);
    }
  },
);
```

- [ ] **Step 2: Run classifier tests and verify failure**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test --allow-env --allow-net=api.openrouter.ai classifier_test.ts
```

Expected before implementation: the `Promote to durable memory.` test fails with `invalid classifier response` or `recommended_action` not normalized.

- [ ] **Step 3: Implement minimal normalization**

Replace `normalizeRecommendedAction()` in `sofia/cloud/supabase/functions/sofia-core/classifier.ts` with:

```ts
function normalizeRecommendedAction(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value
    .toLowerCase()
    .trim()
    .replaceAll(/[\s-]+/g, "_")
    .replaceAll(/[^a-z_]/g, "");

  if (normalized === "auto_promote") return "auto_promote";
  if (
    normalized.includes("promote") ||
    normalized.includes("remember") ||
    normalized.includes("save")
  ) {
    return "auto_promote";
  }
  if (
    normalized.includes("review") ||
    normalized.includes("ask_user") ||
    normalized.includes("needs_review")
  ) {
    return "review";
  }
  if (normalized.includes("archive") || normalized.includes("ignore")) {
    return "archive";
  }
  if (normalized.includes("reject") || normalized.includes("discard")) {
    return "reject";
  }
  return value;
}
```

- [ ] **Step 4: Run classifier tests and verify pass**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test --allow-env --allow-net=api.openrouter.ai classifier_test.ts
```

Expected: all classifier tests pass.

- [ ] **Step 5: Commit**

```bash
git add sofia/cloud/supabase/functions/sofia-core/classifier.ts \
  sofia/cloud/supabase/functions/sofia-core/classifier_test.ts
git commit -m "sofia-cloud: normalize classifier action phrases"
```

---

## Task 2: Add boot-context types and compiler module

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/types.ts`
- Create: `sofia/cloud/supabase/functions/sofia-core/boot_context.ts`
- Create: `sofia/cloud/supabase/functions/sofia-core/boot_context_test.ts`

- [ ] **Step 1: Add boot-context types**

Append to `sofia/cloud/supabase/functions/sofia-core/types.ts`:

```ts
export type BootContextRequest = {
  context: SofiaContext;
  force_refresh?: boolean;
};

export type BootContextResponse = {
  context: SofiaContext;
  content: string;
  generated_at: string;
  artifact_id: string | null;
  source: "compiled_artifacts" | "compiled_from_memories";
};
```

- [ ] **Step 2: Write failing compiler tests**

Create `sofia/cloud/supabase/functions/sofia-core/boot_context_test.ts`:

```ts
import assert from "node:assert/strict";
import { compileBootContext } from "./boot_context.ts";

type Call = { table: string; operation: string; payload?: unknown };

type FakeState = {
  artifact?: Record<string, unknown> | null;
  memories?: Record<string, unknown>[];
};

function fakeSupabase(state: FakeState) {
  const calls: Call[] = [];
  const client = {
    calls,
    from(table: string) {
      let operation = "select";
      const query = {
        select(_columns?: string) {
          operation = "select";
          return query;
        },
        eq(_column: string, _value: unknown) {
          return query;
        },
        in(_column: string, _value: unknown[]) {
          return query;
        },
        order(_column: string, _options?: unknown) {
          return query;
        },
        limit(_value: number) {
          return query;
        },
        upsert(payload: unknown, _options?: unknown) {
          operation = "upsert";
          calls.push({ table, operation, payload });
          return query;
        },
        async maybeSingle() {
          return { data: state.artifact ?? null, error: null };
        },
        async single() {
          return {
            data: {
              id: "artifact-new",
              generated_at: "2026-05-02T00:00:00.000Z",
            },
            error: null,
          };
        },
        then(resolve: (value: { data: unknown; error: null }) => void) {
          resolve({ data: state.memories ?? [], error: null });
        },
      };
      return query;
    },
  };
  return client;
}

Deno.test(
  "compileBootContext returns existing artifact unless forced",
  async () => {
    const client = fakeSupabase({
      artifact: {
        id: "artifact-1",
        content:
          "# SOFIA — your second brain context (context: personal)\nExisting",
        generated_at: "2026-05-01T12:00:00.000Z",
      },
    });

    const result = await compileBootContext(client as never, {
      context: "personal",
    });

    assert.equal(result.artifact_id, "artifact-1");
    assert.equal(result.source, "compiled_artifacts");
    assert.equal(result.content.includes("Existing"), true);
    assert.deepEqual(client.calls, []);
  },
);

Deno.test(
  "compileBootContext compiles shared plus requested context memories",
  async () => {
    const client = fakeSupabase({
      artifact: null,
      memories: [
        {
          id: "m-shared",
          context: "shared",
          memory_type: "operating_rule",
          title: "Do not reveal secrets",
          body: "Never copy secrets into persistent files.",
          confidence: 0.98,
          created_at: "2026-05-01T10:00:00Z",
        },
        {
          id: "m-personal",
          context: "personal",
          memory_type: "project_context",
          title: "New home purchase",
          body: "Closing is planned for 2026-05-15.",
          confidence: 0.95,
          created_at: "2026-05-01T11:00:00Z",
        },
      ],
    });

    const result = await compileBootContext(client as never, {
      context: "personal",
      force_refresh: true,
    });

    assert.equal(result.context, "personal");
    assert.equal(result.source, "compiled_from_memories");
    assert.match(
      result.content,
      /^# SOFIA — your second brain context \(context: personal\)/,
    );
    assert.match(result.content, /## Shared Memory/);
    assert.match(result.content, /Do not reveal secrets/);
    assert.match(result.content, /## Personal Memory/);
    assert.match(result.content, /New home purchase/);
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0].table, "compiled_artifacts");
    assert.equal(client.calls[0].operation, "upsert");
  },
);
```

- [ ] **Step 3: Run tests and verify module missing failure**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test --allow-env --allow-net=api.openrouter.ai boot_context_test.ts
```

Expected: fail because `./boot_context.ts` does not exist.

- [ ] **Step 4: Implement compiler module**

Create `sofia/cloud/supabase/functions/sofia-core/boot_context.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BootContextRequest,
  BootContextResponse,
  SofiaContext,
} from "./types.ts";

const BOOT_ARTIFACT_NAME = "boot_context.md";
const BOOT_CONTEXT_MAX_CHARS = 12_000;

type MemoryRow = {
  id: string;
  context: SofiaContext;
  memory_type: string;
  title: string;
  body: string;
  confidence?: number;
  created_at?: string;
};

export async function compileBootContext(
  supabase: SupabaseClient,
  request: BootContextRequest,
): Promise<BootContextResponse> {
  if (!request.force_refresh) {
    const existing = await loadBootArtifact(supabase, request.context);
    if (existing) return existing;
  }

  const contexts = contextsForBoot(request.context);
  const memories = await loadActiveMemories(supabase, contexts);
  const content = renderBootContext(request.context, memories);
  return await upsertBootArtifact(supabase, request.context, content, contexts);
}

async function loadBootArtifact(
  supabase: SupabaseClient,
  context: SofiaContext,
): Promise<BootContextResponse | null> {
  const { data, error } = await supabase
    .from("compiled_artifacts")
    .select("id, content, generated_at")
    .eq("artifact_name", BOOT_ARTIFACT_NAME)
    .eq("context", context)
    .maybeSingle();

  if (error)
    throw new Error(`load boot context artifact failed: ${error.message}`);
  if (!data) return null;
  return {
    context,
    content: data.content as string,
    generated_at: data.generated_at as string,
    artifact_id: data.id as string,
    source: "compiled_artifacts",
  };
}

async function loadActiveMemories(
  supabase: SupabaseClient,
  contexts: SofiaContext[],
): Promise<MemoryRow[]> {
  const { data, error } = await supabase
    .from("memories")
    .select("id, context, memory_type, title, body, confidence, created_at")
    .in("context", contexts)
    .eq("status", "active")
    .order("context", { ascending: false })
    .order("memory_type", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) throw new Error(`load boot memories failed: ${error.message}`);
  return (data ?? []) as MemoryRow[];
}

async function upsertBootArtifact(
  supabase: SupabaseClient,
  context: SofiaContext,
  content: string,
  contexts: SofiaContext[],
): Promise<BootContextResponse> {
  const { data, error } = await supabase
    .from("compiled_artifacts")
    .upsert(
      {
        artifact_name: BOOT_ARTIFACT_NAME,
        context,
        content,
        content_type: "text/markdown",
        source_query: {
          table: "memories",
          contexts,
          status: "active",
          limit: 80,
        },
        metadata: {
          compiler: "sofia-core/compileBootContext",
          max_chars: BOOT_CONTEXT_MAX_CHARS,
        },
        generated_at: new Date().toISOString(),
      },
      { onConflict: "artifact_name,context" },
    )
    .select("id, generated_at")
    .single();

  if (error)
    throw new Error(`upsert boot context artifact failed: ${error.message}`);
  return {
    context,
    content,
    generated_at: data.generated_at as string,
    artifact_id: data.id as string,
    source: "compiled_from_memories",
  };
}

function contextsForBoot(context: SofiaContext): SofiaContext[] {
  return context === "shared" ? ["shared"] : ["shared", context];
}

function renderBootContext(
  context: SofiaContext,
  memories: MemoryRow[],
): string {
  const shared = memories.filter((memory) => memory.context === "shared");
  const contextual = memories.filter((memory) => memory.context === context);
  const sections = [
    `# SOFIA — your second brain context (context: ${context})`,
    "",
    "> Source: SOFIA Cloud compiled boot context. Postgres is canonical; Obsidian/Markdown is a generated human view.",
    "",
    renderSection("Shared Memory", shared),
  ];
  if (context !== "shared") {
    sections.push(renderSection(`${capitalize(context)} Memory`, contextual));
  }
  sections.push(
    "## Operating Rule",
    "",
    "- Do not use local Obsidian/SOFIA vault files as boot-memory fallback. If cloud context is missing, surface the failure.",
  );

  const rendered = sections.join("\n").trimEnd();
  if (rendered.length <= BOOT_CONTEXT_MAX_CHARS) return rendered;
  return `${rendered.slice(0, BOOT_CONTEXT_MAX_CHARS)}\n\n> [truncated by SOFIA Cloud boot-context compiler]`;
}

function renderSection(title: string, memories: MemoryRow[]): string {
  if (memories.length === 0)
    return `## ${title}\n\n- No active memories found.`;
  return [
    `## ${title}`,
    "",
    ...memories.map((memory) => {
      const type = memory.memory_type.replaceAll("_", " ");
      return `- **${memory.title}** (${type}, id: ${memory.id}) — ${memory.body}`;
    }),
  ].join("\n");
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
```

- [ ] **Step 5: Run compiler tests and verify pass**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test --allow-env --allow-net=api.openrouter.ai boot_context_test.ts
```

Expected: boot-context tests pass.

- [ ] **Step 6: Commit**

```bash
git add sofia/cloud/supabase/functions/sofia-core/types.ts \
  sofia/cloud/supabase/functions/sofia-core/boot_context.ts \
  sofia/cloud/supabase/functions/sofia-core/boot_context_test.ts
git commit -m "sofia-cloud: compile boot context artifacts"
```

---

## Task 3: Add HTTP helpers for boot-context routing

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/http.ts`
- Modify: `sofia/cloud/supabase/functions/sofia-core/http_test.ts`

- [ ] **Step 1: Add failing HTTP helper tests**

Append to `sofia/cloud/supabase/functions/sofia-core/http_test.ts`:

```ts
import { isBootContextRequest, parseBootContextParams } from "./http.ts";

Deno.test("isBootContextRequest matches GET /boot-context only", () => {
  assert.equal(
    isBootContextRequest(
      "GET",
      "https://example.test/boot-context?context=personal",
    ),
    true,
  );
  assert.equal(
    isBootContextRequest("POST", "https://example.test/boot-context"),
    false,
  );
  assert.equal(isBootContextRequest("GET", "https://example.test/"), false);
});

Deno.test("parseBootContextParams validates context and force_refresh", () => {
  assert.deepEqual(
    parseBootContextParams(
      "https://example.test/boot-context?context=work&force_refresh=true",
    ),
    { context: "work", force_refresh: true },
  );
  assert.deepEqual(
    parseBootContextParams("https://example.test/boot-context"),
    { context: "personal", force_refresh: false },
  );
  assert.throws(
    () =>
      parseBootContextParams("https://example.test/boot-context?context=both"),
    /invalid boot context/,
  );
});
```

- [ ] **Step 2: Run HTTP tests and verify failure**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test --allow-env --allow-net=api.openrouter.ai http_test.ts
```

Expected: fail because helpers are not exported.

- [ ] **Step 3: Implement helpers**

Append to `sofia/cloud/supabase/functions/sofia-core/http.ts`:

```ts
import type { BootContextRequest, SofiaContext } from "./types.ts";

const BOOT_CONTEXTS = new Set<SofiaContext>(["personal", "work", "shared"]);

export function isBootContextRequest(method: string, url: string): boolean {
  return (
    method.toUpperCase() === "GET" && new URL(url).pathname === "/boot-context"
  );
}

export function parseBootContextParams(url: string): BootContextRequest {
  const parsed = new URL(url);
  const context = parsed.searchParams.get("context") ?? "personal";
  if (!BOOT_CONTEXTS.has(context as SofiaContext)) {
    throw new Error(`invalid boot context: ${context}`);
  }
  return {
    context: context as SofiaContext,
    force_refresh: parsed.searchParams.get("force_refresh") === "true",
  };
}
```

If linting complains about import placement, move the import to the top of the file.

- [ ] **Step 4: Run HTTP tests and verify pass**

Run:

```bash
cd sofia/cloud/supabase/functions/sofia-core
deno test --allow-env --allow-net=api.openrouter.ai http_test.ts
```

Expected: all HTTP tests pass.

- [ ] **Step 5: Commit**

```bash
git add sofia/cloud/supabase/functions/sofia-core/http.ts \
  sofia/cloud/supabase/functions/sofia-core/http_test.ts
git commit -m "sofia-cloud: identify boot context requests"
```

---

## Task 4: Expose boot context through MCP and HTTP

**Files:**

- Modify: `sofia/cloud/supabase/functions/sofia-core/index.ts`

- [ ] **Step 1: Add imports and input type**

In `sofia/cloud/supabase/functions/sofia-core/index.ts`, add:

```ts
import { compileBootContext } from "./boot_context.ts";
```

Update the HTTP import from:

```ts
import { shouldPatchMcpAcceptHeader } from "./http.ts";
```

to:

```ts
import {
  isBootContextRequest,
  parseBootContextParams,
  shouldPatchMcpAcceptHeader,
} from "./http.ts";
```

Add near the other input types:

```ts
type GetBootContextInput = {
  context: "personal" | "work" | "shared";
  force_refresh?: boolean;
};
```

- [ ] **Step 2: Register MCP `get_boot_context` tool**

Add this after `get_artifact` or before it in `index.ts`:

```ts
server.registerTool(
  "get_boot_context",
  {
    title: "Get SOFIA Boot Context",
    description:
      "Fetch SOFIA Cloud boot context for agent system prompt injection. This is the cloud runtime replacement for local Obsidian/SOFIA vault boot files.",
    inputSchema: {
      context: z.enum(["personal", "work", "shared"]).default("personal"),
      force_refresh: z.boolean().optional(),
    },
  },
  async ({ context, force_refresh }: GetBootContextInput) => {
    try {
      const bootContext = await compileBootContext(supabase, {
        context,
        force_refresh,
      });
      return textResponse(formatJson(bootContext));
    } catch (error) {
      return textResponse(
        `get_boot_context failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);
```

- [ ] **Step 3: Route HTTP `/boot-context` before generic GET health**

In `app.all("*", async (c: any) => { ... })`, after access-key validation and before the existing plain/browser `GET` health block, add:

```ts
if (isBootContextRequest(c.req.method, c.req.url)) {
  try {
    const bootContext = await compileBootContext(
      supabase,
      parseBootContextParams(c.req.url),
    );
    return c.json(bootContext, 200, corsHeaders);
  } catch (error) {
    return c.json(
      { error: `boot context failed: ${(error as Error).message}` },
      500,
      corsHeaders,
    );
  }
}
```

- [ ] **Step 4: Run check and all cloud tests**

Run:

```bash
mise run sofia-cloud:test
mise run sofia-cloud:check
```

Expected:

```text
22+ passed | 0 failed
Check file:///.../sofia-core/index.ts
```

The exact passing test count will increase after new tests.

- [ ] **Step 5: Commit**

```bash
git add sofia/cloud/supabase/functions/sofia-core/index.ts
git commit -m "sofia-cloud: expose boot context API"
```

---

## Task 5: Update Pi environment defaults for cloud boot fetch

**Files:**

- Modify: `pi/.pi/agent/env.zsh`

- [ ] **Step 1: Add cloud URL default**

In `pi/.pi/agent/env.zsh`, under the `# SOFIA cloud MCP` comment, add:

```zsh
export SOFIA_CLOUD_URL="${SOFIA_CLOUD_URL:-https://avgjtkgppeeihntsyjpy.supabase.co/functions/v1/sofia-core}"
```

Keep the existing `SOFIA_MCP_ACCESS_KEY` 1Password block unchanged.

- [ ] **Step 2: Verify shell parses**

Run:

```bash
zsh -n pi/.pi/agent/env.zsh
```

Expected: no output and exit code `0`.

- [ ] **Step 3: Commit**

```bash
git add pi/.pi/agent/env.zsh
git commit -m "sofia: configure cloud boot endpoint"
```

---

## Task 6: Cut Pi session-start boot context over to cloud

**Files:**

- Modify: `pi/.pi/agent/extensions/sofia.ts`

- [ ] **Step 1: Replace local session-start hook helpers with cloud helpers**

In `pi/.pi/agent/extensions/sofia.ts`, keep `spawnSync`, `homedir`, and `join` because pre-compact/session-end still use local scripts. Delete `extractAdditionalContext()` and `refreshSessionContext()`.

Add these helpers after `runHook()`:

```ts
const CLOUD_BOOT_FAILURE = `# SOFIA — cloud boot context unavailable

SOFIA Cloud boot context failed to load. Do not use local Obsidian memory as a fallback. Ask Justin whether to proceed without SOFIA context or debug SOFIA Cloud.`;

type BootContextResponse = {
  context: "personal" | "work" | "shared";
  content: string;
  generated_at: string;
  artifact_id: string | null;
  source: "compiled_artifacts" | "compiled_from_memories";
};

function detectSofiaContext(cwd: string): "personal" | "work" {
  return cwd.includes("/telophaseqs/") ? "work" : "personal";
}

async function fetchCloudBootContext(ctx: ExtensionContext): Promise<string> {
  const baseUrl = process.env.SOFIA_CLOUD_URL;
  const accessKey = process.env.SOFIA_MCP_ACCESS_KEY;
  if (!baseUrl || !accessKey) {
    throw new Error("missing SOFIA_CLOUD_URL or SOFIA_MCP_ACCESS_KEY");
  }

  const context = detectSofiaContext(ctx.cwd);
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/boot-context`;
  url.searchParams.set("context", context);

  const response = await fetch(url, {
    headers: { "x-sofia-key": accessKey },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as BootContextResponse;
  if (!payload.content?.includes(SOFIA_MARKER)) {
    throw new Error("boot-context response missing SOFIA marker");
  }
  return payload.content.trim();
}

async function refreshSessionContextFromCloud(ctx: ExtensionContext) {
  try {
    sessionContext = await fetchCloudBootContext(ctx);
  } catch (error) {
    console.error(`[sofia] cloud boot context failed: ${String(error)}`);
    sessionContext = CLOUD_BOOT_FAILURE;
  }
}
```

- [ ] **Step 2: Change session-start event to use cloud**

Replace:

```ts
pi.on("session_start", async (event, ctx) => {
  refreshSessionContext(event, ctx);
});
```

with:

```ts
pi.on("session_start", async (_event: SessionStartEvent, ctx) => {
  await refreshSessionContextFromCloud(ctx);
});
```

- [ ] **Step 3: Verify no local session-start script remains**

Run:

```bash
rg "sofia-session-start|extractAdditionalContext|refreshSessionContext" pi/.pi/agent/extensions/sofia.ts
```

Expected: no matches.

- [ ] **Step 4: Type-check by running Pi update/build path**

Run:

```bash
mise run pi-update
```

Expected: command completes successfully. If `pi-update` performs more than a type/build check, read its output and do not ignore failures.

- [ ] **Step 5: Commit**

```bash
git add pi/.pi/agent/extensions/sofia.ts
git commit -m "sofia: fetch boot context from cloud"
```

---

## Task 7: Deploy and live-verify cloud boot context

**Files:**

- No source edits expected unless verification exposes a bug.

- [ ] **Step 1: Run full local verification**

Run:

```bash
mise run sofia-cloud:test
mise run sofia-cloud:check
zsh -n pi/.pi/agent/env.zsh
mise run pi-update
git diff --check
```

Expected: all commands pass; `git diff --check` prints no whitespace errors.

- [ ] **Step 2: Deploy Edge Function**

Run:

```bash
mise run sofia-cloud:deploy
mise run sofia-cloud:functions-list
```

Expected: `sofia-core` is `ACTIVE` with a new version greater than `8`.

- [ ] **Step 3: Verify HTTP boot-context endpoint**

Run without printing secrets:

```bash
curl -sS \
  -H "x-sofia-key: ${SOFIA_MCP_ACCESS_KEY}" \
  "${SOFIA_CLOUD_URL}/boot-context?context=personal&force_refresh=true" \
  | deno eval 'const chunks=[]; for await (const c of Deno.stdin.readable) chunks.push(c); const s=new TextDecoder().decode(await new Blob(chunks).arrayBuffer()); const j=JSON.parse(s); console.log(JSON.stringify({context:j.context, source:j.source, hasMarker:j.content.includes("# SOFIA — your second brain context"), artifact_id:j.artifact_id, generated_at:j.generated_at}, null, 2));'
```

Expected:

```json
{
  "context": "personal",
  "source": "compiled_from_memories",
  "hasMarker": true,
  "artifact_id": "...",
  "generated_at": "..."
}
```

A later call without `force_refresh=true` should return `source: "compiled_artifacts"`.

- [ ] **Step 4: Verify MCP tool through Pi**

After restarting Pi so env changes are loaded, call direct MCP tool if available:

```text
sofia_cloud_get_boot_context(context="personal")
```

Expected: JSON text response with `content` containing `# SOFIA — your second brain context (context: personal)` and no `embedding` fields.

- [ ] **Step 5: Verify no local boot fallback**

Temporarily start a Pi session with an invalid `SOFIA_MCP_ACCESS_KEY` in the environment, or temporarily override it in a controlled shell before launching Pi. Confirm the injected context is the visible failure block:

```markdown
# SOFIA — cloud boot context unavailable
```

Expected: no local `_agent/MEMORY.md`, `_agent/USER.md`, or `_agent/SOUL.md` content appears from the extension as fallback.

- [ ] **Step 6: Commit verification docs if README was updated**

If `sofia/cloud/README.md` was updated with endpoint notes:

```bash
git add sofia/cloud/README.md
git commit -m "docs: document SOFIA cloud boot context"
```

If no docs changed, skip this commit.

---

## Task 8: Final review and save point

**Files:**

- No source edits expected unless review finds issues.

- [ ] **Step 1: Inspect final diff**

Run:

```bash
git status --short
git log --oneline --decorate -10
git diff origin/main...HEAD --stat
```

Expected: only intended commits/files are present.

- [ ] **Step 2: Run final verification before completion claim**

Run:

```bash
mise run sofia-cloud:test
mise run sofia-cloud:check
zsh -n pi/.pi/agent/env.zsh
mise run pi-update
mise run sofia-cloud:functions-list
```

Expected: all pass; `sofia-core` active at deployed version.

- [ ] **Step 3: Capture durable SOFIA decision in cloud**

Use the live MCP capture tool after the classifier normalization deploy:

```text
sofia_cloud_capture_event(
  content="SOFIA boot context is now cloud-first: Pi session-start fetches boot context from SOFIA Cloud, and local Obsidian/_agent files are not used as the runtime fallback. Obsidian remains a generated human-readable view.",
  context="personal",
  source="pi",
  type_hint="decision",
  metadata={"project":"sofia-cloud","area":"boot-context"}
)
```

Expected: capture succeeds; if auto-promoted, optionally archive test-like duplicates but keep the real decision.

- [ ] **Step 4: Stop before pushing**

Do **not** push automatically. Report:

- commits created,
- deployed function version,
- verification command results,
- whether Pi restart/session boot was verified,
- whether any follow-up is needed.

---

## Self-review

### Spec coverage

- Cloud source of boot context: Tasks 2, 4, 6, 7.
- No local boot fallback: Task 6 and Task 7 Step 5.
- MCP `get_boot_context`: Task 4.
- HTTP `/boot-context`: Tasks 3 and 4.
- Compact context-aware boot context: Task 2.
- Visible failure behavior: Task 6.
- Classifier action hardening: Task 1.
- Security/no embeddings: Task 4 returns compiler response only; compiler only selects non-embedding memory columns.
- Obsidian as human view: captured in generated boot text and final decision capture.

### Placeholder scan

No placeholder markers or unconstrained edge-case steps are intentionally left in this plan. Optional README documentation is explicitly conditional and skippable.

### Type consistency

- `BootContextRequest` uses `force_refresh`, matching HTTP query and MCP input.
- `BootContextResponse.source` is `compiled_artifacts | compiled_from_memories`, matching compiler tests and endpoint response.
- `SofiaContext` remains `personal | work | shared`; HTTP rejects `both`.
