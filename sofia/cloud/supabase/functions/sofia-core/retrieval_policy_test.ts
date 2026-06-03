import assert from "node:assert/strict";
import { buildRetrievalPolicyReport } from "./retrieval_policy.ts";

type FakeState = {
  memories: Record<string, unknown>[];
  retrievals: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
};

function fakeSupabase(state: FakeState) {
  const calls: Array<{ table: string; operation: string }> = [];
  const client = {
    calls,
    from(table: string) {
      calls.push({ table, operation: "select" });
      const query = {
        select(_columns?: string) {
          return query;
        },
        in(_column: string, _value: unknown[]) {
          return query;
        },
        eq(_column: string, _value: unknown) {
          return query;
        },
        order(_column: string, _options?: unknown) {
          return query;
        },
        limit(_value: number) {
          return query;
        },
        then(resolve: (value: { data: unknown[]; error: null }) => void) {
          if (table === "memories") {
            resolve({ data: state.memories, error: null });
            return;
          }
          if (table === "memory_retrievals") {
            resolve({ data: state.retrievals, error: null });
            return;
          }
          if (table === "boot_context_snapshots") {
            resolve({ data: state.snapshots, error: null });
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

Deno.test("buildRetrievalPolicyReport aggregates helpful and confusing retrievals", async () => {
  const client = fakeSupabase({
    memories: [
      {
        id: "m-helpful",
        context: "personal",
        title: "Helpful memory",
        memory_type: "preference",
        retrieval_priority: 60,
        boot_context_eligible: false,
        status: "active",
      },
      {
        id: "m-confusing",
        context: "personal",
        title: "Confusing memory",
        memory_type: "fact",
        retrieval_priority: 75,
        boot_context_eligible: true,
        status: "active",
      },
    ],
    retrievals: [
      { id: "r1", memory_id: "m-helpful", was_used: true, was_helpful: true, caused_confusion: false },
      { id: "r2", memory_id: "m-helpful", was_used: true, was_helpful: true, caused_confusion: false },
      { id: "r3", memory_id: "m-helpful", was_used: false, was_helpful: false, caused_confusion: false },
      { id: "r4", memory_id: "m-confusing", was_used: true, was_helpful: false, caused_confusion: true },
      { id: "r5", memory_id: "m-confusing", was_used: true, was_helpful: false, caused_confusion: true },
    ],
    snapshots: [],
  });

  const report = await buildRetrievalPolicyReport(client as never, {
    context: "personal",
    limit: 10,
    minimum_retrievals: 1,
  });

  assert.equal(report.top_helpful[0].memory_id, "m-helpful");
  assert.equal(report.top_helpful[0].retrieval_count, 3);
  assert.equal(report.top_helpful[0].helpful_count, 2);
  assert.equal(report.top_helpful[0].helpful_rate, 2 / 3);
  assert.equal(report.top_confusing[0].memory_id, "m-confusing");
  assert.equal(report.top_confusing[0].confusing_count, 2);
  assert.equal(report.top_confusing[0].confusing_rate, 1);
});

Deno.test("buildRetrievalPolicyReport recommends gated non-destructive policy changes", async () => {
  const client = fakeSupabase({
    memories: [
      {
        id: "m-helpful",
        context: "personal",
        title: "Helpful memory",
        memory_type: "preference",
        retrieval_priority: 55,
        boot_context_eligible: false,
        status: "active",
      },
      {
        id: "m-confusing",
        context: "personal",
        title: "Confusing memory",
        memory_type: "fact",
        retrieval_priority: 80,
        boot_context_eligible: true,
        status: "active",
      },
      {
        id: "m-boot-unused",
        context: "personal",
        title: "Boot unused memory",
        memory_type: "project_context",
        retrieval_priority: 85,
        boot_context_eligible: true,
        status: "active",
      },
    ],
    retrievals: [
      { id: "r1", memory_id: "m-helpful", was_used: true, was_helpful: true, caused_confusion: false },
      { id: "r2", memory_id: "m-helpful", was_used: true, was_helpful: true, caused_confusion: false },
      { id: "r3", memory_id: "m-confusing", was_used: true, was_helpful: false, caused_confusion: true },
      { id: "r4", memory_id: "m-confusing", was_used: true, was_helpful: false, caused_confusion: true },
    ],
    snapshots: [
      { id: "s1", context: "personal", included_memory_ids: ["m-boot-unused"] },
    ],
  });

  const report = await buildRetrievalPolicyReport(client as never, {
    context: "personal",
    limit: 10,
    minimum_retrievals: 1,
  });

  assert.deepEqual(
    report.recommendations.map((recommendation) => recommendation.action),
    ["enable_boot_context", "raise_priority", "needs_review", "lower_priority"],
  );
  assert.equal(
    report.recommendations.some((recommendation) => String(recommendation.action) === "archive"),
    false,
  );
  assert.equal(report.boot_unused[0].memory_id, "m-boot-unused");
  assert.deepEqual(client.calls.map((call) => call.table), [
    "memories",
    "memory_retrievals",
    "boot_context_snapshots",
  ]);
});
