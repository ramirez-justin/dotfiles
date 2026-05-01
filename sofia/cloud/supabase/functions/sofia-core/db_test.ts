import assert from "node:assert/strict";
import { promoteExistingCandidate } from "./db.ts";

type TableCall = { table: string; operation: string; payload?: unknown };

function fakeSupabase(candidate: Record<string, unknown>) {
	const calls: TableCall[] = [];
	const client = {
		calls,
		from(table: string) {
			const query = {
				insert(payload: unknown) {
					calls.push({ table, operation: "insert", payload });
					return query;
				},
				select(_columns?: string) {
					return query;
				},
				eq(_column: string, _value: unknown) {
					return query;
				},
				update(payload: unknown) {
					calls.push({ table, operation: "update", payload });
					return query;
				},
				async single() {
					if (table === "memory_candidates")
						return { data: candidate, error: null };
					if (table === "memories")
						return { data: { id: "memory-1" }, error: null };
					return { data: null, error: null };
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
