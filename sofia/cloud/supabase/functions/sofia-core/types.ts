export type SofiaContext = "personal" | "work" | "shared";

export type EventSensitivity = "normal" | "private" | "secret_redacted";

export type CandidateType =
	| "fact"
	| "preference"
	| "decision"
	| "lesson"
	| "gotcha"
	| "project_context"
	| "person_context"
	| "operating_rule"
	| "todo"
	| "open_loop";

export type MemoryType = Exclude<CandidateType, "todo" | "open_loop">;

export type RiskLevel = "low" | "medium" | "high";
export type RecommendedAction =
	| "auto_promote"
	| "review"
	| "archive"
	| "reject";
export type CandidateStatus =
	| "pending_review"
	| "auto_promoted"
	| "approved"
	| "rejected"
	| "archived";

export type RedactionResult = {
	content: string;
	redacted: boolean;
	labels: string[];
};

export type CandidateInput = {
	candidate_type: CandidateType;
	candidate_text: string;
	title: string;
	worthiness_score: number;
	confidence: number;
	risk_level: RiskLevel;
	recommended_action: RecommendedAction;
	reasoning: string;
	entities: Array<{ type: string; name: string; evidence?: string }>;
	metadata: Record<string, unknown>;
};

export type RouteDecision = {
	action: RecommendedAction;
	status: CandidateStatus;
	shouldPromote: boolean;
	reason: string;
};

export type CaptureEventInput = {
	content: string;
	context: SofiaContext;
	source: string;
	source_ref?: string;
	type_hint?: string;
	metadata?: Record<string, unknown>;
};

export type BootContextRequest = {
	context: SofiaContext;
	force_refresh?: boolean;
};

export type BootContextResponse = {
	context: SofiaContext;
	content: string;
	generated_at: string;
	artifact_id: string | null;
	source: "compiled_artifacts" | "compiled_from_memories";
};

export type ReconciliationRelationship =
	| "new_memory"
	| "exact_duplicate"
	| "same_fact"
	| "refinement"
	| "updates_existing"
	| "contradicts_existing"
	| "merge_with_existing"
	| "uncertain";

export type ReconciliationAction =
	| "promote_new"
	| "archive_duplicate"
	| "update_existing"
	| "review_update"
	| "review_merge"
	| "review_conflict";

export type ReconciliationStatus =
	| "auto_applied"
	| "pending_review"
	| "approved"
	| "rejected"
	| "archived";

export type SimilarMemory = {
	id: string;
	context: SofiaContext;
	memory_type: MemoryType;
	title: string;
	body: string;
	similarity: number;
	created_at?: string;
};

export type ReconciliationJudgment = {
	relationship: ReconciliationRelationship;
	target_memory_id?: string;
	related_memory_ids: string[];
	proposed_title?: string;
	proposed_body?: string;
	confidence: number;
	rationale: string;
};

export type ReconciliationDecision = {
	action: ReconciliationAction;
	status: ReconciliationStatus;
	target_memory_id?: string;
	related_memory_ids: string[];
	proposed_title?: string;
	proposed_body?: string;
	confidence: number;
	rationale: string;
	policy_reason: string;
	metadata: Record<string, unknown>;
};
