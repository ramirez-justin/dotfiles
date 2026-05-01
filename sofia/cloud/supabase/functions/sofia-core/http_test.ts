import assert from "node:assert/strict";
import { shouldPatchMcpAcceptHeader } from "./http.ts";

Deno.test("shouldPatchMcpAcceptHeader patches POST requests missing SSE accept", () => {
	assert.equal(shouldPatchMcpAcceptHeader("POST", "application/json"), true);
});

Deno.test("shouldPatchMcpAcceptHeader does not patch GET browser requests", () => {
	assert.equal(shouldPatchMcpAcceptHeader("GET", "text/html"), false);
});

Deno.test("shouldPatchMcpAcceptHeader does not patch requests already accepting SSE", () => {
	assert.equal(
		shouldPatchMcpAcceptHeader("POST", "application/json, text/event-stream"),
		false,
	);
});
