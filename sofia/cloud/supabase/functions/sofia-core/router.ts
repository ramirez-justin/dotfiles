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

const PROJECT_MILESTONE_TYPES = new Set(["project_context", "lesson", "fact"]);
const SENSITIVE_PATTERN =
	/\b(loan|mortgage|balance|rate|offer|closing|property|address|family|son|partner|medical|doctor|legal|lawyer|bank|salary|compensation|tax|hoa|secret|password|token|credential|dsn|api key|\$\d+)/i;
const TRANSIENT_PROGRESS_PATTERN =
	/\b(started|starting|currently|investigating|looking into|checking|will check|will do|next step|todo|to do|planning to|in progress)\b/i;
const DURABLE_OUTCOME_PATTERN =
	/\b(deployed|verified|fixed|resolved|completed|merged|pushed|released|applied|created|documented|proved|implemented|migrated|approved|scaled|rebuilt|ran|passed)\b/i;

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

	if (isTransientProgress(candidate)) {
		return {
			action: "archive",
			status: "archived",
			shouldPromote: false,
			reason: "transient progress without durable outcome should not enter review queue",
		};
	}

	if (isSensitiveDomain(candidate)) {
		return review("sensitive domain requires human review");
	}

	if (isSafeWorkMilestone(candidate)) {
		return {
			action: "auto_promote",
			status: "auto_promoted",
			shouldPromote: true,
			reason: "provenance-backed work milestone meets conservative auto-promotion policy",
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

function isSafeWorkMilestone(candidate: CandidateInput): boolean {
	return PROJECT_MILESTONE_TYPES.has(candidate.candidate_type) &&
		candidate.metadata?.context === "work" &&
		candidate.risk_level === "low" &&
		candidate.worthiness_score >= 0.7 &&
		candidate.confidence >= 0.85 &&
		hasProvenance(candidate) &&
		hasDurableOutcome(candidate);
}

function hasProvenance(candidate: CandidateInput): boolean {
	const metadata = candidate.metadata;
	return Boolean(
		metadata.project || metadata.repo || metadata.commit || metadata.branch ||
		metadata.issue || metadata.pr ||
		(Array.isArray(metadata.entities) && metadata.entities.length > 0) ||
		candidate.entities.length > 0,
	);
}

function hasDurableOutcome(candidate: CandidateInput): boolean {
	return DURABLE_OUTCOME_PATTERN.test(`${candidate.title}\n${candidate.candidate_text}`);
}

function isTransientProgress(candidate: CandidateInput): boolean {
	const text = `${candidate.title}\n${candidate.candidate_text}`;
	return TRANSIENT_PROGRESS_PATTERN.test(text) && !DURABLE_OUTCOME_PATTERN.test(text);
}

function isSensitiveDomain(candidate: CandidateInput): boolean {
	const text = `${candidate.title}\n${candidate.candidate_text}`;
	if (SENSITIVE_PATTERN.test(text)) return true;
	return candidate.entities.some((entity) => {
		const haystack = `${entity.type} ${entity.name} ${entity.evidence ?? ""}`;
		return /person|place|property|secret|credential/i.test(haystack);
	});
}
