import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
	CandidateInput,
	CandidateStatus,
	CaptureEventInput,
	EventSensitivity,
	MemoryType,
	RouteDecision,
	SofiaContext,
} from "./types.ts";

export function createServiceClient(): SupabaseClient {
	const url = Deno.env.get("SUPABASE_URL");
	const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
	if (!url || !key)
		throw new Error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
	return createClient(url, key);
}

export async function insertEvent(
	supabase: SupabaseClient,
	input: CaptureEventInput,
	content: string,
	sensitivity: EventSensitivity,
	embedding: number[] | null,
	redactionLabels: string[],
): Promise<string> {
	const { data, error } = await supabase
		.from("events")
		.insert({
			context: input.context,
			source: input.source,
			source_ref: input.source_ref ?? null,
			content,
			embedding,
			sensitivity,
			metadata: {
				...(input.metadata ?? {}),
				type_hint: input.type_hint ?? null,
				redaction_labels: redactionLabels,
			},
		})
		.select("id")
		.single();

	if (error) throw new Error(`insert event failed: ${error.message}`);
	return data.id as string;
}

export async function insertCandidate(
	supabase: SupabaseClient,
	eventId: string,
	context: string,
	candidate: CandidateInput,
	route: RouteDecision,
): Promise<string> {
	const { data, error } = await supabase
		.from("memory_candidates")
		.insert({
			event_id: eventId,
			context,
			candidate_type: candidate.candidate_type,
			candidate_text: candidate.candidate_text,
			worthiness_score: candidate.worthiness_score,
			confidence: candidate.confidence,
			risk_level: candidate.risk_level,
			recommended_action: route.action,
			reasoning: `${candidate.reasoning}\n\nRouting: ${route.reason}`,
			status: route.status satisfies CandidateStatus,
			metadata: {
				...candidate.metadata,
				title: candidate.title,
				entities: candidate.entities,
			},
		})
		.select("id")
		.single();

	if (error) throw new Error(`insert candidate failed: ${error.message}`);
	return data.id as string;
}

export async function promoteCandidate(
	supabase: SupabaseClient,
	candidateId: string,
	context: SofiaContext,
	candidate: CandidateInput,
	embedding: number[] | null,
): Promise<string> {
	const memoryType = candidate.candidate_type as MemoryType;
	const { data: memory, error: memoryError } = await supabase
		.from("memories")
		.insert({
			context,
			memory_type: memoryType,
			title: candidate.title,
			body: candidate.candidate_text,
			embedding,
			confidence: candidate.confidence,
			status: "active",
			created_from_candidate_id: candidateId,
			current_version: 1,
			metadata: candidate.metadata,
		})
		.select("id")
		.single();

	if (memoryError)
		throw new Error(`promote memory failed: ${memoryError.message}`);

	const memoryId = memory.id as string;
	const { error: versionError } = await supabase
		.from("memory_versions")
		.insert({
			memory_id: memoryId,
			version: 1,
			title: candidate.title,
			body: candidate.candidate_text,
			change_reason: "initial auto-promotion from memory candidate",
			created_by: "sofia-pipeline",
		});

	if (versionError)
		throw new Error(`insert memory version failed: ${versionError.message}`);
	return memoryId;
}

export async function archiveMemory(
	supabase: SupabaseClient,
	memoryId: string,
	reason?: string,
): Promise<Record<string, unknown>> {
	const { data: memory, error: loadError } = await supabase
		.from("memories")
		.select("id, metadata")
		.eq("id", memoryId)
		.single();

	if (loadError) throw new Error(`load memory failed: ${loadError.message}`);

	const metadata = {
		...((memory.metadata as Record<string, unknown> | null) ?? {}),
		archived_by: "archive_memory",
		...(reason ? { archive_reason: reason } : {}),
	};

	const { data, error } = await supabase
		.from("memories")
		.update({ status: "archived", metadata })
		.eq("id", memoryId)
		.select("*")
		.single();

	if (error) throw new Error(`archive memory failed: ${error.message}`);
	return data as Record<string, unknown>;
}

export async function promoteExistingCandidate(
	supabase: SupabaseClient,
	candidateId: string,
	embedding: number[] | null,
): Promise<string> {
	const { data: candidate, error: candidateError } = await supabase
		.from("memory_candidates")
		.select("*")
		.eq("id", candidateId)
		.single();

	if (candidateError)
		throw new Error(`load candidate failed: ${candidateError.message}`);

	const candidateType = candidate.candidate_type as string;
	if (candidateType === "todo" || candidateType === "open_loop") {
		throw new Error(
			`${candidateType} candidates are not promoted to durable memories`,
		);
	}

	const title =
		(candidate.metadata?.title as string | undefined) ?? candidateType;
	const { data: memory, error: memoryError } = await supabase
		.from("memories")
		.insert({
			context: candidate.context,
			memory_type: candidateType,
			title,
			body: candidate.candidate_text,
			embedding,
			confidence: candidate.confidence,
			status: "active",
			created_from_candidate_id: candidateId,
			current_version: 1,
			metadata: candidate.metadata ?? {},
		})
		.select("id")
		.single();

	if (memoryError)
		throw new Error(
			`promote existing candidate failed: ${memoryError.message}`,
		);

	const memoryId = memory.id as string;
	const { error: versionError } = await supabase
		.from("memory_versions")
		.insert({
			memory_id: memoryId,
			version: 1,
			title,
			body: candidate.candidate_text,
			change_reason: "human-approved promotion from review queue",
			created_by: "review_candidates",
		});

	if (versionError)
		throw new Error(
			`insert approved memory version failed: ${versionError.message}`,
		);

	const { error: updateError } = await supabase
		.from("memory_candidates")
		.update({ status: "approved" })
		.eq("id", candidateId);

	if (updateError)
		throw new Error(`mark candidate approved failed: ${updateError.message}`);
	return memoryId;
}
