import { z } from "zod";
import type {
	CandidateInput,
	ReconciliationAction,
	ReconciliationDecision,
	ReconciliationJudgment,
	ReconciliationRelationship,
	ReconciliationStatus,
	SimilarMemory,
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

export function buildReconcilerPrompt(
	candidate: CandidateInput,
	memories: SimilarMemory[],
): string {
	return `You are SOFIA's memory reconciliation engine.

Decide how a new memory candidate relates to existing active memories. Return strict JSON only. Do not include markdown.

Allowed relationship values:
- new_memory
- exact_duplicate
- same_fact
- refinement
- updates_existing
- contradicts_existing
- merge_with_existing
- uncertain

Candidate:
${JSON.stringify(
	{
		type: candidate.candidate_type,
		title: candidate.title,
		body: candidate.candidate_text,
		entities: candidate.entities,
	},
	null,
	2,
)}

Existing active memories:
${JSON.stringify(
	memories.map((memory) => ({
		id: memory.id,
		context: memory.context,
		type: memory.memory_type,
		title: memory.title,
		body: memory.body,
		similarity: memory.similarity,
	})),
	null,
	2,
)}

Return this JSON shape:
{
  "relationship": "new_memory",
  "target_memory_id": "uuid when one primary target exists",
  "related_memory_ids": ["uuids"],
  "proposed_title": "title for updates or merges",
  "proposed_body": "body for updates or merges",
  "confidence": 0.0,
  "rationale": "brief explanation"
}`;
}

export function fallbackReconciliationDecision(
	candidate: CandidateInput,
	errorMessage: string,
): ReconciliationDecision {
	return {
		action: "review_update",
		status: "pending_review",
		related_memory_ids: [],
		proposed_title: candidate.title,
		proposed_body: candidate.candidate_text,
		confidence: 0,
		rationale: "Reconciliation failed before a safe decision could be made.",
		policy_reason: "reconciliation failed; candidate requires review",
		metadata: { reconciliation_error: errorMessage },
	};
}

export function alignReconciliationStatusWithRoute(
	decision: ReconciliationDecision,
	shouldPromote: boolean,
): ReconciliationDecision {
	if (decision.action !== "promote_new" || shouldPromote) return decision;
	return {
		...decision,
		status: "pending_review",
		policy_reason: `${decision.policy_reason}; candidate route requires manual promotion review`,
	};
}

export async function judgeReconciliation(
	candidate: CandidateInput,
	memories: SimilarMemory[],
	apiKey: string,
): Promise<ReconciliationJudgment> {
	if (memories.length === 0) {
		return {
			relationship: "new_memory",
			related_memory_ids: [],
			confidence: 1,
			rationale: "No similar active memories were retrieved.",
		};
	}

	const response = await fetch(
		"https://openrouter.ai/api/v1/chat/completions",
		{
			method: "POST",
			headers: {
				authorization: `Bearer ${apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: "openai/gpt-4.1-mini",
				messages: [
					{ role: "user", content: buildReconcilerPrompt(candidate, memories) },
				],
				response_format: { type: "json_object" },
				temperature: 0,
			}),
		},
	);

	if (!response.ok) {
		throw new Error(`reconciler request failed: ${response.status}`);
	}

	const payload = await response.json();
	const content = payload?.choices?.[0]?.message?.content;
	if (typeof content !== "string")
		throw new Error("reconciler returned no content");
	return parseReconcilerResponse(content);
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
