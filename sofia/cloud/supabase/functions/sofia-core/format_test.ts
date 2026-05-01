import assert from "node:assert/strict";
import { sanitizeRowForMcp, sanitizeRowsForMcp } from "./format.ts";

Deno.test("sanitizeRowsForMcp removes embeddings from response rows", () => {
	const rows = [
		{
			id: "event-1",
			content: "hello",
			embedding: [0.1, 0.2, 0.3],
			metadata: { keep: true },
		},
	];

	const sanitized = sanitizeRowsForMcp(rows);

	assert.deepEqual(sanitized, [
		{
			id: "event-1",
			content: "hello",
			metadata: { keep: true },
		},
	]);
	assert.equal("embedding" in sanitized[0], false);
});

Deno.test("sanitizeRowForMcp removes embeddings from a single response row", () => {
	const row = {
		id: "memory-1",
		status: "archived",
		embedding: [0.1, 0.2, 0.3],
	};

	assert.deepEqual(sanitizeRowForMcp(row), {
		id: "memory-1",
		status: "archived",
	});
});

Deno.test("sanitizeRowsForMcp leaves scalar RPC search results intact", () => {
	const rows = [
		{
			id: "memory-1",
			title: "A memory",
			similarity: 0.92,
		},
	];

	assert.deepEqual(sanitizeRowsForMcp(rows), rows);
});
