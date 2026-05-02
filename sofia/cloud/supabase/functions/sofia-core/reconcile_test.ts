import assert from "node:assert/strict";
import {
	applyReconciliationPolicy,
	mapRelationshipToAction,
	parseReconcilerResponse,
} from "./reconcile.ts";
import type { CandidateInput, ReconciliationJudgment } from "./types.ts";

function candidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
	return {
		candidate_type: "preference",
		candidate_text:
			"Justin prefers direct local merge after verification when solo.",
		title: "Justin merge preference",
		worthiness_score: 0.9,
		confidence: 0.9,
		risk_level: "low",
		recommended_action: "auto_promote",
		reasoning: "Durable workflow preference.",
		entities: [],
		metadata: {},
		...overrides,
	};
}

function judgment(
	overrides: Partial<ReconciliationJudgment> = {},
): ReconciliationJudgment {
	return {
		relationship: "updates_existing",
		target_memory_id: "11111111-1111-1111-1111-111111111111",
		related_memory_ids: ["11111111-1111-1111-1111-111111111111"],
		proposed_title: "Justin workflow preference",
		proposed_body:
			"Justin prefers direct local merge after verification when solo.",
		confidence: 0.94,
		rationale: "Candidate refines an existing workflow preference.",
		...overrides,
	};
}

Deno.test("mapRelationshipToAction maps duplicates to archive", () => {
	assert.equal(mapRelationshipToAction("exact_duplicate"), "archive_duplicate");
	assert.equal(mapRelationshipToAction("same_fact"), "archive_duplicate");
});

Deno.test("mapRelationshipToAction maps updates and conflicts", () => {
	assert.equal(mapRelationshipToAction("new_memory"), "promote_new");
	assert.equal(mapRelationshipToAction("updates_existing"), "review_update");
	assert.equal(mapRelationshipToAction("refinement"), "review_update");
	assert.equal(
		mapRelationshipToAction("contradicts_existing"),
		"review_conflict",
	);
	assert.equal(mapRelationshipToAction("merge_with_existing"), "review_merge");
	assert.equal(mapRelationshipToAction("uncertain"), "review_update");
});

Deno.test("policy auto-applies safe high-confidence preference updates", () => {
	const result = applyReconciliationPolicy(candidate(), judgment());
	assert.equal(result.action, "update_existing");
	assert.equal(result.status, "auto_applied");
	assert.match(result.policy_reason, /safe high-confidence update/);
});

Deno.test("policy requires review for financial or property details", () => {
	const result = applyReconciliationPolicy(
		candidate({
			candidate_type: "fact",
			candidate_text: "Brookdale loan balance is about $110k.",
			title: "Brookdale loan balance",
		}),
		judgment({ confidence: 0.98 }),
	);
	assert.equal(result.action, "review_update");
	assert.equal(result.status, "pending_review");
	assert.match(result.policy_reason, /sensitive domain/);
});

Deno.test("policy requires review for person context", () => {
	const result = applyReconciliationPolicy(
		candidate({ candidate_type: "person_context" }),
		judgment({ confidence: 0.99 }),
	);
	assert.equal(result.action, "review_update");
	assert.equal(result.status, "pending_review");
});

Deno.test("policy archives exact duplicates", () => {
	const result = applyReconciliationPolicy(
		candidate(),
		judgment({ relationship: "exact_duplicate", confidence: 0.96 }),
	);
	assert.equal(result.action, "archive_duplicate");
	assert.equal(result.status, "auto_applied");
});

Deno.test("parseReconcilerResponse parses strict JSON", () => {
	const parsed = parseReconcilerResponse(
		JSON.stringify({
			relationship: "same_fact",
			target_memory_id: "11111111-1111-1111-1111-111111111111",
			related_memory_ids: ["11111111-1111-1111-1111-111111111111"],
			confidence: 0.93,
			rationale: "No meaningful change.",
		}),
	);
	assert.equal(parsed.relationship, "same_fact");
	assert.equal(parsed.confidence, 0.93);
});
