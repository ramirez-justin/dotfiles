import type { SupabaseClient } from "@supabase/supabase-js";
import { redactSecrets } from "./redact.ts";
import type { SofiaContext } from "./types.ts";

export type ReactionSentiment = "positive" | "negative" | "neutral";
export type ReactionLearningSignal =
  | "positive_preference"
  | "negative_preference"
  | "confirmation"
  | "attention_requested"
  | "neutral_telemetry";

export type ReactionClassification = {
  emoji: string;
  sentiment: ReactionSentiment;
  category: string;
  learning_signal: ReactionLearningSignal;
  confidence: number;
};

export type RecordReactionEventInput = {
  context: SofiaContext;
  platform?: string;
  actor_id?: string;
  actor_handle?: string;
  chat_id?: string;
  message_id: string;
  emoji: string;
  message_preview?: string;
  source?: string;
  source_ref?: string;
  session_id?: string;
  task_run_id?: string;
  metadata?: Record<string, unknown>;
};

export type ReactionEventRow = {
  id: string;
  context: SofiaContext;
  platform: string;
  emoji: string;
  sentiment: ReactionSentiment;
  category: string;
  learning_signal: ReactionLearningSignal;
  confidence: number;
};

export type ReactionPatternInput = {
  context: string;
  emoji: string;
  sentiment: ReactionSentiment;
  category: string;
  learning_signal: ReactionLearningSignal;
  context_key: string;
  count: number;
  distinct_days: number;
  latest_at: string;
};

export type ReactionPatternSummary = ReactionPatternInput & {
  candidate_worthy: boolean;
  suggested_action: "create_review_candidate" | "keep_as_telemetry";
  rationale: string;
};

export type ReactionLearningReportInput = {
  context: SofiaContext | "both";
  limit: number;
};

export type ReactionLearningReport = {
  recent_negative_signals: Array<Record<string, unknown>>;
  patterns: ReactionPatternSummary[];
};

const CLASSIFICATIONS: Record<string, Omit<ReactionClassification, "emoji">> = {
  "👍": {
    sentiment: "positive",
    category: "approval",
    learning_signal: "positive_preference",
    confidence: 0.9,
  },
  "❤️": {
    sentiment: "positive",
    category: "approval",
    learning_signal: "positive_preference",
    confidence: 0.9,
  },
  "🔥": {
    sentiment: "positive",
    category: "approval",
    learning_signal: "positive_preference",
    confidence: 0.85,
  },
  "👎": {
    sentiment: "negative",
    category: "disapproval",
    learning_signal: "negative_preference",
    confidence: 0.9,
  },
  "❌": {
    sentiment: "negative",
    category: "disapproval",
    learning_signal: "negative_preference",
    confidence: 0.85,
  },
  "😕": {
    sentiment: "negative",
    category: "confusion",
    learning_signal: "negative_preference",
    confidence: 0.8,
  },
  "✅": {
    sentiment: "positive",
    category: "confirmation",
    learning_signal: "confirmation",
    confidence: 0.9,
  },
  "👀": {
    sentiment: "neutral",
    category: "attention",
    learning_signal: "attention_requested",
    confidence: 0.75,
  },
};

export function classifyReactionEmoji(emoji: string): ReactionClassification {
  const classification = CLASSIFICATIONS[emoji] ?? {
    sentiment: "neutral" as const,
    category: "unknown",
    learning_signal: "neutral_telemetry" as const,
    confidence: 0.4,
  };
  return { emoji, ...classification };
}

export function summarizeReactionPatterns(
  rows: ReactionPatternInput[],
): ReactionPatternSummary[] {
  return rows.map((row) => {
    const candidateWorthy = row.count >= 3 && row.distinct_days >= 2 &&
      row.learning_signal !== "neutral_telemetry";
    return {
      ...row,
      candidate_worthy: candidateWorthy,
      suggested_action: candidateWorthy
        ? "create_review_candidate"
        : "keep_as_telemetry",
      rationale: candidateWorthy
        ? "Repeated reaction pattern crossed conservative review threshold."
        : "Single or low-confidence reaction stays telemetry only.",
    };
  });
}

export async function buildReactionLearningReport(
  supabase: SupabaseClient,
  input: ReactionLearningReportInput,
): Promise<ReactionLearningReport> {
  let negativeQuery = supabase
    .from("reaction_recent_negative_signals")
    .select(
      "id, context, platform, chat_id, message_id, emoji, category, learning_signal, message_preview, created_at",
    )
    .limit(input.limit);
  let patternQuery = supabase
    .from("reaction_learning_patterns")
    .select(
      "context, context_key, emoji, sentiment, category, learning_signal, count, distinct_days, latest_at",
    )
    .order("count", { ascending: false })
    .limit(input.limit);

  if (input.context !== "both") {
    negativeQuery = negativeQuery.eq("context", input.context);
    patternQuery = patternQuery.eq("context", input.context);
  }

  const { data: negatives, error: negativeError } = await negativeQuery;
  if (negativeError) {
    throw new Error(
      `load reaction negative signals failed: ${negativeError.message}`,
    );
  }

  const { data: patterns, error: patternError } = await patternQuery;
  if (patternError) {
    throw new Error(`load reaction patterns failed: ${patternError.message}`);
  }

  return {
    recent_negative_signals: (negatives ?? []) as Array<
      Record<string, unknown>
    >,
    patterns: summarizeReactionPatterns(
      ((patterns ?? []) as Array<Record<string, unknown>>).map((row) => ({
        context: row.context as string,
        context_key: row.context_key as string,
        emoji: row.emoji as string,
        sentiment: row.sentiment as ReactionSentiment,
        category: row.category as string,
        learning_signal: row.learning_signal as ReactionLearningSignal,
        count: Number(row.count ?? 0),
        distinct_days: Number(row.distinct_days ?? 0),
        latest_at: row.latest_at as string,
      })),
    ),
  };
}

export async function recordReactionEvent(
  supabase: SupabaseClient,
  input: RecordReactionEventInput,
): Promise<ReactionEventRow> {
  const classification = classifyReactionEmoji(input.emoji);
  const preview = input.message_preview
    ? redactSecrets(input.message_preview)
    : { content: null, redacted: false, labels: [] as string[] };
  const metadata = {
    ...(input.metadata ?? {}),
    redacted: preview.redacted,
    redaction_labels: preview.labels,
  };

  const row = {
    context: input.context,
    platform: input.platform ?? "telegram",
    actor_id: input.actor_id ?? null,
    actor_handle: input.actor_handle ?? null,
    chat_id: input.chat_id ?? null,
    message_id: input.message_id,
    emoji: input.emoji,
    sentiment: classification.sentiment,
    category: classification.category,
    learning_signal: classification.learning_signal,
    confidence: classification.confidence,
    message_preview: preview.content,
    source: input.source ?? "reaction_event",
    source_ref: input.source_ref ?? null,
    session_id: input.session_id ?? null,
    task_run_id: input.task_run_id ?? null,
    metadata,
  };

  const { data, error } = await supabase
    .from("reaction_events")
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new Error(`record reaction event failed: ${error.message}`);
  }

  return data as ReactionEventRow;
}
