import assert from "node:assert/strict";
import {
	isBootContextRequest,
	parseBootContextParams,
	shouldPatchMcpAcceptHeader,
} from "./http.ts";

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

Deno.test("isBootContextRequest matches GET /boot-context only", () => {
	assert.equal(
		isBootContextRequest(
			"GET",
			"https://example.test/boot-context?context=personal",
		),
		true,
	);
	assert.equal(
		isBootContextRequest(
			"GET",
			"https://example.test/functions/v1/sofia-core/boot-context?context=personal",
		),
		true,
	);
	assert.equal(
		isBootContextRequest("POST", "https://example.test/boot-context"),
		false,
	);
	assert.equal(isBootContextRequest("GET", "https://example.test/"), false);
});

Deno.test("parseBootContextParams validates context and force_refresh", () => {
	assert.deepEqual(
		parseBootContextParams(
			"https://example.test/boot-context?context=work&force_refresh=true",
		),
		{ context: "work", force_refresh: true },
	);
	assert.deepEqual(
		parseBootContextParams("https://example.test/boot-context"),
		{
			context: "personal",
			force_refresh: false,
		},
	);
	assert.throws(
		() =>
			parseBootContextParams("https://example.test/boot-context?context=both"),
		/invalid boot context/,
	);
});
