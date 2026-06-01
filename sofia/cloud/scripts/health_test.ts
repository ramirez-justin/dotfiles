import assert from "node:assert/strict";
import {
	buildSofiaEndpoint,
	classifyEdgeStatus,
	formatCheck,
	parseProjectStatus,
} from "./health.ts";

Deno.test("parseProjectStatus returns status for matching ref", () => {
	const status = parseProjectStatus(
		JSON.stringify([
			{ ref: "other", status: "ACTIVE_HEALTHY" },
			{ id: "avgjtkgppeeihntsyjpy", status: "RESTORING" },
		]),
		"avgjtkgppeeihntsyjpy",
	);

	assert.equal(status, "RESTORING");
});

Deno.test("parseProjectStatus returns null for missing or invalid output", () => {
	assert.equal(parseProjectStatus("not json", "ref"), null);
	assert.equal(parseProjectStatus(JSON.stringify([{ ref: "other" }]), "ref"), null);
});

Deno.test("classifyEdgeStatus accepts expected unauthenticated auth failures", () => {
	assert.deepEqual(classifyEdgeStatus(401), {
		ok: true,
		message: "reachable; authentication required",
	});
	assert.deepEqual(classifyEdgeStatus(403), {
		ok: true,
		message: "reachable; authentication required",
	});
});

Deno.test("classifyEdgeStatus identifies restore and unavailable responses", () => {
	assert.deepEqual(classifyEdgeStatus(521), {
		ok: false,
		message: "Cloudflare 521; project may still be restoring",
	});
	assert.deepEqual(classifyEdgeStatus(503), {
		ok: false,
		message: "unexpected HTTP 503",
	});
});

Deno.test("formatCheck renders machine-scannable status lines", () => {
	assert.equal(formatCheck("ok", "dns", "resolved"), "[ok] dns: resolved");
	assert.equal(formatCheck("fail", "dns", "NXDOMAIN"), "[fail] dns: NXDOMAIN");
});

Deno.test("buildSofiaEndpoint builds the Edge Function URL", () => {
	assert.equal(
		buildSofiaEndpoint("avgjtkgppeeihntsyjpy"),
		"https://avgjtkgppeeihntsyjpy.supabase.co/functions/v1/sofia-core",
	);
});
