import type { SupabaseClient } from "@supabase/supabase-js";

export type RetrievalPolicyContext = "personal" | "work" | "shared" | "both";

export type RetrievalPolicyInput = {
  context: RetrievalPolicyContext;
  limit: number;
  minimum_retrievals: number;
};

export type MemoryRetrievalStats = {
  memory_id: string;
  context: string;
  title: string;
  memory_type: string;
  retrieval_priority: number;
  boot_context_eligible: boolean;
  retrieval_count: number;
  used_count: number;
  helpful_count: number;
  confusing_count: number;
  helpful_rate: number;
  confusing_rate: number;
  boot_snapshot_count: number;
};

export type RetrievalPolicyRecommendation = {
  memory_id: string;
  title: string;
  action:
    | "raise_priority"
    | "lower_priority"
    | "enable_boot_context"
    | "disable_boot_context"
    | "needs_review";
  current_value?: unknown;
  recommended_value?: unknown;
  reason: string;
  requires_review: true;
};

export type RetrievalPolicyReport = {
  context: RetrievalPolicyContext;
  generated_at: string;
  top_helpful: MemoryRetrievalStats[];
  top_confusing: MemoryRetrievalStats[];
  boot_unused: MemoryRetrievalStats[];
  recommendations: RetrievalPolicyRecommendation[];
};

type MemoryRow = {
  id: string;
  context: string;
  title: string;
  memory_type: string;
  retrieval_priority: number;
  boot_context_eligible: boolean;
  status: string;
};

type RetrievalRow = {
  memory_id: string;
  was_used?: boolean | null;
  was_helpful?: boolean | null;
  caused_confusion?: boolean | null;
};

type BootSnapshotRow = {
  context: string;
  included_memory_ids?: string[] | null;
};

export async function buildRetrievalPolicyReport(
  supabase: SupabaseClient,
  input: RetrievalPolicyInput,
): Promise<RetrievalPolicyReport> {
  const limit = Math.max(1, input.limit);
  const minimumRetrievals = Math.max(1, input.minimum_retrievals);
  const memories = await loadMemories(supabase, input.context);
  const memoryIds = new Set(memories.map((memory) => memory.id));
  const retrievals = (await loadRetrievals(supabase)).filter((retrieval) =>
    memoryIds.has(retrieval.memory_id)
  );
  const snapshots = await loadBootSnapshots(supabase, input.context);
  const stats = buildStats(memories, retrievals, snapshots)
    .filter((row) => row.retrieval_count >= minimumRetrievals || row.boot_snapshot_count > 0);

  return {
    context: input.context,
    generated_at: new Date().toISOString(),
    top_helpful: [...stats]
      .filter((row) => row.helpful_count > 0)
      .sort((a, b) => b.helpful_rate - a.helpful_rate || b.helpful_count - a.helpful_count)
      .slice(0, limit),
    top_confusing: [...stats]
      .filter((row) => row.confusing_count > 0)
      .sort((a, b) => b.confusing_rate - a.confusing_rate || b.confusing_count - a.confusing_count)
      .slice(0, limit),
    boot_unused: [...stats]
      .filter((row) => row.boot_context_eligible && row.boot_snapshot_count > 0 && row.used_count === 0)
      .sort((a, b) => b.retrieval_priority - a.retrieval_priority || b.boot_snapshot_count - a.boot_snapshot_count)
      .slice(0, limit),
    recommendations: buildRecommendations(stats, minimumRetrievals).slice(0, limit * 3),
  };
}

function buildStats(
  memories: MemoryRow[],
  retrievals: RetrievalRow[],
  snapshots: BootSnapshotRow[],
): MemoryRetrievalStats[] {
  const retrievalsByMemory = groupByMemory(retrievals);
  const snapshotCounts = countBootSnapshotInclusions(snapshots);
  return memories.map((memory) => {
    const rows = retrievalsByMemory.get(memory.id) ?? [];
    const retrievalCount = rows.length;
    const usedCount = rows.filter((row) => row.was_used === true).length;
    const helpfulCount = rows.filter((row) => row.was_helpful === true).length;
    const confusingCount = rows.filter((row) => row.caused_confusion === true).length;
    return {
      memory_id: memory.id,
      context: memory.context,
      title: memory.title,
      memory_type: memory.memory_type,
      retrieval_priority: memory.retrieval_priority,
      boot_context_eligible: memory.boot_context_eligible,
      retrieval_count: retrievalCount,
      used_count: usedCount,
      helpful_count: helpfulCount,
      confusing_count: confusingCount,
      helpful_rate: retrievalCount === 0 ? 0 : helpfulCount / retrievalCount,
      confusing_rate: retrievalCount === 0 ? 0 : confusingCount / retrievalCount,
      boot_snapshot_count: snapshotCounts.get(memory.id) ?? 0,
    };
  });
}

function buildRecommendations(
  stats: MemoryRetrievalStats[],
  minimumRetrievals: number,
): RetrievalPolicyRecommendation[] {
  const recommendations: RetrievalPolicyRecommendation[] = [];
  for (const row of stats) {
    if (row.retrieval_count >= minimumRetrievals && row.helpful_rate >= 0.75) {
      if (!row.boot_context_eligible) {
        recommendations.push({
          memory_id: row.memory_id,
          title: row.title,
          action: "enable_boot_context",
          current_value: false,
          recommended_value: true,
          reason: `memory is frequently helpful (${row.helpful_count}/${row.retrieval_count}) but is not boot-context eligible`,
          requires_review: true,
        });
      }
      if (row.retrieval_priority < 80) {
        recommendations.push({
          memory_id: row.memory_id,
          title: row.title,
          action: "raise_priority",
          current_value: row.retrieval_priority,
          recommended_value: Math.min(90, row.retrieval_priority + 10),
          reason: `memory has high helpful rate (${formatRate(row.helpful_rate)})`,
          requires_review: true,
        });
      }
    }

    if (row.retrieval_count >= minimumRetrievals && row.confusing_rate >= 0.5) {
      recommendations.push({
        memory_id: row.memory_id,
        title: row.title,
        action: "needs_review",
        reason: `memory caused confusion in ${row.confusing_count}/${row.retrieval_count} retrievals; review before changing policy`,
        requires_review: true,
      });
    }

    if (row.boot_context_eligible && row.boot_snapshot_count > 0 && row.used_count === 0) {
      if (row.retrieval_priority > 60) {
        recommendations.push({
          memory_id: row.memory_id,
          title: row.title,
          action: "lower_priority",
          current_value: row.retrieval_priority,
          recommended_value: Math.max(50, row.retrieval_priority - 10),
          reason: `memory appeared in ${row.boot_snapshot_count} boot snapshot(s) but has no recorded use`,
          requires_review: true,
        });
      } else {
        recommendations.push({
          memory_id: row.memory_id,
          title: row.title,
          action: "disable_boot_context",
          current_value: true,
          recommended_value: false,
          reason: `memory appeared in boot context but has no recorded use`,
          requires_review: true,
        });
      }
    }
  }
  return recommendations;
}

function groupByMemory(rows: RetrievalRow[]): Map<string, RetrievalRow[]> {
  const groups = new Map<string, RetrievalRow[]>();
  for (const row of rows) {
    const current = groups.get(row.memory_id) ?? [];
    current.push(row);
    groups.set(row.memory_id, current);
  }
  return groups;
}

function countBootSnapshotInclusions(rows: BootSnapshotRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const memoryId of row.included_memory_ids ?? []) {
      counts.set(memoryId, (counts.get(memoryId) ?? 0) + 1);
    }
  }
  return counts;
}

async function loadMemories(
  supabase: SupabaseClient,
  context: RetrievalPolicyContext,
): Promise<MemoryRow[]> {
  const query = supabase
    .from("memories")
    .select("id, context, title, memory_type, retrieval_priority, boot_context_eligible, status")
    .eq("status", "active");
  const { data, error } = await query;
  if (error) throw new Error(`load retrieval policy memories failed: ${error.message}`);
  return ((data ?? []) as MemoryRow[]).filter((memory) =>
    context === "both" || memory.context === context || memory.context === "shared"
  );
}

async function loadRetrievals(supabase: SupabaseClient): Promise<RetrievalRow[]> {
  const { data, error } = await supabase
    .from("memory_retrievals")
    .select("memory_id, was_used, was_helpful, caused_confusion");
  if (error) throw new Error(`load memory retrievals failed: ${error.message}`);
  return (data ?? []) as RetrievalRow[];
}

async function loadBootSnapshots(
  supabase: SupabaseClient,
  context: RetrievalPolicyContext,
): Promise<BootSnapshotRow[]> {
  const { data, error } = await supabase
    .from("boot_context_snapshots")
    .select("context, included_memory_ids")
    .order("generated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`load boot context snapshots failed: ${error.message}`);
  return ((data ?? []) as BootSnapshotRow[]).filter((snapshot) =>
    context === "both" || snapshot.context === context || snapshot.context === "shared"
  );
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}
