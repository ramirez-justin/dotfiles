import type {
	CandidateInput,
	RecommendedAction,
	RouteDecision,
} from "./types.ts";

const AUTO_THRESHOLDS: Record<string, number | null> = {
	fact: 0.85,
	preference: 0.8,
	decision: 0.85,
	lesson: 0.8,
	gotcha: 0.8,
	project_context: 0.85,
	person_context: null,
	operating_rule: 0.9,
	todo: null,
	open_loop: null,
};

const REVIEW_THRESHOLDS: Record<string, number> = {
	fact: 0.7,
	preference: 0.6,
	decision: 0.65,
	lesson: 0.6,
	gotcha: 0.6,
	project_context: 0.65,
	person_context: 0.7,
	operating_rule: 0.7,
	todo: 0.5,
	open_loop: 0.5,
};

export function routeCandidate(candidate: CandidateInput): RouteDecision {
	const redacted = candidate.metadata?.redacted === true;

	if (redacted) {
		return review("redacted content requires human review");
	}

	if (candidate.risk_level !== "low") {
		return review(`${candidate.risk_level} risk requires human review`);
	}

	if (candidate.worthiness_score < 0.5) {
		return {
			action: "archive",
			status: "archived",
			shouldPromote: false,
			reason: "worthiness score below archive threshold",
		};
	}

	const autoThreshold = AUTO_THRESHOLDS[candidate.candidate_type];
	if (
		autoThreshold !== null &&
		candidate.worthiness_score >= autoThreshold &&
		candidate.confidence >= 0.8 &&
		candidate.recommended_action === "auto_promote"
	) {
		return {
			action: "auto_promote",
			status: "auto_promoted",
			shouldPromote: true,
			reason: `meets ${candidate.candidate_type} auto-promotion threshold`,
		};
	}

	const reviewThreshold = REVIEW_THRESHOLDS[candidate.candidate_type] ?? 0.7;
	if (candidate.worthiness_score >= reviewThreshold) {
		return review(
			"candidate meets review threshold but not auto-promotion policy",
		);
	}

	return {
		action: "archive",
		status: "archived",
		shouldPromote: false,
		reason: "candidate did not meet review threshold",
	};
}

function review(reason: string): RouteDecision {
	return {
		action: "review" satisfies RecommendedAction,
		status: "pending_review",
		shouldPromote: false,
		reason,
	};
}
