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
