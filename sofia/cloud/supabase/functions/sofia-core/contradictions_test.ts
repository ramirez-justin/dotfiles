import assert from "node:assert/strict";
import {
  buildMemoryQaReport,
  classifyMemoryPair,
  createContradictionReview,
  filterUnresolvedContradictionsForBoot,
} from "./contradictions.ts";

type Call = { table: string; operation: string; payload?: unknown };

function fakeSupabase(state: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const client = {
    calls,
    from(table: string) {
      let operation = "select";
      let insertedPayload: unknown;
      const query = {
        select(_columns?: string) {
          return query;
        },
        insert(payload: unknown) {
          operation = "insert";
          insertedPayload = payload;
          calls.push({ table, operation, payload });
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
        async single() {
          if (table === "memory_contradiction_reviews" && operation === "insert") {
            return { data: { id: "review-1", ...(insertedPayload as Record<string, unknown>) }, error: null };
          }
          return { data: insertedPayload as Record<string, unknown>, error: null };
        },
        then(resolve: (value: { data: unknown; error: null }) => void) {
          if (table === "unresolved_memory_contradictions") {
            resolve({ data: state.unresolvedContradictions ?? [], error: null });
            return;
          }
          if (table === "weak_provenance_memories") {
            resolve({ data: state.weakProvenance ?? [], error: null });
            return;
          }
          if (table === "memories") {
            resolve({ data: state.staleMemories ?? [], error: null });
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

Deno.test("classifyMemoryPair identifies exact duplicates", () => {
  const result = classifyMemoryPair({
    id: "a",
    title: "SOFIA Cloud canonical store",
    body: "SOFIA Cloud/Postgres is the canonical runtime memory source.",
  }, {
    id: "b",
    title: "SOFIA Cloud canonical store",
    body: "SOFIA Cloud/Postgres is the canonical runtime memory source.",
  });

  assert.equal(result.relation, "duplicate");
  assert.equal(result.requires_review, false);
});

Deno.test("classifyMemoryPair identifies explicit contradictions", () => {
  const result = classifyMemoryPair({
    id: "a",
    title: "Gateway fallback",
    body: "SOFIA agents should fail closed when SOFIA Cloud is unavailable.",
  }, {
    id: "b",
    title: "Gateway fallback",
    body: "SOFIA agents should not fail closed when SOFIA Cloud is unavailable.",
  });

  assert.equal(result.relation, "contradiction");
  assert.equal(result.requires_review, true);
  assert.equal(result.severity, "high");
});

Deno.test("classifyMemoryPair identifies softer updates", () => {
  const result = classifyMemoryPair({
    id: "a",
    title: "Phase status",
    body: "Phase 5 is pending deployment.",
  }, {
    id: "b",
    title: "Phase status",
    body: "Phase 5 is now deployed and verified.",
  });

  assert.equal(result.relation, "update");
  assert.equal(result.requires_review, true);
});

Deno.test("classifyMemoryPair ignores unrelated memories", () => {
  const result = classifyMemoryPair({
    id: "a",
    title: "Houseplant care",
    body: "Prayer Plant leaf movement is a useful health diagnostic.",
  }, {
    id: "b",
    title: "SOFIA deployment",
    body: "The sofia-core function is deployed on Supabase.",
  });

  assert.equal(result.relation, "unrelated");
  assert.equal(result.requires_review, false);
});

Deno.test("createContradictionReview inserts pending actionable review", async () => {
  const client = fakeSupabase();

  const result = await createContradictionReview(client as never, {
    context: "work",
    primary_memory_id: "memory-a",
    conflicting_memory_id: "memory-b",
    relation: "contradicts",
    severity: "high",
    confidence: 0.94,
    rationale: "Active memories disagree about fail-closed behavior.",
    proposed_resolution: "review and supersede one memory",
    source: "memory_qa",
  });

  assert.equal(result.id, "review-1");
  assert.deepEqual(client.calls, [{
    table: "memory_contradiction_reviews",
    operation: "insert",
    payload: {
      context: "work",
      primary_memory_id: "memory-a",
      conflicting_memory_id: "memory-b",
      relation: "contradicts",
      severity: "high",
      confidence: 0.94,
      rationale: "Active memories disagree about fail-closed behavior.",
      proposed_resolution: "review and supersede one memory",
      source: "memory_qa",
      status: "pending_review",
      candidate_id: null,
      reconciliation_id: null,
      metadata: {},
    },
  }]);
});

Deno.test("buildMemoryQaReport returns actionable rows", async () => {
  const report = await buildMemoryQaReport(fakeSupabase({
    unresolvedContradictions: [{ review_id: "r1", severity: "high", primary_memory_id: "m1" }],
    weakProvenance: [{ memory_id: "m2", title: "Weak memory" }],
    staleMemories: [{ id: "m3", title: "Stale memory", retrieval_priority: 80 }],
  }) as never, { context: "work" });

  assert.equal(report.context, "work");
  assert.equal(report.unresolved_contradictions.length, 1);
  assert.equal(report.weak_provenance.length, 1);
  assert.equal(report.stale_high_priority.length, 1);
  assert.deepEqual(report.recommendations, [
    "review 1 unresolved contradiction(s) before trusting affected boot context",
    "add provenance or archive 1 high-priority memory/memories with weak evidence",
    "refresh or archive 1 stale high-priority memory/memories",
  ]);
});

Deno.test("filterUnresolvedContradictionsForBoot keeps one side of active conflicts", () => {
  const result = filterUnresolvedContradictionsForBoot(
    [
      { id: "old", title: "Old", body: "old", retrieval_priority: 90, confidence: 0.9, created_at: "2026-01-01T00:00:00Z" },
      { id: "new", title: "New", body: "new", retrieval_priority: 90, confidence: 0.96, created_at: "2026-02-01T00:00:00Z" },
      { id: "safe", title: "Safe", body: "safe", retrieval_priority: 50, confidence: 0.8 },
    ],
    [{ primary_memory_id: "old", conflicting_memory_id: "new", confidence: 0.95, severity: "high" }],
  );

  assert.deepEqual(result.omittedMemoryIds, ["old"]);
  assert.deepEqual(result.memories.map((memory: { id: string }) => memory.id), ["new", "safe"]);
});
