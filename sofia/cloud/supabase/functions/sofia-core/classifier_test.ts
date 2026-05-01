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

Deno.test("parseClassifierResponse rejects out-of-range numeric values", () => {
	assert.throws(
		() =>
			parseClassifierResponse(
				JSON.stringify({
					candidates: [
						{
							candidate_type: "decision",
							candidate_text: "bad",
							title: "Bad",
							worthiness_score: 1.5,
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
