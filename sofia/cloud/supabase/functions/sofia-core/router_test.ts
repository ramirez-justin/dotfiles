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

Deno.test("routeCandidate auto-promotes provenance-backed work project milestones", () => {
	const result = routeCandidate(
		candidate({
			candidate_type: "project_context",
			candidate_text:
				"Deployed migration 0004 and sofia-core version 28, fixed PostgREST RPC ambiguity with migration 0005.",
			title: "SOFIA Agent-Native Memory Deployment Follow-Up",
			worthiness_score: 0.8,
			confidence: 0.9,
			recommended_action: "review",
			metadata: {
				context: "work",
				project: "SOFIA Cloud",
				repo: "/Users/justinramirez/dev/dotfiles",
				branch: "feat/sofia-agent-native-memory",
				commit: "16933f3",
				redacted: false,
			},
		}),
	);

	assert.equal(result.shouldPromote, true);
	assert.equal(result.action, "auto_promote");
	assert.match(result.reason, /provenance-backed work milestone/);
});

Deno.test("routeCandidate reviews provenance-backed milestones in sensitive domains", () => {
	const result = routeCandidate(
		candidate({
			candidate_type: "project_context",
			candidate_text: "Updated property closing offer details for Jewel St.",
			worthiness_score: 0.9,
			confidence: 0.95,
			recommended_action: "review",
			metadata: {
				context: "work",
				project: "Jewel St",
				repo: "/Users/justinramirez/dev/dotfiles",
			},
		}),
	);

	assert.equal(result.shouldPromote, false);
	assert.equal(result.action, "review");
	assert.match(result.reason, /sensitive/);
});

Deno.test("routeCandidate archives transient progress without durable outcome", () => {
	const result = routeCandidate(
		candidate({
			candidate_type: "project_context",
			candidate_text: "Started investigating the GKE deployment issue and will check logs next.",
			title: "Started GKE investigation",
			worthiness_score: 0.72,
			confidence: 0.9,
			recommended_action: "review",
			metadata: { context: "work", project: "trading-platform" },
		}),
	);

	assert.equal(result.shouldPromote, false);
	assert.equal(result.action, "archive");
	assert.match(result.reason, /transient progress/);
});
