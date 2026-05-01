import assert from "node:assert/strict";
import { routeCandidate } from "./router.ts";
import type { CandidateInput } from "./types.ts";

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
	return {
		candidate_type: "decision",
		candidate_text: "SOFIA should use Supabase as the first cloud runtime.",
		title: "Use Supabase first",
		worthiness_score: 0.9,
		confidence: 0.9,
		risk_level: "low",
		recommended_action: "auto_promote",
		reasoning: "Explicit durable architecture decision.",
		entities: [],
		metadata: {},
		...overrides,
	};
}

Deno.test("routeCandidate auto-promotes high-confidence low-risk decisions", () => {
	const result = routeCandidate(candidate());
	assert.equal(result.shouldPromote, true);
	assert.equal(result.action, "auto_promote");
	assert.equal(result.status, "auto_promoted");
});

Deno.test("routeCandidate sends medium confidence to review", () => {
	const result = routeCandidate(candidate({ confidence: 0.7 }));
	assert.equal(result.shouldPromote, false);
	assert.equal(result.action, "review");
	assert.equal(result.status, "pending_review");
});

Deno.test("routeCandidate never auto-promotes person_context", () => {
	const result = routeCandidate(
		candidate({
			candidate_type: "person_context",
			worthiness_score: 0.99,
			confidence: 0.99,
		}),
	);
	assert.equal(result.shouldPromote, false);
	assert.equal(result.action, "review");
});

Deno.test("routeCandidate never auto-promotes redacted candidates", () => {
	const result = routeCandidate(candidate({ metadata: { redacted: true } }));
	assert.equal(result.shouldPromote, false);
	assert.equal(result.action, "review");
});

Deno.test("routeCandidate archives low-worthiness candidates", () => {
	const result = routeCandidate(
		candidate({ worthiness_score: 0.3, confidence: 0.9 }),
	);
	assert.equal(result.shouldPromote, false);
	assert.equal(result.action, "archive");
	assert.equal(result.status, "archived");
});
