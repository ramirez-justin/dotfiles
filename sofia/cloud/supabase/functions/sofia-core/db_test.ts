import assert from "node:assert/strict";
import {
  applyMemorySupersessionFromReconciliation,
  applyMemoryUpdateFromReconciliation,
  archiveMemory,
  createTodoFromCandidate,
  insertReconciliation,
  markCandidateArchived,
  markExpiredMemoriesStale,
  queueHighPriorityStaleMemoryReviews,
  promoteCandidate,
  promoteExistingCandidate,
  recordMemoryFeedback,
  recordMemoryRetrievals,
} from "./db.ts";

type TableCall = { table: string; operation: string; payload?: unknown };

function fakeSupabase(record: Record<string, unknown>) {
  const calls: TableCall[] = [];
  const client = {
    calls,
    from(table: string) {
      let operation: string | null = null;
      const query = {
        insert(payload: unknown) {
          operation = "insert";
          calls.push({ table, operation, payload });
          return query;
        },
        select(_columns?: string) {
          return query;
        },
        eq(_column: string, _value: unknown) {
          return query;
        },
        lt(_column: string, _value: unknown) {
          return query;
        },
        or(_filters: string) {
          return query;
        },
        gte(_column: string, _value: unknown) {
          return query;
        },
        not(_column: string, _operator: string, _value: unknown) {
          return query;
        },
        is(_column: string, _value: unknown) {
          return query;
        },
        limit(_value: number) {
          return query;
        },
        order(_column: string, _options?: unknown) {
          return query;
        },
        update(payload: unknown) {
          operation = "update";
          calls.push({ table, operation, payload });
          return query;
        },
        async single() {
          if (table === "memory_candidates" && operation === "insert") {
            return { data: { id: "candidate-review-1" }, error: null };
          }
          if (table === "memory_candidates") {
            return { data: record, error: null };
          }
          if (table === "events" && operation === "insert") {
            return { data: { id: "event-review-1" }, error: null };
          }
          if (table === "memory_reconciliations" && operation === "insert") {
            return { data: { id: "reconciliation-1" }, error: null };
          }
          if (table === "memories" && operation === "insert") {
            return { data: { id: "memory-1" }, error: null };
          }
          if (table === "todos" && operation === "insert") {
            return { data: { id: "todo-1" }, error: null };
          }
          if (table === "memories") {
            return { data: { id: "memory-1", ...record }, error: null };
          }
          return { data: record, error: null };
        },
        then(resolve: (value: { data?: unknown; error: null }) => void) {
          if (table === "memories" && record.highPriorityStaleMemories) {
            resolve({
              data: (record.highPriorityStaleMemories as unknown[]) ?? [],
              error: null,
            });
            return;
          }
          resolve({ error: null });
        },
      };
      return query;
    },
  };
  return client;
}

Deno.test("promoteExistingCandidate creates memory, version, and marks candidate approved", async () => {
  const client = fakeSupabase({
    id: "candidate-1",
    context: "personal",
    candidate_type: "decision",
    candidate_text: "Use Supabase as SOFIA cloud core.",
    confidence: 0.92,
    metadata: { title: "Use Supabase" },
  });

  const memoryId = await promoteExistingCandidate(
    client as never,
    "candidate-1",
    [0.1, 0.2],
  );

  assert.equal(memoryId, "memory-1");
  assert.deepEqual(client.calls, [
    {
      table: "memories",
      operation: "insert",
      payload: {
        context: "personal",
        memory_type: "decision",
        title: "Use Supabase",
        body: "Use Supabase as SOFIA cloud core.",
        embedding: [0.1, 0.2],
        confidence: 0.92,
        status: "active",
        created_from_candidate_id: "candidate-1",
        current_version: 1,
        retrieval_priority: 70,
        boot_context_eligible: true,
        activation_triggers: [],
        last_verified_at: null,
        metadata: { title: "Use Supabase" },
      },
    },
    {
      table: "memory_versions",
      operation: "insert",
      payload: {
        memory_id: "memory-1",
        version: 1,
        title: "Use Supabase",
        body: "Use Supabase as SOFIA cloud core.",
        change_reason: "human-approved promotion from review queue",
        created_by: "review_candidates",
      },
    },
    {
      table: "memory_provenance",
      operation: "insert",
      payload: {
        memory_id: "memory-1",
        candidate_id: "candidate-1",
        event_id: null,
        source_type: "manual_review",
        source_uri: null,
        source_ref: null,
        captured_by: "agent",
        captured_by_agent: null,
        confidence: 0.92,
        evidence_quote: null,
        evidence_summary: "human-approved promotion from review queue",
        observed_at: null,
        last_verified_at: null,
      },
    },
    {
      table: "memory_candidates",
      operation: "update",
      payload: { status: "approved" },
    },
  ]);
});

Deno.test("archiveMemory marks an active memory archived with audit metadata", async () => {
  const client = fakeSupabase({
    id: "memory-1",
    metadata: { disposable: true },
  });

  const result = await archiveMemory(
    client as never,
    "memory-1",
    "cleanup after E2E test",
  );

  assert.equal(result.id, "memory-1");
  assert.deepEqual(client.calls, [
    {
      table: "memories",
      operation: "update",
      payload: {
        status: "archived",
        metadata: {
          disposable: true,
          archived_by: "archive_memory",
          archive_reason: "cleanup after E2E test",
        },
      },
    },
  ]);
});

Deno.test("promoteExistingCandidate does not promote todo candidates", async () => {
  const client = fakeSupabase({
    id: "candidate-2",
    context: "personal",
    candidate_type: "todo",
    candidate_text: "Call the bank.",
    confidence: 0.9,
    metadata: { title: "Call bank" },
  });

  await assert.rejects(
    () => promoteExistingCandidate(client as never, "candidate-2", null),
    /todo candidates are not promoted to durable memories/,
  );
  assert.deepEqual(client.calls, []);
});

Deno.test("insertReconciliation stores decision audit row", async () => {
  const client = fakeSupabase({ id: "reconciliation-1" });

  const id = await insertReconciliation(
    client as never,
    "candidate-1",
    "personal",
    {
      action: "archive_duplicate",
      status: "auto_applied",
      target_memory_id: "memory-1",
      related_memory_ids: ["memory-1"],
      proposed_title: "Merge preference",
      proposed_body:
        "Justin prefers direct local merge after verification when solo.",
      confidence: 0.96,
      rationale: "Same fact.",
      policy_reason:
        "duplicate or same-fact candidate does not need a new memory",
      metadata: { relationship: "same_fact" },
    },
  );

  assert.equal(id, "reconciliation-1");
  assert.deepEqual(client.calls[0], {
    table: "memory_reconciliations",
    operation: "insert",
    payload: {
      candidate_id: "candidate-1",
      context: "personal",
      action: "archive_duplicate",
      status: "auto_applied",
      target_memory_id: "memory-1",
      related_memory_ids: ["memory-1"],
      proposed_title: "Merge preference",
      proposed_body:
        "Justin prefers direct local merge after verification when solo.",
      confidence: 0.96,
      rationale: "Same fact.",
      policy_reason:
        "duplicate or same-fact candidate does not need a new memory",
      metadata: { relationship: "same_fact" },
    },
  });
});

Deno.test("markCandidateArchived archives candidate with reconciliation reason", async () => {
  const client = fakeSupabase({ id: "candidate-1" });

  await markCandidateArchived(
    client as never,
    "candidate-1",
    "duplicate of active memory memory-1",
  );

  assert.deepEqual(client.calls, [
    {
      table: "memory_candidates",
      operation: "update",
      payload: {
        status: "archived",
        metadata: { archive_reason: "duplicate of active memory memory-1" },
      },
    },
  ]);
});

Deno.test("applyMemoryUpdateFromReconciliation versions an existing memory", async () => {
  const client = fakeSupabase({
    id: "memory-1",
    title: "Old title",
    body: "Old body",
    confidence: 0.8,
    current_version: 1,
    metadata: { existing: true },
  });

  await applyMemoryUpdateFromReconciliation(client as never, {
    candidateId: "candidate-1",
    reconciliationId: "reconciliation-1",
    targetMemoryId: "memory-1",
    title: "New title",
    body: "New body",
    confidence: 0.94,
    changeReason: "reconciliation auto-update: safe high-confidence update",
    status: "auto_applied",
  });

  const lastVerifiedAt = (client.calls[0].payload as Record<string, unknown>)
    .last_verified_at;
  assert.equal(typeof lastVerifiedAt, "string");
  assert.deepEqual(client.calls, [
    {
      table: "memories",
      operation: "update",
      payload: {
        title: "New title",
        body: "New body",
        confidence: 0.94,
        current_version: 2,
        last_verified_at: lastVerifiedAt,
        metadata: {
          existing: true,
          updated_by: "memory_reconciliation",
          reconciliation_id: "reconciliation-1",
        },
      },
    },
    {
      table: "memory_versions",
      operation: "insert",
      payload: {
        memory_id: "memory-1",
        version: 2,
        title: "New title",
        body: "New body",
        change_reason:
          "reconciliation auto-update: safe high-confidence update",
        created_by: "memory_reconciliation",
      },
    },
    {
      table: "memory_candidates",
      operation: "update",
      payload: { status: "approved" },
    },
    {
      table: "memory_reconciliations",
      operation: "update",
      payload: { status: "auto_applied" },
    },
  ]);
});

Deno.test("promoteCandidate stores retrieval policy and first-class provenance", async () => {
  const client = fakeSupabase({ id: "candidate-1" });

  const memoryId = await promoteCandidate(
    client as never,
    "candidate-1",
    "personal",
    {
      candidate_type: "operating_rule",
      candidate_text: "Do not use local SOFIA vault files as boot fallback.",
      title: "Cloud memory is canonical",
      worthiness_score: 0.98,
      confidence: 0.99,
      risk_level: "low",
      recommended_action: "auto_promote",
      reasoning: "Stable operating rule.",
      entities: [],
      metadata: {
        source_type: "user_statement",
        captured_by: "agent",
        evidence_quote: "SOFIA Cloud/Postgres is canonical.",
      },
    },
    [0.1, 0.2],
  );

  assert.equal(memoryId, "memory-1");
  assert.deepEqual(client.calls, [
    {
      table: "memories",
      operation: "insert",
      payload: {
        context: "personal",
        memory_type: "operating_rule",
        title: "Cloud memory is canonical",
        body: "Do not use local SOFIA vault files as boot fallback.",
        embedding: [0.1, 0.2],
        confidence: 0.99,
        status: "active",
        created_from_candidate_id: "candidate-1",
        current_version: 1,
        retrieval_priority: 90,
        boot_context_eligible: true,
        activation_triggers: [],
        last_verified_at: null,
        metadata: {
          source_type: "user_statement",
          captured_by: "agent",
          evidence_quote: "SOFIA Cloud/Postgres is canonical.",
        },
      },
    },
    {
      table: "memory_versions",
      operation: "insert",
      payload: {
        memory_id: "memory-1",
        version: 1,
        title: "Cloud memory is canonical",
        body: "Do not use local SOFIA vault files as boot fallback.",
        change_reason: "initial auto-promotion from memory candidate",
        created_by: "sofia-pipeline",
      },
    },
    {
      table: "memory_provenance",
      operation: "insert",
      payload: {
        memory_id: "memory-1",
        candidate_id: "candidate-1",
        event_id: null,
        source_type: "user_statement",
        source_uri: null,
        source_ref: null,
        captured_by: "agent",
        captured_by_agent: null,
        confidence: 0.99,
        evidence_quote: "SOFIA Cloud/Postgres is canonical.",
        evidence_summary: "Stable operating rule.",
        observed_at: null,
        last_verified_at: null,
      },
    },
  ]);
});

Deno.test("createTodoFromCandidate stores todo workflow state instead of memory", async () => {
  const client = fakeSupabase({ id: "todo-1" });

  const todoId = await createTodoFromCandidate(client as never, {
    candidateId: "candidate-1",
    eventId: "event-1",
    context: "work",
    candidate: {
      candidate_type: "todo",
      candidate_text: "Follow up on SOFIA memory graph PR.",
      title: "Follow up on memory graph PR",
      worthiness_score: 0.8,
      confidence: 0.9,
      risk_level: "low",
      recommended_action: "review",
      reasoning: "Action item extracted from session.",
      entities: [],
      metadata: {
        owner: "Justin",
        priority: 80,
        due_at: "2026-06-05T12:00:00.000Z",
        project_entity_id: "11111111-1111-1111-1111-111111111111",
      },
    },
  });

  assert.equal(todoId, "todo-1");
  assert.deepEqual(client.calls, [
    {
      table: "todos",
      operation: "insert",
      payload: {
        title: "Follow up on memory graph PR",
        body: "Follow up on SOFIA memory graph PR.",
        status: "open",
        owner: "Justin",
        context: "work",
        project_entity_id: "11111111-1111-1111-1111-111111111111",
        source_event_id: "event-1",
        source_candidate_id: "candidate-1",
        source_memory_id: null,
        due_at: "2026-06-05T12:00:00.000Z",
        priority: 80,
        metadata: {
          owner: "Justin",
          priority: 80,
          due_at: "2026-06-05T12:00:00.000Z",
          project_entity_id: "11111111-1111-1111-1111-111111111111",
        },
      },
    },
  ]);
});

Deno.test("recordMemoryRetrievals writes usefulness telemetry rows", async () => {
  const client = fakeSupabase({ id: "retrieval-1" });

  await recordMemoryRetrievals(client as never, {
    query: "SOFIA memory graph",
    context: "work",
    sessionId: "session-1",
    agentName: "sofia",
    toolName: "search_memory",
    activationTrigger: "sofia",
    results: [
      { id: "memory-1", similarity: 0.88 },
      { id: "memory-2", similarity: 0.77 },
    ],
  });

  assert.deepEqual(client.calls, [
    {
      table: "memory_retrievals",
      operation: "insert",
      payload: [
        {
          memory_id: "memory-1",
          session_id: "session-1",
          agent_name: "sofia",
          tool_name: "search_memory",
          query: "SOFIA memory graph",
          retrieval_context: "work",
          activation_trigger: "sofia",
          rank: 1,
          similarity: 0.88,
          returned_in_boot_context: false,
        },
        {
          memory_id: "memory-2",
          session_id: "session-1",
          agent_name: "sofia",
          tool_name: "search_memory",
          query: "SOFIA memory graph",
          retrieval_context: "work",
          activation_trigger: "sofia",
          rank: 2,
          similarity: 0.77,
          returned_in_boot_context: false,
        },
      ],
    },
  ]);
});

Deno.test("markExpiredMemoriesStale disables stale active memories for boot context", async () => {
  const client = fakeSupabase({ id: "memory-1" });

  await markExpiredMemoriesStale(client as never, "2026-06-03T12:00:00.000Z");

  assert.deepEqual(client.calls, [
    {
      table: "memories",
      operation: "update",
      payload: {
        status: "stale",
        boot_context_eligible: false,
        review_reason:
          "memory lifecycle maintenance marked this memory stale because stale_after or expires_at passed",
      },
    },
  ]);
});

Deno.test("queueHighPriorityStaleMemoryReviews creates review candidates", async () => {
  const client = fakeSupabase({
    highPriorityStaleMemories: [
      {
        id: "memory-stale-1",
        context: "personal",
        memory_type: "operating_rule",
        title: "Old operating rule",
        body: "Use the old memory source.",
        retrieval_priority: 92,
        stale_after: "2026-06-01T00:00:00.000Z",
        expires_at: null,
        metadata: { existing: true },
      },
    ],
  });

  const queued = await queueHighPriorityStaleMemoryReviews(client as never);

  assert.deepEqual(queued, ["candidate-review-1"]);
  assert.deepEqual(client.calls, [
    {
      table: "events",
      operation: "insert",
      payload: {
        context: "personal",
        source: "lifecycle_maintenance",
        source_ref: "memory-stale-1",
        content:
          "High-priority memory needs freshness review: Old operating rule\n\nUse the old memory source.",
        embedding: null,
        sensitivity: "normal",
        metadata: {
          type_hint: "stale_memory_review",
          redaction_labels: [],
          source_memory_id: "memory-stale-1",
          memory_type: "operating_rule",
          retrieval_priority: 92,
          stale_after: "2026-06-01T00:00:00.000Z",
          expires_at: null,
        },
      },
    },
    {
      table: "memory_candidates",
      operation: "insert",
      payload: {
        event_id: "event-review-1",
        context: "personal",
        candidate_type: "open_loop",
        candidate_text:
          "Review high-priority stale memory 'Old operating rule' (memory-stale-1) and decide whether to verify, update, supersede, or archive it.",
        worthiness_score: 0.9,
        confidence: 0.85,
        risk_level: "medium",
        recommended_action: "review",
        reasoning:
          "Lifecycle maintenance found a boot-worthy or high-priority memory whose stale_after/expires_at timestamp has passed.",
        status: "pending_review",
        metadata: {
          title: "Review stale memory: Old operating rule",
          source_memory_id: "memory-stale-1",
          review_type: "stale_memory",
          memory_type: "operating_rule",
          retrieval_priority: 92,
          stale_after: "2026-06-01T00:00:00.000Z",
          expires_at: null,
        },
      },
    },
    {
      table: "memories",
      operation: "update",
      payload: {
        review_reason: "high-priority stale memory queued for review",
        metadata: {
          existing: true,
          stale_review_candidate_id: "candidate-review-1",
        },
      },
    },
  ]);
});

Deno.test("applyMemorySupersessionFromReconciliation creates replacement and supersedes old memory", async () => {
  const client = fakeSupabase({
    id: "memory-old",
    memory_type: "preference",
    embedding: [0.1, 0.2],
    current_version: 3,
    retrieval_priority: 75,
    boot_context_eligible: true,
    activation_triggers: ["sofia"],
    metadata: { existing: true },
  });

  const replacementId = await applyMemorySupersessionFromReconciliation(
    client as never,
    {
      candidateId: "candidate-1",
      reconciliationId: "reconciliation-1",
      targetMemoryId: "memory-old",
      context: "personal",
      title: "Updated preference",
      body: "Justin prefers direct local merge after verification when solo.",
      confidence: 0.97,
      changeReason: "safe high-confidence supersession",
    },
  );

  assert.equal(replacementId, "memory-1");
  const supersededAt = (client.calls[3].payload as Record<string, unknown>)
    .last_verified_at;
  assert.equal(typeof supersededAt, "string");
  assert.deepEqual(client.calls, [
    {
      table: "memories",
      operation: "insert",
      payload: {
        context: "personal",
        memory_type: "preference",
        title: "Updated preference",
        body: "Justin prefers direct local merge after verification when solo.",
        embedding: [0.1, 0.2],
        confidence: 0.97,
        status: "active",
        created_from_candidate_id: "candidate-1",
        current_version: 1,
        retrieval_priority: 75,
        boot_context_eligible: true,
        activation_triggers: ["sofia"],
        last_verified_at: supersededAt,
        metadata: {
          supersedes_memory_id: "memory-old",
          supersession_reconciliation_id: "reconciliation-1",
        },
      },
    },
    {
      table: "memory_versions",
      operation: "insert",
      payload: {
        memory_id: "memory-1",
        version: 1,
        title: "Updated preference",
        body: "Justin prefers direct local merge after verification when solo.",
        change_reason: "safe high-confidence supersession",
        created_by: "memory_reconciliation",
      },
    },
    {
      table: "memory_edges",
      operation: "insert",
      payload: {
        from_memory_id: "memory-1",
        to_memory_id: "memory-old",
        relation: "supersedes",
        metadata: { reconciliation_id: "reconciliation-1" },
      },
    },
    {
      table: "memories",
      operation: "update",
      payload: {
        status: "superseded",
        superseded_by_memory_id: "memory-1",
        boot_context_eligible: false,
        review_reason: "safe high-confidence supersession",
        last_verified_at: supersededAt,
        metadata: {
          existing: true,
          superseded_by: "memory-1",
          supersession_reconciliation_id: "reconciliation-1",
          superseded_at: supersededAt,
        },
      },
    },
    {
      table: "memory_candidates",
      operation: "update",
      payload: { status: "approved" },
    },
    {
      table: "memory_reconciliations",
      operation: "update",
      payload: { status: "auto_applied" },
    },
  ]);
});

Deno.test("recordMemoryFeedback updates retrieval usefulness feedback", async () => {
  const client = fakeSupabase({ id: "retrieval-1" });

  await recordMemoryFeedback(client as never, {
    retrievalId: "retrieval-1",
    wasUsed: true,
    wasHelpful: false,
    causedConfusion: true,
    feedback: "Superseded fact appeared in search results.",
  });

  assert.deepEqual(client.calls, [
    {
      table: "memory_retrievals",
      operation: "update",
      payload: {
        was_used: true,
        was_helpful: false,
        caused_confusion: true,
        feedback: "Superseded fact appeared in search results.",
      },
    },
  ]);
});
