import assert from "node:assert/strict";
import { parseClassifierResponse } from "./classifier.ts";

Deno.test("parseClassifierResponse parses valid candidate JSON", () => {
	const parsed = parseClassifierResponse(
		JSON.stringify({
			candidates: [
				{
					candidate_type: "decision",
					candidate_text: "SOFIA should use Supabase first.",
					title: "Use Supabase first",
					worthiness_score: 0.91,
					confidence: 0.88,
					risk_level: "low",
					recommended_action: "auto_promote",
					reasoning: "Explicit durable decision.",
					entities: [{ type: "system", name: "SOFIA" }],
					metadata: { source_kind: "architecture" },
				},
			],
		}),
	);

	assert.equal(parsed.length, 1);
	assert.equal(parsed[0].candidate_type, "decision");
	assert.equal(parsed[0].worthiness_score, 0.91);
});

Deno.test("parseClassifierResponse rejects unknown candidate types", () => {
	assert.throws(
		() =>
			parseClassifierResponse(
				JSON.stringify({
					candidates: [
						{
							candidate_type: "vibe",
							candidate_text: "bad",
							title: "Bad",
							worthiness_score: 0.9,
							confidence: 0.9,
							risk_level: "low",
							recommended_action: "auto_promote",
							reasoning: "bad",
							entities: [],
							metadata: {},
						},
					],
				}),
			),
		/invalid classifier response/,
	);
});

Deno.test("parseClassifierResponse repairs common model formatting mistakes", () => {
	const parsed = parseClassifierResponse(
		JSON.stringify({
			candidates: [
				{
					candidate_type: "preference",
					candidate_text: "SOFIA prefers remote MCP capture.",
					title: "Prefer remote MCP capture",
					worthiness_score: 9,
					confidence: 90,
					risk_level: "low",
					recommended_action: "Auto-promote as durable memory.",
					reasoning: "Explicit preference.",
					entities: [{ type: "system" }, { name: "SOFIA" }],
					metadata: {},
				},
			],
		}),
	);

	assert.equal(parsed[0].worthiness_score, 0.9);
	assert.equal(parsed[0].confidence, 0.9);
	assert.equal(parsed[0].recommended_action, "auto_promote");
	assert.deepEqual(parsed[0].entities, []);
});

Deno.test("parseClassifierResponse repairs generic event candidate type", () => {
	const parsed = parseClassifierResponse(
		JSON.stringify({
			candidates: [
				{
					candidate_type: "event",
					candidate_text:
						"SOFIA cloud was merged into main after verification.",
					title: "SOFIA cloud merged",
					worthiness_score: 0.9,
					confidence: 0.9,
					risk_level: "low",
					recommended_action: "auto_promote",
					reasoning: "Project status update.",
					entities: [],
					metadata: {},
				},
			],
		}),
	);

	assert.equal(parsed[0].candidate_type, "fact");
});

Deno.test("parseClassifierResponse normalizes verbose promote recommendation", () => {
	const parsed = parseClassifierResponse(
		JSON.stringify({
			candidates: [
				{
					candidate_type: "decision",
					candidate_text:
						"SOFIA Cloud should provide boot context directly to Pi.",
					title: "Use SOFIA Cloud boot context",
					worthiness_score: 0.91,
					confidence: 0.9,
					risk_level: "low",
					recommended_action: "Promote to durable memory.",
					reasoning: "Explicit architecture decision.",
					entities: [],
					metadata: {},
				},
			],
		}),
	);

	assert.equal(parsed[0].recommended_action, "auto_promote");
});

Deno.test("parseClassifierResponse normalizes review/archive/reject phrases", () => {
	const actions = [
		["Needs review by Justin", "review"],
		["Archive this low value note", "archive"],
		["Discard / reject", "reject"],
	] as const;

	for (const [rawAction, expected] of actions) {
		const parsed = parseClassifierResponse(
			JSON.stringify({
				candidates: [
					{
						candidate_type: "fact",
						candidate_text: `Action should normalize: ${rawAction}`,
						title: "Normalize action",
						worthiness_score: 0.75,
						confidence: 0.8,
						risk_level: "low",
						recommended_action: rawAction,
						reasoning: "Parser hardening test.",
						entities: [],
						metadata: {},
					},
				],
			}),
		);

		assert.equal(parsed[0].recommended_action, expected);
	}
});
