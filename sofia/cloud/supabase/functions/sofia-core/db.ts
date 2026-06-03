import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  CandidateInput,
  CandidateStatus,
  CaptureEventInput,
  EventSensitivity,
  MemoryType,
  ProvenanceSourceType,
  ReconciliationDecision,
  RouteDecision,
  SimilarMemory,
  SofiaContext,
} from "./types.ts";

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key);
}

const DEFAULT_ACTIVATION_TRIGGERS: string[] = [];
const DEFAULT_SOURCE_TYPE: ProvenanceSourceType = "agent_capture";

function retrievalPriorityForType(memoryType: MemoryType): number {
  switch (memoryType) {
    case "operating_rule":
      return 90;
    case "preference":
      return 75;
    case "decision":
      return 70;
    case "project_context":
      return 65;
    case "lesson":
    case "gotcha":
      return 60;
    default:
      return 50;
  }
}

function stringMeta(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberMeta(
  metadata: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sourceTypeFromMetadata(
  metadata: Record<string, unknown>,
): ProvenanceSourceType {
  const value = metadata.source_type;
  const allowed = new Set<ProvenanceSourceType>([
    "session",
    "user_statement",
    "agent_capture",
    "automation",
    "repo",
    "issue",
    "pr",
    "doc",
    "email",
    "calendar",
    "external_api",
    "manual_review",
  ]);
  return typeof value === "string" && allowed.has(value as ProvenanceSourceType)
    ? (value as ProvenanceSourceType)
    : DEFAULT_SOURCE_TYPE;
}

async function insertMemoryProvenance(
  supabase: SupabaseClient,
  input: {
    memoryId: string;
    candidateId?: string | null;
    eventId?: string | null;
    candidate?: CandidateInput;
    confidence: number;
    changeReason?: string;
    createdBy?: string;
  },
): Promise<void> {
  const metadata = input.candidate?.metadata ?? {};
  const sourceType = input.createdBy === "review_candidates"
    ? "manual_review"
    : sourceTypeFromMetadata(metadata);
  const { error } = await supabase.from("memory_provenance").insert({
    memory_id: input.memoryId,
    candidate_id: input.candidateId ?? null,
    event_id: input.eventId ?? null,
    source_type: sourceType,
    source_uri: stringMeta(metadata, "source_uri"),
    source_ref: stringMeta(metadata, "source_ref"),
    captured_by: stringMeta(metadata, "captured_by") ?? "agent",
    captured_by_agent: stringMeta(metadata, "captured_by_agent"),
    confidence: input.confidence,
    evidence_quote: stringMeta(metadata, "evidence_quote"),
    evidence_summary: input.changeReason ?? input.candidate?.reasoning ?? null,
    observed_at: stringMeta(metadata, "observed_at"),
    last_verified_at: stringMeta(metadata, "last_verified_at"),
  });
  if (error) {
    throw new Error(`insert memory provenance failed: ${error.message}`);
  }
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
      retrieval_priority: retrievalPriorityForType(memoryType),
      boot_context_eligible: true,
      activation_triggers: DEFAULT_ACTIVATION_TRIGGERS,
      last_verified_at: stringMeta(candidate.metadata, "last_verified_at"),
      metadata: candidate.metadata,
    })
    .select("id")
    .single();

  if (memoryError) {
    throw new Error(`promote memory failed: ${memoryError.message}`);
  }

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

  if (versionError) {
    throw new Error(`insert memory version failed: ${versionError.message}`);
  }

  await insertMemoryProvenance(supabase, {
    memoryId,
    candidateId,
    candidate,
    confidence: candidate.confidence,
    changeReason: candidate.reasoning,
  });
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

export async function findSimilarMemories(
  supabase: SupabaseClient,
  embedding: number[],
  context: SofiaContext,
  limit = 5,
  threshold = 0.72,
): Promise<SimilarMemory[]> {
  const contexts = context === "shared" ? ["shared"] : [context, "shared"];
  const results: SimilarMemory[] = [];

  for (const searchContext of contexts) {
    const { data, error } = await supabase.rpc("match_memories", {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit,
      filter_context: searchContext,
      include_archived: false,
    });
    if (error) {
      throw new Error(`find similar memories failed: ${error.message}`);
    }
    results.push(...((data ?? []) as SimilarMemory[]));
  }

  const byId = new Map<string, SimilarMemory>();
  for (const memory of results) {
    const existing = byId.get(memory.id);
    if (!existing || memory.similarity > existing.similarity) {
      byId.set(memory.id, memory);
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export async function insertReconciliation(
  supabase: SupabaseClient,
  candidateId: string,
  context: SofiaContext,
  decision: ReconciliationDecision,
): Promise<string> {
  const { data, error } = await supabase
    .from("memory_reconciliations")
    .insert({
      candidate_id: candidateId,
      context,
      action: decision.action,
      status: decision.status,
      target_memory_id: decision.target_memory_id ?? null,
      related_memory_ids: decision.related_memory_ids,
      proposed_title: decision.proposed_title ?? null,
      proposed_body: decision.proposed_body ?? null,
      confidence: decision.confidence,
      rationale: decision.rationale,
      policy_reason: decision.policy_reason,
      metadata: decision.metadata,
    })
    .select("id")
    .single();

  if (error) throw new Error(`insert reconciliation failed: ${error.message}`);
  return data.id as string;
}

export async function markCandidateArchived(
  supabase: SupabaseClient,
  candidateId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from("memory_candidates")
    .update({ status: "archived", metadata: { archive_reason: reason } })
    .eq("id", candidateId);
  if (error) throw new Error(`archive candidate failed: ${error.message}`);
}

export async function applyMemoryUpdateFromReconciliation(
  supabase: SupabaseClient,
  input: {
    candidateId: string;
    reconciliationId: string;
    targetMemoryId: string;
    title: string;
    body: string;
    confidence: number;
    changeReason: string;
    status: "auto_applied" | "approved";
  },
): Promise<string> {
  const { data: memory, error: loadError } = await supabase
    .from("memories")
    .select("id, current_version, metadata, memory_type, embedding, retrieval_priority, boot_context_eligible, activation_triggers")
    .eq("id", input.targetMemoryId)
    .single();
  if (loadError) {
    throw new Error(`load target memory failed: ${loadError.message}`);
  }

  const nextVersion = ((memory.current_version as number | null) ?? 1) + 1;
  const metadata = {
    ...((memory.metadata as Record<string, unknown> | null) ?? {}),
    updated_by: "memory_reconciliation",
    reconciliation_id: input.reconciliationId,
  };

  const { error: updateError } = await supabase
    .from("memories")
    .update({
      title: input.title,
      body: input.body,
      confidence: input.confidence,
      current_version: nextVersion,
      last_verified_at: new Date().toISOString(),
      metadata,
    })
    .eq("id", input.targetMemoryId);
  if (updateError) {
    throw new Error(`update memory failed: ${updateError.message}`);
  }

  const { error: versionError } = await supabase
    .from("memory_versions")
    .insert({
      memory_id: input.targetMemoryId,
      version: nextVersion,
      title: input.title,
      body: input.body,
      change_reason: input.changeReason,
      created_by: "memory_reconciliation",
    });
  if (versionError) {
    throw new Error(`insert memory version failed: ${versionError.message}`);
  }

  const { error: candidateError } = await supabase
    .from("memory_candidates")
    .update({ status: "approved" })
    .eq("id", input.candidateId);
  if (candidateError) {
    throw new Error(
      `mark candidate approved failed: ${candidateError.message}`,
    );
  }

  const { error: reconciliationError } = await supabase
    .from("memory_reconciliations")
    .update({ status: input.status })
    .eq("id", input.reconciliationId);
  if (reconciliationError) {
    throw new Error(
      `mark reconciliation applied failed: ${reconciliationError.message}`,
    );
  }

  return input.targetMemoryId;
}

export async function applyMemorySupersessionFromReconciliation(
  supabase: SupabaseClient,
  input: {
    candidateId: string;
    reconciliationId: string;
    targetMemoryId: string;
    context: SofiaContext;
    title: string;
    body: string;
    confidence: number;
    changeReason: string;
    status?: "auto_applied" | "approved";
  },
): Promise<string> {
  const { data: oldMemory, error: loadError } = await supabase
    .from("memories")
    .select(
      "id, memory_type, embedding, metadata, retrieval_priority, boot_context_eligible, activation_triggers",
    )
    .eq("id", input.targetMemoryId)
    .single();
  if (loadError) {
    throw new Error(`load target memory failed: ${loadError.message}`);
  }

  const supersededAt = new Date().toISOString();
  const { data: replacement, error: insertError } = await supabase
    .from("memories")
    .insert({
      context: input.context,
      memory_type: oldMemory.memory_type as string,
      title: input.title,
      body: input.body,
      embedding: oldMemory.embedding ?? null,
      confidence: input.confidence,
      status: "active",
      created_from_candidate_id: input.candidateId,
      current_version: 1,
      retrieval_priority: (oldMemory.retrieval_priority as number | null) ??
        retrievalPriorityForType(oldMemory.memory_type as MemoryType),
      boot_context_eligible:
        (oldMemory.boot_context_eligible as boolean | null) ?? true,
      activation_triggers:
        (oldMemory.activation_triggers as string[] | null) ??
          DEFAULT_ACTIVATION_TRIGGERS,
      last_verified_at: supersededAt,
      metadata: {
        supersedes_memory_id: input.targetMemoryId,
        supersession_reconciliation_id: input.reconciliationId,
      },
    })
    .select("id")
    .single();
  if (insertError) {
    throw new Error(`insert superseding memory failed: ${insertError.message}`);
  }

  const replacementId = replacement.id as string;
  const { error: versionError } = await supabase
    .from("memory_versions")
    .insert({
      memory_id: replacementId,
      version: 1,
      title: input.title,
      body: input.body,
      change_reason: input.changeReason,
      created_by: "memory_reconciliation",
    });
  if (versionError) {
    throw new Error(`insert superseding memory version failed: ${versionError.message}`);
  }

  const { error: edgeError } = await supabase
    .from("memory_edges")
    .insert({
      from_memory_id: replacementId,
      to_memory_id: input.targetMemoryId,
      relation: "supersedes",
      metadata: { reconciliation_id: input.reconciliationId },
    });
  if (edgeError) {
    throw new Error(`insert supersession edge failed: ${edgeError.message}`);
  }

  const oldMetadata =
    (oldMemory.metadata as Record<string, unknown> | null) ?? {};
  const { error: supersedeError } = await supabase
    .from("memories")
    .update({
      status: "superseded",
      superseded_by_memory_id: replacementId,
      boot_context_eligible: false,
      review_reason: input.changeReason,
      last_verified_at: supersededAt,
      metadata: {
        ...oldMetadata,
        superseded_by: replacementId,
        supersession_reconciliation_id: input.reconciliationId,
        superseded_at: supersededAt,
      },
    })
    .eq("id", input.targetMemoryId);
  if (supersedeError) {
    throw new Error(`mark memory superseded failed: ${supersedeError.message}`);
  }

  const { error: candidateError } = await supabase
    .from("memory_candidates")
    .update({ status: "approved" })
    .eq("id", input.candidateId);
  if (candidateError) {
    throw new Error(`mark candidate approved failed: ${candidateError.message}`);
  }

  const { error: reconciliationError } = await supabase
    .from("memory_reconciliations")
    .update({ status: input.status ?? "auto_applied" })
    .eq("id", input.reconciliationId);
  if (reconciliationError) {
    throw new Error(
      `mark reconciliation supersession applied failed: ${reconciliationError.message}`,
    );
  }

  return replacementId;
}

export async function markExpiredMemoriesStale(
  supabase: SupabaseClient,
  nowIso = new Date().toISOString(),
): Promise<void> {
  const { error } = await supabase
    .from("memories")
    .update({
      status: "stale",
      boot_context_eligible: false,
      review_reason:
        "memory lifecycle maintenance marked this memory stale because stale_after or expires_at passed",
    })
    .eq("status", "active")
    .or(`stale_after.lt.${nowIso},expires_at.lt.${nowIso}`);
  if (error) {
    throw new Error(`mark stale memories failed: ${error.message}`);
  }
}

export async function queueHighPriorityStaleMemoryReviews(
  supabase: SupabaseClient,
  minimumPriority = 70,
): Promise<string[]> {
  const { data: memories, error: loadError } = await supabase
    .from("memories")
    .select(
      "id, context, memory_type, title, body, retrieval_priority, stale_after, expires_at, metadata",
    )
    .eq("status", "stale")
    .gte("retrieval_priority", minimumPriority)
    .is("metadata->stale_review_candidate_id", null)
    .order("retrieval_priority", { ascending: false })
    .limit(25);
  if (loadError) {
    throw new Error(`load stale memories for review failed: ${loadError.message}`);
  }

  const queuedCandidateIds: string[] = [];
  for (const memory of (memories ?? []) as Record<string, unknown>[]) {
    const title = memory.title as string;
    const memoryId = memory.id as string;
    const content = `High-priority memory needs freshness review: ${title}\n\n${memory.body as string}`;
    const eventPayload = {
      context: memory.context as SofiaContext,
      source: "lifecycle_maintenance",
      source_ref: memoryId,
      content,
      embedding: null,
      sensitivity: "normal",
      metadata: {
        type_hint: "stale_memory_review",
        redaction_labels: [],
        source_memory_id: memoryId,
        memory_type: memory.memory_type as string,
        retrieval_priority: memory.retrieval_priority as number,
        stale_after: (memory.stale_after as string | null) ?? null,
        expires_at: (memory.expires_at as string | null) ?? null,
      },
    };
    const { data: event, error: eventError } = await supabase
      .from("events")
      .insert(eventPayload)
      .select("id")
      .single();
    if (eventError) {
      throw new Error(`insert stale review event failed: ${eventError.message}`);
    }

    const candidatePayload = {
      event_id: event.id as string,
      context: memory.context as SofiaContext,
      candidate_type: "open_loop",
      candidate_text:
        `Review high-priority stale memory '${title}' (${memoryId}) and decide whether to verify, update, supersede, or archive it.`,
      worthiness_score: 0.9,
      confidence: 0.85,
      risk_level: "medium",
      recommended_action: "review",
      reasoning:
        "Lifecycle maintenance found a boot-worthy or high-priority memory whose stale_after/expires_at timestamp has passed.",
      status: "pending_review",
      metadata: {
        title: `Review stale memory: ${title}`,
        source_memory_id: memoryId,
        review_type: "stale_memory",
        memory_type: memory.memory_type as string,
        retrieval_priority: memory.retrieval_priority as number,
        stale_after: (memory.stale_after as string | null) ?? null,
        expires_at: (memory.expires_at as string | null) ?? null,
      },
    };
    const { data: candidate, error: candidateError } = await supabase
      .from("memory_candidates")
      .insert(candidatePayload)
      .select("id")
      .single();
    if (candidateError) {
      throw new Error(
        `insert stale review candidate failed: ${candidateError.message}`,
      );
    }
    const oldMetadata = (memory.metadata as Record<string, unknown> | null) ?? {};
    const { error: updateMemoryError } = await supabase
      .from("memories")
      .update({
        review_reason: "high-priority stale memory queued for review",
        metadata: {
          ...oldMetadata,
          stale_review_candidate_id: candidate.id as string,
        },
      })
      .eq("id", memoryId);
    if (updateMemoryError) {
      throw new Error(
        `mark stale memory review queued failed: ${updateMemoryError.message}`,
      );
    }
    queuedCandidateIds.push(candidate.id as string);
  }
  return queuedCandidateIds;
}

export async function getPendingReconciliationForCandidate(
  supabase: SupabaseClient,
  candidateId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("memory_reconciliations")
    .select("*")
    .eq("candidate_id", candidateId)
    .eq("status", "pending_review")
    .maybeSingle();

  if (error) throw new Error(`load reconciliation failed: ${error.message}`);
  return (data as Record<string, unknown> | null) ?? null;
}

export async function markReconciliationStatus(
  supabase: SupabaseClient,
  reconciliationId: string,
  status: "approved" | "rejected" | "archived",
): Promise<void> {
  const { error } = await supabase
    .from("memory_reconciliations")
    .update({ status })
    .eq("id", reconciliationId);
  if (error) throw new Error(`update reconciliation failed: ${error.message}`);
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

  if (candidateError) {
    throw new Error(`load candidate failed: ${candidateError.message}`);
  }

  const candidateType = candidate.candidate_type as string;
  if (candidateType === "todo" || candidateType === "open_loop") {
    throw new Error(
      `${candidateType} candidates are not promoted to durable memories`,
    );
  }

  const title = (candidate.metadata?.title as string | undefined) ??
    candidateType;
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
      retrieval_priority: retrievalPriorityForType(candidateType as MemoryType),
      boot_context_eligible: true,
      activation_triggers: DEFAULT_ACTIVATION_TRIGGERS,
      last_verified_at: stringMeta(
        (candidate.metadata as Record<string, unknown> | null) ?? {},
        "last_verified_at",
      ),
      metadata: candidate.metadata ?? {},
    })
    .select("id")
    .single();

  if (memoryError) {
    throw new Error(
      `promote existing candidate failed: ${memoryError.message}`,
    );
  }

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

  if (versionError) {
    throw new Error(
      `insert approved memory version failed: ${versionError.message}`,
    );
  }

  await insertMemoryProvenance(supabase, {
    memoryId,
    candidateId,
    eventId: candidate.event_id as string | undefined,
    candidate: {
      candidate_type: candidateType as CandidateInput["candidate_type"],
      candidate_text: candidate.candidate_text as string,
      title,
      worthiness_score: candidate.worthiness_score as number,
      confidence: candidate.confidence as number,
      risk_level: candidate.risk_level as CandidateInput["risk_level"],
      recommended_action: candidate
        .recommended_action as CandidateInput["recommended_action"],
      reasoning: (candidate.reasoning as string | null) ??
        "human-approved promotion from review queue",
      entities:
        ((candidate.metadata as Record<string, unknown> | null)?.entities as
          | CandidateInput["entities"]
          | undefined) ?? [],
      metadata: (candidate.metadata as Record<string, unknown> | null) ?? {},
    },
    confidence: candidate.confidence as number,
    changeReason: "human-approved promotion from review queue",
    createdBy: "review_candidates",
  });

  const { error: updateError } = await supabase
    .from("memory_candidates")
    .update({ status: "approved" })
    .eq("id", candidateId);

  if (updateError) {
    throw new Error(`mark candidate approved failed: ${updateError.message}`);
  }
  return memoryId;
}

export async function createTodoFromCandidate(
  supabase: SupabaseClient,
  input: {
    candidateId: string;
    eventId?: string | null;
    context: SofiaContext;
    candidate: CandidateInput;
  },
): Promise<string> {
  const metadata = input.candidate.metadata ?? {};
  const { data, error } = await supabase
    .from("todos")
    .insert({
      title: input.candidate.title,
      body: input.candidate.candidate_text,
      status: "open",
      owner: stringMeta(metadata, "owner"),
      context: input.context,
      project_entity_id: stringMeta(metadata, "project_entity_id"),
      source_event_id: input.eventId ?? null,
      source_candidate_id: input.candidateId,
      source_memory_id: null,
      due_at: stringMeta(metadata, "due_at"),
      priority: numberMeta(metadata, "priority", 50),
      metadata,
    })
    .select("id")
    .single();
  if (error) throw new Error(`insert todo failed: ${error.message}`);
  return data.id as string;
}

export async function recordMemoryRetrievals(
  supabase: SupabaseClient,
  input: {
    query: string;
    context: SofiaContext;
    sessionId?: string;
    agentName?: string;
    toolName?: string;
    activationTrigger?: string;
    returnedInBootContext?: boolean;
    results: Array<{ id: string; similarity?: number }>;
  },
): Promise<void> {
  if (input.results.length === 0) return;
  const rows = input.results.map((result, index) => ({
    memory_id: result.id,
    session_id: input.sessionId ?? null,
    agent_name: input.agentName ?? null,
    tool_name: input.toolName ?? null,
    query: input.query,
    retrieval_context: input.context,
    activation_trigger: input.activationTrigger ?? null,
    rank: index + 1,
    similarity: result.similarity ?? null,
    returned_in_boot_context: input.returnedInBootContext ?? false,
  }));
  const { error } = await supabase.from("memory_retrievals").insert(rows);
  if (error) {
    throw new Error(`record retrieval telemetry failed: ${error.message}`);
  }
}

export async function recordMemoryFeedback(
  supabase: SupabaseClient,
  input: {
    retrievalId: string;
    wasUsed?: boolean;
    wasHelpful?: boolean;
    causedConfusion?: boolean;
    feedback?: string;
  },
): Promise<void> {
  const { error } = await supabase
    .from("memory_retrievals")
    .update({
      was_used: input.wasUsed ?? null,
      was_helpful: input.wasHelpful ?? null,
      caused_confusion: input.causedConfusion ?? null,
      feedback: input.feedback ?? null,
    })
    .eq("id", input.retrievalId);
  if (error) {
    throw new Error(`record retrieval feedback failed: ${error.message}`);
  }
}
