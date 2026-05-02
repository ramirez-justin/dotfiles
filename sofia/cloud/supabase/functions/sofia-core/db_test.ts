import assert from "node:assert/strict";
import {
	applyMemoryUpdateFromReconciliation,
	archiveMemory,
	insertReconciliation,
	markCandidateArchived,
	promoteExistingCandidate,
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
				update(payload: unknown) {
					operation = "update";
					calls.push({ table, operation, payload });
					return query;
				},
				async single() {
					if (table === "memory_candidates")
						return { data: record, error: null };
					if (table === "memory_reconciliations" && operation === "insert") {
						return { data: { id: "reconciliation-1" }, error: null };
					}
					if (table === "memories" && operation === "insert") {
						return { data: { id: "memory-1" }, error: null };
					}
					if (table === "memories") {
						return { data: { id: "memory-1", ...record }, error: null };
					}
					return { data: record, error: null };
				},
				then(resolve: (value: { error: null }) => void) {
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

	assert.deepEqual(client.calls, [
		{
			table: "memories",
			operation: "update",
			payload: {
				title: "New title",
				body: "New body",
				confidence: 0.94,
				current_version: 2,
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
