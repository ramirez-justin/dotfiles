import type { SupabaseClient } from "@supabase/supabase-js";
import type { SofiaContext } from "./types.ts";

export type MemoryLike = {
  id: string;
  title: string;
  body: string;
  retrieval_priority?: number;
  confidence?: number;
  created_at?: string;
};

export type MemoryPairClassification = {
  relation: "duplicate" | "contradiction" | "update" | "unrelated";
  requires_review: boolean;
  severity: "low" | "medium" | "high";
  confidence: number;
  rationale: string;
};

export type ContradictionReviewInput = {
  context: SofiaContext;
  primary_memory_id: string;
  conflicting_memory_id: string;
  relation?: "contradicts" | "updates" | "duplicates" | "related_to";
  severity?: "low" | "medium" | "high";
  confidence?: number;
  rationale: string;
  proposed_resolution?: string;
  source?: "candidate_reconciliation" | "memory_qa" | "manual" | "automation";
  candidate_id?: string | null;
  reconciliation_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type MemoryQaReportInput = {
  context?: SofiaContext;
  limit?: number;
};

export type UnresolvedContradictionPair = {
  primary_memory_id: string;
  conflicting_memory_id: string;
  confidence?: number;
  severity?: "low" | "medium" | "high";
};

const NEGATION_PATTERNS = [
  /\bshould\s+not\b/i,
  /\bmust\s+not\b/i,
  /\bdo\s+not\b/i,
  /\bdoes\s+not\b/i,
  /\bis\s+not\b/i,
  /\bno\s+longer\b/i,
  /\bnever\b/i,
];

const UPDATE_PATTERNS = /\b(now|updated|deployed|verified|completed|finished|replaced|superseded|no longer pending)\b/i;
const PENDING_PATTERN = /\b(pending|planned|awaiting|not pushed|not deployed|in progress)\b/i;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter((token) => token.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / union.size;
}

function hasNegation(text: string): boolean {
  return NEGATION_PATTERNS.some((pattern) => pattern.test(text));
}

export function classifyMemoryPair(a: MemoryLike, b: MemoryLike): MemoryPairClassification {
  const aText = `${a.title}\n${a.body}`;
  const bText = `${b.title}\n${b.body}`;
  const normalizedA = normalize(aText);
  const normalizedB = normalize(bText);
  if (normalizedA === normalizedB) {
    return {
      relation: "duplicate",
      requires_review: false,
      severity: "low",
      confidence: 1,
      rationale: "memory title/body text is identical after normalization",
    };
  }

  const similarity = jaccard(tokenSet(aText), tokenSet(bText));
  const oneNegated = hasNegation(aText) !== hasNegation(bText);
  if (similarity >= 0.55 && oneNegated) {
    return {
      relation: "contradiction",
      requires_review: true,
      severity: "high",
      confidence: Math.min(0.98, 0.75 + similarity / 4),
      rationale: "similar memories differ by explicit negation",
    };
  }

  if (similarity >= 0.2 && (PENDING_PATTERN.test(aText) || PENDING_PATTERN.test(bText)) &&
    (UPDATE_PATTERNS.test(aText) || UPDATE_PATTERNS.test(bText))) {
    return {
      relation: "update",
      requires_review: true,
      severity: "medium",
      confidence: Math.min(0.92, 0.62 + similarity / 3),
      rationale: "similar memories appear to reflect a status update",
    };
  }

  return {
    relation: "unrelated",
    requires_review: false,
    severity: "low",
    confidence: similarity,
    rationale: "no deterministic duplicate, update, or contradiction signal found",
  };
}

export async function createContradictionReview(
  supabase: SupabaseClient,
  input: ContradictionReviewInput,
): Promise<Record<string, unknown>> {
  const payload = {
    context: input.context,
    primary_memory_id: input.primary_memory_id,
    conflicting_memory_id: input.conflicting_memory_id,
    relation: input.relation ?? "contradicts",
    severity: input.severity ?? "medium",
    confidence: input.confidence ?? 0,
    rationale: input.rationale,
    proposed_resolution: input.proposed_resolution ?? "review_required",
    source: input.source ?? "manual",
    status: "pending_review",
    candidate_id: input.candidate_id ?? null,
    reconciliation_id: input.reconciliation_id ?? null,
    metadata: input.metadata ?? {},
  };
  const { data, error } = await supabase
    .from("memory_contradiction_reviews")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(`create contradiction review failed: ${error.message}`);
  return data as Record<string, unknown>;
}

export type MemoryQaReport = {
  context: SofiaContext | "both";
  unresolved_contradictions: Record<string, unknown>[];
  weak_provenance: Record<string, unknown>[];
  stale_high_priority: Record<string, unknown>[];
  recommendations: string[];
};

export async function buildMemoryQaReport(
  supabase: SupabaseClient,
  input: MemoryQaReportInput = {},
): Promise<MemoryQaReport> {
  const limit = input.limit ?? 20;
  let contradictionsQuery = supabase
    .from("unresolved_memory_contradictions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (input.context) contradictionsQuery = contradictionsQuery.eq("context", input.context);
  const { data: unresolvedContradictions, error: contradictionError } = await contradictionsQuery;
  if (contradictionError) {
    throw new Error(`load unresolved contradictions failed: ${contradictionError.message}`);
  }

  let weakQuery = supabase
    .from("weak_provenance_memories")
    .select("*")
    .order("retrieval_priority", { ascending: false })
    .limit(limit);
  if (input.context) weakQuery = weakQuery.eq("context", input.context);
  const { data: weakProvenance, error: weakError } = await weakQuery;
  if (weakError) throw new Error(`load weak provenance memories failed: ${weakError.message}`);

  let staleQuery = supabase
    .from("memories")
    .select("id, context, title, memory_type, retrieval_priority, stale_after, expires_at")
    .eq("status", "stale")
    .order("retrieval_priority", { ascending: false })
    .limit(limit);
  if (input.context) staleQuery = staleQuery.eq("context", input.context);
  const { data: staleHighPriority, error: staleError } = await staleQuery;
  if (staleError) throw new Error(`load stale high-priority memories failed: ${staleError.message}`);

  const unresolved = (unresolvedContradictions ?? []) as Record<string, unknown>[];
  const weak = (weakProvenance ?? []) as Record<string, unknown>[];
  const stale = (staleHighPriority ?? []) as Record<string, unknown>[];
  const recommendations: string[] = [];
  if (unresolved.length > 0) {
    recommendations.push(`review ${unresolved.length} unresolved contradiction(s) before trusting affected boot context`);
  }
  if (weak.length > 0) {
    recommendations.push(`add provenance or archive ${weak.length} high-priority memory/memories with weak evidence`);
  }
  if (stale.length > 0) {
    recommendations.push(`refresh or archive ${stale.length} stale high-priority memory/memories`);
  }
  return {
    context: input.context ?? "both",
    unresolved_contradictions: unresolved,
    weak_provenance: weak,
    stale_high_priority: stale,
    recommendations,
  };
}

function chooseMemoryToKeep(a: MemoryLike, b: MemoryLike): string {
  const priorityA = a.retrieval_priority ?? 50;
  const priorityB = b.retrieval_priority ?? 50;
  if (priorityA !== priorityB) return priorityA > priorityB ? a.id : b.id;
  const confidenceA = a.confidence ?? 0;
  const confidenceB = b.confidence ?? 0;
  if (confidenceA !== confidenceB) return confidenceA > confidenceB ? a.id : b.id;
  const createdA = a.created_at ? Date.parse(a.created_at) : 0;
  const createdB = b.created_at ? Date.parse(b.created_at) : 0;
  return createdA >= createdB ? a.id : b.id;
}

export function filterUnresolvedContradictionsForBoot<T extends MemoryLike>(
  memories: T[],
  contradictions: UnresolvedContradictionPair[],
): { memories: T[]; omittedMemoryIds: string[] } {
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const omitted = new Set<string>();
  for (const contradiction of contradictions) {
    if ((contradiction.confidence ?? 0) < 0.85 && contradiction.severity !== "high") continue;
    const primary = byId.get(contradiction.primary_memory_id);
    const conflicting = byId.get(contradiction.conflicting_memory_id);
    if (!primary || !conflicting) continue;
    const keepId = chooseMemoryToKeep(primary, conflicting);
    omitted.add(keepId === primary.id ? conflicting.id : primary.id);
  }
  return {
    memories: memories.filter((memory) => !omitted.has(memory.id)),
    omittedMemoryIds: [...omitted],
  };
}
