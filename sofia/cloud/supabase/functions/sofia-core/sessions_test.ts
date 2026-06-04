import assert from "node:assert/strict";
import {
  attachTaskArtifact,
  completeTaskRun,
  getLatestHandoffs,
  listActiveTaskRuns,
  startTaskRun,
} from "./sessions.ts";

type Call = { table: string; operation: string; payload?: unknown };

type FakeState = {
  taskRun?: Record<string, unknown>;
  artifacts?: Record<string, unknown>[];
  handoffs?: Record<string, unknown>[];
  activeTasks?: Record<string, unknown>[];
  entity?: Record<string, unknown> | null;
};

function fakeSupabase(state: FakeState = {}) {
  const calls: Call[] = [];
  const client = {
    calls,
    from(table: string) {
      let operation = "select";
      let insertedPayload: unknown;
      const query = {
        select(_columns?: string) {
          if (operation !== "insert" && operation !== "update") operation = "select";
          return query;
        },
        insert(payload: unknown) {
          operation = "insert";
          insertedPayload = payload;
          calls.push({ table, operation, payload });
          return query;
        },
        update(payload: unknown) {
          operation = "update";
          insertedPayload = payload;
          calls.push({ table, operation, payload });
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
        async maybeSingle() {
          if (table === "entities") return { data: state.entity ?? null, error: null };
          return { data: null, error: null };
        },
        async single() {
          if (table === "agent_sessions" && operation === "insert") {
            return { data: { id: "session-1", ...(insertedPayload as Record<string, unknown>) }, error: null };
          }
          if (table === "task_runs" && operation === "insert") {
            return { data: { id: "task-1", ...(insertedPayload as Record<string, unknown>) }, error: null };
          }
          if (table === "task_runs" && operation === "select") {
            return {
              data: state.taskRun ?? {
                id: "task-1",
                session_id: "session-1",
                context: "work",
                entity_id: "entity-1",
                title: "Ship feature",
                objective: "Implement task state",
              },
              error: null,
            };
          }
          if (table === "task_runs" && operation === "update") {
            return {
              data: {
                id: "task-1",
                session_id: "session-1",
                context: "work",
                entity_id: "entity-1",
                title: "Ship feature",
                objective: "Implement task state",
                ...(insertedPayload as Record<string, unknown>),
              },
              error: null,
            };
          }
          if (table === "task_artifacts" && operation === "insert") {
            return { data: { id: "artifact-1", ...(insertedPayload as Record<string, unknown>) }, error: null };
          }
          if (table === "session_handoffs" && operation === "insert") {
            return { data: { id: "handoff-1", ...(insertedPayload as Record<string, unknown>) }, error: null };
          }
          return { data: insertedPayload ?? {}, error: null };
        },
        then(resolve: (value: { data: unknown; error: null }) => void) {
          if (table === "task_artifacts") {
            resolve({ data: state.artifacts ?? [], error: null });
            return;
          }
          if (table === "session_handoffs") {
            resolve({ data: state.handoffs ?? [], error: null });
            return;
          }
          if (table === "task_runs") {
            resolve({ data: state.activeTasks ?? [], error: null });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      return query;
    },
  };
  return client;
}

Deno.test("startTaskRun creates an agent session and in-progress task run", async () => {
  const client = fakeSupabase();

  const result = await startTaskRun(client as never, {
    context: "work",
    agent_name: "hermes",
    session_ref: "session-abc",
    title: "Implement task continuity",
    objective: "Persist resumable task state.",
    entity_id: "entity-1",
    metadata: { branch: "feat/session-continuity" },
  });

  assert.equal(result.session_id, "session-1");
  assert.equal(result.task_run_id, "task-1");
  assert.deepEqual(client.calls, [
    {
      table: "agent_sessions",
      operation: "insert",
      payload: {
        context: "work",
        agent_name: "hermes",
        session_ref: "session-abc",
        status: "active",
        metadata: { branch: "feat/session-continuity" },
      },
    },
    {
      table: "task_runs",
      operation: "insert",
      payload: {
        session_id: "session-1",
        context: "work",
        entity_id: "entity-1",
        title: "Implement task continuity",
        objective: "Persist resumable task state.",
        status: "in_progress",
        metadata: { branch: "feat/session-continuity" },
      },
    },
  ]);
});

Deno.test("attachTaskArtifact records resumable task evidence", async () => {
  const client = fakeSupabase();

  const artifact = await attachTaskArtifact(client as never, {
    task_run_id: "task-1",
    artifact_type: "commit",
    title: "Phase 5 implementation commit",
    uri: "https://github.com/example/repo/commit/abc",
    content: "Tests passed: 12/12",
    metadata: { sha: "abc" },
  });

  assert.equal(artifact.id, "artifact-1");
  assert.deepEqual(client.calls[0], {
    table: "task_artifacts",
    operation: "insert",
    payload: {
      task_run_id: "task-1",
      artifact_type: "commit",
      title: "Phase 5 implementation commit",
      uri: "https://github.com/example/repo/commit/abc",
      content: "Tests passed: 12/12",
      metadata: { sha: "abc" },
    },
  });
});

Deno.test("completeTaskRun updates task state and creates handoff", async () => {
  const client = fakeSupabase({
    artifacts: [
      { id: "artifact-1", artifact_type: "commit", title: "Commit abc", uri: "https://example/abc" },
      { id: "artifact-2", artifact_type: "test_output", title: "Tests", content: "76/76 passed" },
    ],
  });

  const result = await completeTaskRun(client as never, {
    task_run_id: "task-1",
    status: "completed",
    outcome_summary: "Task/session continuity shipped.",
    verification_summary: "mise run sofia-cloud:test passed.",
  });

  assert.equal(result.handoff_id, "handoff-1");
  assert.equal(result.task_run_id, "task-1");
  assert.equal(client.calls[0].table, "task_runs");
  assert.equal(client.calls[0].operation, "update");
  assert.deepEqual(client.calls[0].payload, {
    status: "completed",
    completed_at: result.completed_at,
    outcome_summary: "Task/session continuity shipped.",
    verification_summary: "mise run sofia-cloud:test passed.",
  });
  const handoff = client.calls.find((call) => call.table === "session_handoffs");
  assert.ok(handoff);
  assert.match(JSON.stringify(handoff?.payload), /Task\/session continuity shipped/);
  assert.match(JSON.stringify(handoff?.payload), /artifact-1/);
});

Deno.test("getLatestHandoffs returns newest active handoffs", async () => {
  const client = fakeSupabase({
    handoffs: [
      {
        id: "handoff-2",
        task_run_id: "task-2",
        title: "Continue SOFIA work",
        handoff_markdown: "Resume from tests passing.",
        verification_status: "passed",
        created_at: "2026-06-03T20:00:00Z",
      },
    ],
  });

  const handoffs = await getLatestHandoffs(client as never, {
    context: "work",
    entity_id: "entity-1",
    limit: 5,
  });

  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].id, "handoff-2");
});

Deno.test("listActiveTaskRuns returns resumable active work", async () => {
  const client = fakeSupabase({
    activeTasks: [
      { id: "task-1", title: "Blocked deploy", status: "blocked", context: "work" },
    ],
  });

  const tasks = await listActiveTaskRuns(client as never, {
    context: "work",
    limit: 10,
  });

  assert.deepEqual(tasks, [
    { id: "task-1", title: "Blocked deploy", status: "blocked", context: "work" },
  ]);
});
