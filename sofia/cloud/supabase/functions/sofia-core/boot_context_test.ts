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
});
