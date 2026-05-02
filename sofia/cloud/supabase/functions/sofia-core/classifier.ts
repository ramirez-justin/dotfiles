import { z } from "zod";
import type { CandidateInput, CaptureEventInput } from "./types.ts";

const CandidateSchema = z.object({
	candidate_type: z.enum([
		"fact",
		"preference",
		"decision",
		"lesson",
		"gotcha",
		"project_context",
		"person_context",
		"operating_rule",
		"todo",
		"open_loop",
	]),
	candidate_text: z.string().min(1),
	title: z.string().min(1),
	worthiness_score: z.number().min(0).max(1),
	confidence: z.number().min(0).max(1),
	risk_level: z.enum(["low", "medium", "high"]),
	recommended_action: z.enum(["auto_promote", "review", "archive", "reject"]),
	reasoning: z.string().min(1),
	entities: z
		.array(
			z.object({
				type: z.string().min(1),
				name: z.string().min(1),
				evidence: z.string().optional(),
			}),
		)
		.default([]),
	metadata: z.record(z.unknown()).default({}),
});

const ClassifierResponseSchema = z.object({
	candidates: z.array(CandidateSchema),
});

export function parseClassifierResponse(raw: string): CandidateInput[] {
	try {
		const json = normalizeClassifierResponse(JSON.parse(raw));
		const parsed = ClassifierResponseSchema.parse(json);
		return parsed.candidates;
	} catch (error) {
		throw new Error(`invalid classifier response: ${String(error)}`);
	}
}

function normalizeClassifierResponse(json: unknown): unknown {
	if (!json || typeof json !== "object") return json;
	const response = json as { candidates?: unknown };
	if (!Array.isArray(response.candidates)) return json;

	return {
		...response,
		candidates: response.candidates.map((candidate) => {
			if (!candidate || typeof candidate !== "object") return candidate;
			const record = candidate as Record<string, unknown>;
			return {
				...record,
				candidate_type: normalizeCandidateType(record.candidate_type),
				worthiness_score: normalizeScore(record.worthiness_score),
				confidence: normalizeScore(record.confidence),
				recommended_action: normalizeRecommendedAction(
					record.recommended_action,
				),
				entities: normalizeEntities(record.entities),
			};
		}),
	};
}

function normalizeCandidateType(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const normalized = value
		.toLowerCase()
		.trim()
		.replaceAll(/[\s-]+/g, "_");
	const candidateTypes = new Set([
		"fact",
		"preference",
		"decision",
		"lesson",
		"gotcha",
		"project_context",
		"person_context",
		"operating_rule",
		"todo",
		"open_loop",
	]);
	if (candidateTypes.has(normalized)) return normalized;
	if (["personal_preference", "user_preference"].includes(normalized)) {
		return "preference";
	}
	if (
		["event", "note", "memory", "system_memory", "purchase"].includes(
			normalized,
		)
	) {
		return "fact";
	}
	if (["operational_guideline", "guideline", "rule"].includes(normalized)) {
		return "operating_rule";
	}
	if (["work_memory", "project_memory"].includes(normalized)) {
		return "project_context";
	}
	return value;
}

function normalizeScore(value: unknown): unknown {
	if (typeof value !== "number" || Number.isNaN(value)) return value;
	if (value > 10 && value <= 100) return value / 100;
	if (value > 1 && value <= 10) return value / 10;
	return Math.max(0, Math.min(1, value));
}

function normalizeRecommendedAction(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const normalized = value
		.toLowerCase()
		.trim()
		.replaceAll(/[\s-]+/g, "_")
		.replaceAll(/[^a-z_]/g, "");

	if (normalized === "auto_promote") return "auto_promote";
	if (
		normalized.includes("promote") ||
		normalized.includes("remember") ||
		normalized.includes("save") ||
		normalized.includes("store")
	) {
		return "auto_promote";
	}
	if (
		normalized.includes("review") ||
		normalized.includes("ask_user") ||
		normalized.includes("needs_review")
	) {
		return "review";
	}
	if (normalized.includes("archive") || normalized.includes("ignore")) {
		return "archive";
	}
	if (normalized.includes("reject") || normalized.includes("discard")) {
		return "reject";
	}
	return value;
}

function normalizeEntities(value: unknown): unknown {
	if (!Array.isArray(value)) return value;
	return value.flatMap((entity) => {
		if (!entity || typeof entity !== "object") return [];
		const record = entity as Record<string, unknown>;
		const type = record.type;
		const name = record.name;
		if (typeof type !== "string" || typeof name !== "string") return [];
		return [{ ...record, type, name }];
	});
}

export async function classifyEvent(
	input: CaptureEventInput,
	apiKey: string,
): Promise<CandidateInput[]> {
	const response = await fetch(
		"https://openrouter.ai/api/v1/chat/completions",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				response_format: { type: "json_object" },
				temperature: 0.1,
				messages: [
					{
						role: "system",
						content: `You are SOFIA's memory-worthiness classifier. Extract zero or more durable memory candidates from the user's event. Return only JSON with a top-level candidates array. Each candidate must include candidate_type, candidate_text, title, worthiness_score, confidence, risk_level, recommended_action, reasoning, entities, and metadata. Auto-promotion is only appropriate for explicit, low-risk, durable memories. Secrets, sensitive content, inferred identity claims, and person_context require review.`,
					},
					{
						role: "user",
						content: JSON.stringify({
							context: input.context,
							source: input.source,
							type_hint: input.type_hint ?? null,
							metadata: input.metadata ?? {},
							content: input.content,
						}),
					},
				],
			}),
		},
	);

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`classifier request failed: ${response.status} ${body}`);
	}

	const data = await response.json();
	const content = data?.choices?.[0]?.message?.content;
	if (typeof content !== "string") {
		throw new Error("classifier response missing message content");
	}
	return parseClassifierResponse(content);
}

export async function embedText(
	text: string,
	apiKey: string,
): Promise<number[]> {
	const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "openai/text-embedding-3-small",
			input: text,
		}),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`embedding request failed: ${response.status} ${body}`);
	}

	const data = await response.json();
	const embedding = data?.data?.[0]?.embedding;
	if (!Array.isArray(embedding)) {
		throw new Error("embedding response missing vector");
	}
	return embedding.map(Number);
}
