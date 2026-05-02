import { z } from "zod";
import type {
	CandidateInput,
	ReconciliationAction,
	ReconciliationDecision,
	ReconciliationJudgment,
	ReconciliationRelationship,
	ReconciliationStatus,
} from "./types.ts";

const HIGH_CONFIDENCE_UPDATE = 0.92;
const SAFE_UPDATE_TYPES = new Set([
	"preference",
	"operating_rule",
	"lesson",
	"gotcha",
	"project_context",
]);
const SENSITIVE_PATTERN =
	/\b(loan|mortgage|balance|rate|offer|closing|property|address|family|son|partner|medical|doctor|legal|lawyer|bank|salary|compensation|tax|hoa|\$\d+)/i;

const ReconcilerSchema = z.object({
	relationship: z.enum([
		"new_memory",
		"exact_duplicate",
		"same_fact",
		"refinement",
		"updates_existing",
		"contradicts_existing",
		"merge_with_existing",
		"uncertain",
	]),
	target_memory_id: z.string().uuid().optional(),
	related_memory_ids: z.array(z.string().uuid()).default([]),
	proposed_title: z.string().optional(),
	proposed_body: z.string().optional(),
	confidence: z.number().min(0).max(1),
	rationale: z.string(),
});

export function parseReconcilerResponse(raw: string): ReconciliationJudgment {
	const parsed = JSON.parse(raw);
	return ReconcilerSchema.parse(parsed);
}

export function mapRelationshipToAction(
	relationship: ReconciliationRelationship,
): ReconciliationAction {
	switch (relationship) {
		case "new_memory":
			return "promote_new";
		case "exact_duplicate":
		case "same_fact":
			return "archive_duplicate";
		case "contradicts_existing":
			return "review_conflict";
		case "merge_with_existing":
			return "review_merge";
		case "refinement":
		case "updates_existing":
		case "uncertain":
			return "review_update";
	}
}

export function applyReconciliationPolicy(
	candidate: CandidateInput,
	judgment: ReconciliationJudgment,
): ReconciliationDecision {
	const baseAction = mapRelationshipToAction(judgment.relationship);
	const relatedIds =
		judgment.related_memory_ids.length > 0
			? judgment.related_memory_ids
			: judgment.target_memory_id
				? [judgment.target_memory_id]
				: [];

	if (baseAction === "promote_new") {
		return decision(
			"promote_new",
			"auto_applied",
			candidate,
			judgment,
			relatedIds,
			"reconciler found no related active memory",
		);
	}

	if (baseAction === "archive_duplicate") {
		return decision(
			"archive_duplicate",
			"auto_applied",
			candidate,
			judgment,
			relatedIds,
			"duplicate or same-fact candidate does not need a new memory",
		);
	}

	if (baseAction === "review_conflict" || baseAction === "review_merge") {
		return decision(
			baseAction,
			"pending_review",
			candidate,
			judgment,
			relatedIds,
			"conflicts and broad merges require review",
		);
	}

	if (candidate.metadata?.redacted === true) {
		return decision(
			"review_update",
			"pending_review",
			candidate,
			judgment,
			relatedIds,
			"redacted candidate requires review",
		);
	}

	if (candidate.risk_level !== "low") {
		return decision(
			"review_update",
			"pending_review",
			candidate,
			judgment,
			relatedIds,
			`${candidate.risk_level} risk candidate requires review`,
		);
	}

	if (candidate.candidate_type === "person_context") {
		return decision(
			"review_update",
			"pending_review",
			candidate,
			judgment,
			relatedIds,
			"person context updates require review",
		);
	}

	if (isSensitiveDomain(candidate)) {
		return decision(
			"review_update",
			"pending_review",
			candidate,
			judgment,
			relatedIds,
			"sensitive domain updates require review",
		);
	}

	if (!SAFE_UPDATE_TYPES.has(candidate.candidate_type)) {
		return decision(
			"review_update",
			"pending_review",
			candidate,
			judgment,
			relatedIds,
			`${candidate.candidate_type} updates require review`,
		);
	}

	if (!judgment.target_memory_id) {
		return decision(
			"review_update",
			"pending_review",
			candidate,
			judgment,
			relatedIds,
			"update relationship did not identify a target memory",
		);
	}

	if (judgment.confidence < HIGH_CONFIDENCE_UPDATE) {
		return decision(
			"review_update",
			"pending_review",
			candidate,
			judgment,
			relatedIds,
			"reconciliation confidence below auto-update threshold",
		);
	}

	return decision(
		"update_existing",
		"auto_applied",
		candidate,
		judgment,
		relatedIds,
		"safe high-confidence update may be applied automatically",
	);
}

function isSensitiveDomain(candidate: CandidateInput): boolean {
	const text = `${candidate.title}\n${candidate.candidate_text}`;
	if (SENSITIVE_PATTERN.test(text)) return true;
	return candidate.entities.some(
		(entity) =>
			["person", "place"].includes(entity.type.toLowerCase()) &&
			/family|son|partner|address|property/i.test(
				`${entity.name} ${entity.evidence ?? ""}`,
			),
	);
}

function decision(
	action: ReconciliationAction,
	status: ReconciliationStatus,
	candidate: CandidateInput,
	judgment: ReconciliationJudgment,
	relatedMemoryIds: string[],
	policyReason: string,
): ReconciliationDecision {
	return {
		action,
		status,
		target_memory_id: judgment.target_memory_id,
		related_memory_ids: relatedMemoryIds,
		proposed_title: judgment.proposed_title ?? candidate.title,
		proposed_body: judgment.proposed_body ?? candidate.candidate_text,
		confidence: judgment.confidence,
		rationale: judgment.rationale,
		policy_reason: policyReason,
		metadata: { relationship: judgment.relationship },
	};
}
