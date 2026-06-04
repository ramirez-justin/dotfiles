import type { SupabaseClient } from "@supabase/supabase-js";

export type DailyDigestCountBySeverity = Record<string, number>;

export type DailyDigestCandidate = {
  id: string;
  title: string;
  candidate_type: string;
  context: string;
  created_at: string;
};

export type DailyDigestMemoryFlag = {
  id: string;
  title: string;
  context: string;
  retrieval_priority: number;
};

export type DailyDigestConfusingRetrieval = {
  retrieval_id: string;
  memory_id: string;
  query: string;
  feedback?: string;
};

export type DailyDigestTodo = {
  id: string;
  title: string;
  context: string;
  status: string;
  due_at?: string | null;
};

export type DailyDigestBootSnapshot = {
  id: string;
  context: string;
  generated_at: string;
  token_count?: number | null;
};

export type DailyDigestSnapshot = {
  pendingReviewCount: number;
  pendingReviewBySeverity: DailyDigestCountBySeverity;
  pendingContradictionsBySeverity: DailyDigestCountBySeverity;
  recentEventCount: number;
  redactedEventCount: number;
  staleHighPriorityMemories: DailyDigestMemoryFlag[];
  confusingRetrievals: DailyDigestConfusingRetrieval[];
  dueTodos: DailyDigestTodo[];
  recentBootSnapshots: DailyDigestBootSnapshot[];
  candidates: DailyDigestCandidate[];
};

type TelegramSendInput = {
  botToken: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
};

export type TelegramSendResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

function formatSeverityCounts(
  counts: DailyDigestCountBySeverity,
  order: string[],
): string {
  return order.map((key) => `${key} ${counts[key] ?? 0}`).join(", ");
}

function hasQaSignals(snapshot: DailyDigestSnapshot): boolean {
  return snapshot.pendingReviewCount > 0 ||
    snapshot.staleHighPriorityMemories.length > 0 ||
    snapshot.confusingRetrievals.length > 0 ||
    Object.values(snapshot.pendingContradictionsBySeverity).some((count) =>
      count > 0
    );
}

function shortId(id: string): string {
  return id.length <= 12 ? id : id.slice(0, 8);
}

function safeInline(text: string | undefined): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean;
}

export function formatDailyDigest(
  snapshot: DailyDigestSnapshot,
  now = new Date(),
): string {
  const date = now.toISOString().slice(0, 10);
  const lines = [
    `SOFIA evening digest — ${date}`,
    "",
    `Pending review: ${snapshot.pendingReviewCount} (${
      formatSeverityCounts(snapshot.pendingReviewBySeverity, [
        "high",
        "normal",
        "low",
      ])
    })`,
    `Pending contradictions: ${
      formatSeverityCounts(snapshot.pendingContradictionsBySeverity, [
        "high",
        "medium",
        "low",
      ])
    }`,
    `Recent captures: ${snapshot.recentEventCount} in the last 24h`,
    `Redactions: ${snapshot.redactedEventCount} capture${
      snapshot.redactedEventCount === 1 ? " had" : "s had"
    } secrets/private material redacted`,
    `Health: ${
      hasQaSignals(snapshot)
        ? "attention needed — review queue or QA signals present"
        : "ok — scheduled digest function ran"
    }`,
    "",
  ];

  if (
    snapshot.staleHighPriorityMemories.length > 0 ||
    snapshot.confusingRetrievals.length > 0
  ) {
    lines.push("Urgent memory QA:");
    for (const memory of snapshot.staleHighPriorityMemories) {
      lines.push(
        `- Stale high-priority memory: ${memory.title} — ${memory.context}/priority ${memory.retrieval_priority} (${
          shortId(memory.id)
        })`,
      );
    }
    for (const retrieval of snapshot.confusingRetrievals) {
      const feedback = safeInline(retrieval.feedback) || "marked confusing";
      lines.push(
        `- Confusing retrieval: ${shortId(retrieval.memory_id)} for \"${
          safeInline(retrieval.query)
        }\" — ${feedback} (${shortId(retrieval.retrieval_id)})`,
      );
    }
    lines.push("");
  }

  if (snapshot.dueTodos.length > 0) {
    lines.push("Due soon:");
    for (const todo of snapshot.dueTodos) {
      const due = todo.due_at ? ` due ${todo.due_at}` : "";
      lines.push(
        `- ${todo.title} — ${todo.context}/${todo.status}${due} (${
          shortId(todo.id)
        })`,
      );
    }
    lines.push("");
  }

  if (snapshot.recentBootSnapshots.length > 0) {
    lines.push("Recent boot snapshots:");
    for (const boot of snapshot.recentBootSnapshots) {
      const tokens = typeof boot.token_count === "number"
        ? `${boot.token_count} tokens`
        : "token count unknown";
      lines.push(
        `- ${boot.context} snapshot ${
          shortId(boot.id)
        } at ${boot.generated_at} — ${tokens}`,
      );
    }
    lines.push("");
  }

  if (snapshot.candidates.length === 0) {
    lines.push("No pending memory candidates.");
  } else {
    lines.push("Top review candidates:");
    for (const [index, candidate] of snapshot.candidates.entries()) {
      lines.push(
        `${
          index + 1
        }. ${candidate.title} — ${candidate.candidate_type}/${candidate.context}`,
      );
    }
  }

  lines.push("", "Review in Pi with `sofia_cloud_review_candidates`.");
  return lines.join("\n");
}

function titleFromCandidate(row: Record<string, unknown>): string {
  const metadata = row.metadata as Record<string, unknown> | null;
  const title = metadata?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const text = row.candidate_text;
  if (typeof text === "string" && text.trim()) {
    return text.trim().slice(0, 80);
  }
  return "Untitled";
}

function countRowsByKey(
  rows: Array<Record<string, unknown>>,
  key: string,
): DailyDigestCountBySeverity {
  const counts: DailyDigestCountBySeverity = {};
  for (const row of rows) {
    const value = String(row[key] ?? "normal");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function withDefaults(
  counts: DailyDigestCountBySeverity,
  keys: string[],
): DailyDigestCountBySeverity {
  return Object.fromEntries(keys.map((key) => [key, counts[key] ?? 0]));
}

export async function fetchDailyDigestSnapshot(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<DailyDigestSnapshot> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const dueBefore = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
    .toISOString();

  const { count: pendingReviewCount, error: pendingCountError } = await supabase
    .from("memory_candidates")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_review");
  if (pendingCountError) {
    throw new Error(
      `load pending review count failed: ${pendingCountError.message}`,
    );
  }

  const { data: pendingRows, error: pendingRowsError } = await supabase
    .from("memory_candidates")
    .select(
      "id, candidate_type, candidate_text, context, created_at, metadata, risk_level, worthiness_score",
    )
    .eq("status", "pending_review")
    .order("created_at", { ascending: false })
    .limit(20);
  if (pendingRowsError) {
    throw new Error(
      `load review candidates failed: ${pendingRowsError.message}`,
    );
  }
  const candidateRows = (pendingRows ?? []) as Array<Record<string, unknown>>;

  const { count: recentEventCount, error: eventCountError } = await supabase
    .from("events")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (eventCountError) {
    throw new Error(
      `load recent event count failed: ${eventCountError.message}`,
    );
  }

  const { count: redactedEventCount, error: redactedCountError } =
    await supabase
      .from("events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .eq("sensitivity", "secret_redacted");
  if (redactedCountError) {
    throw new Error(
      `load redacted event count failed: ${redactedCountError.message}`,
    );
  }

  const { data: contradictionRows, error: contradictionError } = await supabase
    .from("memory_contradiction_reviews")
    .select("severity")
    .eq("status", "pending_review");
  if (contradictionError) {
    throw new Error(
      `load contradiction counts failed: ${contradictionError.message}`,
    );
  }

  const { data: staleRows, error: staleError } = await supabase
    .from("memories")
    .select("id, title, context, retrieval_priority")
    .in("status", ["stale", "needs_review"])
    .gte("retrieval_priority", 70)
    .order("retrieval_priority", { ascending: false })
    .limit(5);
  if (staleError) {
    throw new Error(
      `load stale high-priority memories failed: ${staleError.message}`,
    );
  }

  const { data: retrievalRows, error: retrievalError } = await supabase
    .from("memory_retrievals")
    .select("id, memory_id, query, feedback, created_at")
    .eq("caused_confusion", true)
    .order("created_at", { ascending: false })
    .limit(5);
  if (retrievalError) {
    throw new Error(
      `load confusing retrievals failed: ${retrievalError.message}`,
    );
  }

  const { data: todoRows, error: todoError } = await supabase
    .from("todos")
    .select("id, title, context, status, due_at, priority")
    .in("status", ["open", "in_progress", "blocked"])
    .lte("due_at", dueBefore)
    .order("due_at", { ascending: true })
    .limit(5);
  if (todoError) {
    throw new Error(`load due todos failed: ${todoError.message}`);
  }

  const { data: bootRows, error: bootError } = await supabase
    .from("boot_context_snapshots")
    .select("id, context, generated_at, token_count")
    .order("generated_at", { ascending: false })
    .limit(5);
  if (bootError) {
    throw new Error(`load recent boot snapshots failed: ${bootError.message}`);
  }

  const pendingSeverityRows = candidateRows.map((row) => {
    const risk = String(row.risk_level ?? "medium");
    const worthiness = typeof row.worthiness_score === "number"
      ? row.worthiness_score
      : 0.5;
    return {
      severity: risk === "high"
        ? "high"
        : (risk === "low" && worthiness < 0.5)
        ? "low"
        : "normal",
    };
  });

  return {
    pendingReviewCount: pendingReviewCount ?? 0,
    pendingReviewBySeverity: withDefaults(
      countRowsByKey(pendingSeverityRows, "severity"),
      ["high", "normal", "low"],
    ),
    pendingContradictionsBySeverity: withDefaults(
      countRowsByKey(
        (contradictionRows ?? []) as Array<Record<string, unknown>>,
        "severity",
      ),
      ["high", "medium", "low"],
    ),
    recentEventCount: recentEventCount ?? 0,
    redactedEventCount: redactedEventCount ?? 0,
    staleHighPriorityMemories:
      ((staleRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        title: row.title as string,
        context: row.context as string,
        retrieval_priority: row.retrieval_priority as number,
      })),
    confusingRetrievals:
      ((retrievalRows ?? []) as Array<Record<string, unknown>>).map((row) => ({
        retrieval_id: row.id as string,
        memory_id: row.memory_id as string,
        query: String(row.query ?? ""),
        feedback: typeof row.feedback === "string" ? row.feedback : undefined,
      })),
    dueTodos: ((todoRows ?? []) as Array<Record<string, unknown>>).map((
      row,
    ) => ({
      id: row.id as string,
      title: row.title as string,
      context: row.context as string,
      status: row.status as string,
      due_at: row.due_at as string | null,
    })),
    recentBootSnapshots: ((bootRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => ({
        id: row.id as string,
        context: row.context as string,
        generated_at: row.generated_at as string,
        token_count: row.token_count as number | null,
      })),
    candidates: candidateRows.slice(0, 3).map((row) => ({
      id: row.id as string,
      title: titleFromCandidate(row),
      candidate_type: row.candidate_type as string,
      context: row.context as string,
      created_at: row.created_at as string,
    })),
  };
}

export async function sendTelegramMessage({
  botToken,
  chatId,
  text,
  fetchImpl = fetch,
}: TelegramSendInput): Promise<TelegramSendResult> {
  const response = await fetchImpl(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    },
  );
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  return { ok: response.ok, status: response.status, body };
}

export async function deliverDailyDigest(
  supabase: SupabaseClient,
  env: Pick<typeof Deno.env, "get"> = Deno.env,
): Promise<{
  snapshot: DailyDigestSnapshot;
  text: string;
  telegram: TelegramSendResult;
}> {
  const botToken = env.get("TELEGRAM_BOT_TOKEN")?.trim();
  const chatId = env.get("TELEGRAM_CHAT_ID")?.trim();
  if (!botToken || !chatId) {
    throw new Error("missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  }

  const snapshot = await fetchDailyDigestSnapshot(supabase);
  const text = formatDailyDigest(snapshot);
  const telegram = await sendTelegramMessage({ botToken, chatId, text });
  if (!telegram.ok) {
    throw new Error(`telegram sendMessage failed: HTTP ${telegram.status}`);
  }
  return { snapshot, text, telegram };
}
