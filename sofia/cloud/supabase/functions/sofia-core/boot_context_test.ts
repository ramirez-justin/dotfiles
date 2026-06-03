import assert from "node:assert/strict";
import { compileBootContext } from "./boot_context.ts";

type Call = { table: string; operation: string; payload?: unknown };

type FakeState = {
  artifact?: Record<string, unknown> | null;
  memories?: Record<string, unknown>[];
  todos?: Record<string, unknown>[];
  memoryEntityRows?: Record<string, unknown>[];
  todoEntityRows?: Record<string, unknown>[];
  entity?: Record<string, unknown> | null;
};

function fakeSupabase(state: FakeState) {
  const calls: Call[] = [];
  const client = {
    calls,
    from(table: string) {
      let operation = "select";
      let insertedPayload: unknown;
      let idFilter: unknown[] | null = null;
      const query = {
        select(_columns?: string) {
          operation = "select";
          return query;
        },
        eq(_column: string, _value: unknown) {
          return query;
        },
        in(column: string, value: unknown[]) {
          if (column === "id") idFilter = value;
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
          insertedPayload = payload;
          calls.push({ table, operation, payload });
          return query;
        },
        insert(payload: unknown) {
          operation = "insert";
          insertedPayload = payload;
          calls.push({ table, operation, payload });
          return query;
        },
        async maybeSingle() {
          if (table === "entities") return { data: state.entity ?? null, error: null };
          return { data: state.artifact ?? null, error: null };
        },
        async single() {
          if (table === "boot_context_snapshots") {
            return {
              data: {
                id: "snapshot-new",
                generated_at: "2026-05-02T00:00:00.000Z",
                ...(insertedPayload as Record<string, unknown>),
              },
              error: null,
            };
          }
          return {
            data: {
              id: "artifact-new",
              generated_at: "2026-05-02T00:00:00.000Z",
            },
            error: null,
          };
        },
        then(resolve: (value: { data: unknown; error: null }) => void) {
          if (table === "memory_entities") {
            resolve({ data: state.memoryEntityRows ?? [], error: null });
            return;
          }
          if (table === "todo_entities") {
            resolve({ data: state.todoEntityRows ?? [], error: null });
            return;
          }
          if (table === "todos") {
            const todos = idFilter
              ? (state.todos ?? []).filter((todo) => idFilter?.includes(todo.id))
              : (state.todos ?? []);
            resolve({ data: todos, error: null });
            return;
          }
          const memories = idFilter
            ? (state.memories ?? []).filter((memory) => idFilter?.includes(memory.id))
            : (state.memories ?? []);
          resolve({ data: memories, error: null });
        },
      };
      return query;
    },
  };
  return client;
}

Deno.test("compileBootContext returns existing artifact unless forced", async () => {
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
});

Deno.test("compileBootContext compiles shared plus requested context memories", async () => {
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
  assert.equal(result.snapshot_id, "snapshot-new");
  assert.deepEqual(result.included_memory_ids, ["m-shared", "m-personal"]);
  assert.match(
    result.content,
    /^# SOFIA — your second brain context \(context: personal\)/,
  );
  assert.match(result.content, /## SOUL — Who Sofia Is/);
  assert.match(
    result.content,
    /You're not a chatbot\. You're becoming someone\. You are Sofia\./,
  );
  assert.match(
    result.content,
    /Be genuinely helpful, not performatively helpful\./,
  );
  assert.match(result.content, /## Shared Memory/);
  assert.match(result.content, /Do not reveal secrets/);
  assert.match(result.content, /## Personal Memory/);
  assert.match(result.content, /New home purchase/);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[0].table, "boot_context_snapshots");
  assert.equal(client.calls[0].operation, "insert");
  assert.deepEqual(
    (client.calls[0].payload as Record<string, unknown>).included_memory_ids,
    [
      "m-shared",
      "m-personal",
    ],
  );
  assert.equal(
    typeof (client.calls[0].payload as Record<string, unknown>).token_count,
    "number",
  );
  assert.equal(client.calls[1].table, "compiled_artifacts");
  assert.equal(client.calls[1].operation, "upsert");
});

Deno.test("compileBootContext orders by retrieval policy and includes active todos", async () => {
  const client = fakeSupabase({
    artifact: null,
    memories: [
      {
        id: "m-low",
        context: "personal",
        memory_type: "fact",
        title: "Low priority fact",
        body: "Useful only on demand.",
        confidence: 0.8,
        retrieval_priority: 10,
        last_verified_at: null,
        created_at: "2026-05-01T10:00:00Z",
      },
      {
        id: "m-high",
        context: "personal",
        memory_type: "operating_rule",
        title: "High priority rule",
        body: "Always prefer cloud memory.",
        confidence: 0.99,
        retrieval_priority: 95,
        last_verified_at: "2026-06-01T00:00:00Z",
        created_at: "2026-05-01T11:00:00Z",
      },
    ],
    todos: [
      {
        id: "todo-1",
        context: "personal",
        title: "Review memory graph",
        status: "open",
        priority: 80,
        due_at: null,
      },
    ],
  });

  const result = await compileBootContext(client as never, {
    context: "personal",
    force_refresh: true,
  });

  assert.equal(result.snapshot_id, "snapshot-new");
  assert.deepEqual(result.included_memory_ids, ["m-high", "m-low"]);
  assert.deepEqual(result.included_todo_ids, ["todo-1"]);
  assert.equal(
    result.content.indexOf("High priority rule") <
      result.content.indexOf("Low priority fact"),
    true,
  );
  assert.match(result.content, /## Active Todos/);
  assert.match(result.content, /Review memory graph/);
  assert.match(
    result.content,
    /confidence: 0\.99; priority: 95; last verified: 2026-06-01/,
  );
});

Deno.test("compileBootContext can compile an entity-scoped slice", async () => {
  const client = fakeSupabase({
    artifact: null,
    entity: { id: "entity-tqs" },
    memoryEntityRows: [{ memory_id: "m-tqs" }],
    todoEntityRows: [{ todo_id: "todo-tqs" }],
    memories: [
      {
        id: "m-tqs",
        context: "work",
        memory_type: "project_context",
        title: "TelophaseQS stack",
        body: "TelophaseQS uses NautilusTrader.",
        retrieval_priority: 80,
        created_at: "2026-05-01T12:00:00Z",
      },
      {
        id: "m-other",
        context: "work",
        memory_type: "project_context",
        title: "Other project",
        body: "This should be excluded from scoped context.",
        retrieval_priority: 90,
        created_at: "2026-05-01T12:00:00Z",
      },
    ],
    todos: [
      {
        id: "todo-tqs",
        context: "work",
        title: "Review TelophaseQS entity graph",
        status: "open",
        priority: 80,
      },
      {
        id: "todo-other",
        context: "work",
        title: "Unrelated todo",
        status: "open",
        priority: 90,
      },
    ],
  });

  const result = await compileBootContext(client as never, {
    context: "work",
    force_refresh: true,
    entity: "TelophaseQS",
  });

  assert.deepEqual(result.included_memory_ids, ["m-tqs"]);
  assert.deepEqual(result.included_todo_ids, ["todo-tqs"]);
  assert.deepEqual(result.included_entity_ids, ["entity-tqs"]);
  assert.match(result.content, /TelophaseQS stack/);
  assert.match(result.content, /Review TelophaseQS entity graph/);
  assert.doesNotMatch(result.content, /Other project/);
  assert.doesNotMatch(result.content, /Unrelated todo/);
});

Deno.test("compileBootContext does not fall back to global context when scoped entity is missing", async () => {
  const client = fakeSupabase({
    artifact: null,
    entity: null,
    memories: [
      {
        id: "m-global",
        context: "work",
        memory_type: "project_context",
        title: "Global memory",
        body: "This should not leak into a missing entity slice.",
        retrieval_priority: 90,
        created_at: "2026-05-01T12:00:00Z",
      },
    ],
    todos: [
      {
        id: "todo-global",
        context: "work",
        title: "Global todo",
        status: "open",
        priority: 90,
      },
    ],
  });

  const result = await compileBootContext(client as never, {
    context: "work",
    force_refresh: true,
    entity: "MissingProject",
  });

  assert.deepEqual(result.included_memory_ids, []);
  assert.deepEqual(result.included_todo_ids, []);
  assert.deepEqual(result.included_entity_ids, []);
  assert.doesNotMatch(result.content, /Global memory/);
  assert.doesNotMatch(result.content, /Global todo/);
});

Deno.test("compileBootContext omits expired and stale active memories defensively", async () => {
  const client = fakeSupabase({
    artifact: null,
    memories: [
      {
        id: "m-expired",
        context: "personal",
        memory_type: "fact",
        title: "Expired fact",
        body: "This should not be in boot context.",
        retrieval_priority: 95,
        expires_at: "2000-01-01T00:00:00.000Z",
        created_at: "2026-05-01T12:00:00Z",
      },
      {
        id: "m-stale",
        context: "personal",
        memory_type: "fact",
        title: "Stale fact",
        body: "This should not be in boot context either.",
        retrieval_priority: 94,
        stale_after: "2000-01-01T00:00:00.000Z",
        created_at: "2026-05-01T12:00:00Z",
      },
      {
        id: "m-current",
        context: "personal",
        memory_type: "operating_rule",
        title: "Current rule",
        body: "This stays visible.",
        retrieval_priority: 70,
        expires_at: "2999-01-01T00:00:00.000Z",
        created_at: "2026-05-01T12:00:00Z",
      },
    ],
  });

  const result = await compileBootContext(client as never, {
    context: "personal",
    force_refresh: true,
  });

  assert.deepEqual(result.included_memory_ids, ["m-current"]);
  assert.doesNotMatch(result.content, /Expired fact/);
  assert.doesNotMatch(result.content, /Stale fact/);
  assert.match(result.content, /Current rule/);
});
