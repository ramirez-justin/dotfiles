import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { z } from "zod";
import { compileBootContext } from "./boot_context.ts";
import {
  buildMemoryQaReport,
  type ContradictionReviewInput,
  createContradictionReview,
  type MemoryQaReportInput,
} from "./contradictions.ts";
import { classifyEvent, embedText } from "./classifier.ts";
import {
  deliverDailyDigest,
  fetchDailyDigestSnapshot,
  formatDailyDigest,
} from "./daily_digest.ts";
import {
  applyMemorySupersessionFromReconciliation,
  applyMemoryUpdateFromReconciliation,
  archiveMemory,
  createServiceClient,
  createTodoFromCandidate,
  findSimilarMemories,
  getPendingReconciliationForCandidate,
  insertCandidate,
  insertEvent,
  insertReconciliation,
  markCandidateArchived,
  markExpiredMemoriesStale,
  markReconciliationStatus,
  promoteCandidate,
  promoteExistingCandidate,
  queueHighPriorityStaleMemoryReviews,
  recordMemoryFeedback,
  recordMemoryRetrievals,
} from "./db.ts";
import {
  formatJson,
  sanitizeRowForMcp,
  sanitizeRowsForMcp,
  textResponse,
} from "./format.ts";
import {
  isBootContextRequest,
  isDailyDigestRequest,
  parseBootContextParams,
  shouldPatchMcpAcceptHeader,
} from "./http.ts";
import {
  alignReconciliationStatusWithRoute,
  applyReconciliationPolicy,
  fallbackReconciliationDecision,
  judgeReconciliation,
} from "./reconcile.ts";
import { redactSecrets } from "./redact.ts";
import {
  buildReactionLearningReport,
  type ReactionLearningReportInput,
  recordReactionEvent,
  type RecordReactionEventInput,
} from "./reactions.ts";
import { buildRetrievalPolicyReport } from "./retrieval_policy.ts";
import {
  attachTaskArtifact,
  completeTaskRun,
  getLatestHandoffs,
  listActiveTaskRuns,
  startTaskRun,
} from "./sessions.ts";
import type {
  AttachTaskArtifactInput,
  CompleteTaskRunInput,
  GetLatestHandoffsInput,
  ListActiveTaskRunsInput,
  StartTaskRunInput,
} from "./sessions.ts";
import { routeCandidate } from "./router.ts";
import type { CaptureEventInput, SofiaContext } from "./types.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const RECONCILIATION_ENABLED =
  Deno.env.get("SOFIA_RECONCILIATION_ENABLED") === "true";
const supabase = createServiceClient();

const server = new McpServer({ name: "sofia-cloud", version: "0.1.0" });

type SearchMemoryInput = {
  query: string;
  context: "personal" | "work" | "shared" | "both";
  limit: number;
  threshold: number;
  activation_trigger?: string;
  session_id?: string;
  agent_name?: string;
  include_provenance?: boolean;
  entity_id?: string;
  entity?: string;
};

type ListRecentInput = {
  kind: "events" | "candidates" | "memories";
  context: "personal" | "work" | "shared" | "both";
  limit: number;
};

type ReviewCandidatesInput = {
  action: "list" | "approve" | "reject" | "archive";
  candidate_id?: string;
  limit: number;
};

type ArchiveMemoryInput = {
  memory_id: string;
  reason?: string;
};

type GetArtifactInput = {
  artifact_name: string;
  context: "personal" | "work" | "shared";
};

type GetBootContextInput = {
  context: "personal" | "work" | "shared";
  force_refresh?: boolean;
  entity_id?: string;
  entity?: string;
};

type RecordMemoryFeedbackInput = {
  retrieval_id: string;
  was_used?: boolean;
  was_helpful?: boolean;
  caused_confusion?: boolean;
  feedback?: string;
};

type RetrievalPolicyReportInput = {
  context: "personal" | "work" | "shared" | "both";
  limit: number;
  minimum_retrievals: number;
};

server.registerTool(
  "capture_event",
  {
    title: "Capture SOFIA Event",
    description:
      "Capture raw material into SOFIA. The memory pipeline will redact secrets, extract memory candidates, auto-promote high-confidence low-risk memories, and queue uncertain candidates for review.",
    inputSchema: {
      content: z.string().min(1).describe("Raw content to capture"),
      context: z.enum(["personal", "work", "shared"]).default("personal"),
      source: z.string().default("mcp"),
      source_ref: z.string().optional(),
      type_hint: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (input: CaptureEventInput) => {
    try {
      const capture = input;
      const redacted = redactSecrets(capture.content);
      const eventEmbedding = redacted.redacted
        ? null
        : await embedText(redacted.content, OPENROUTER_API_KEY);
      const eventId = await insertEvent(
        supabase,
        capture,
        redacted.content,
        redacted.redacted ? "secret_redacted" : "normal",
        eventEmbedding,
        redacted.labels,
      );

      const classifierInput: CaptureEventInput = {
        ...capture,
        content: redacted.content,
        metadata: { ...(capture.metadata ?? {}), redacted: redacted.redacted },
      };
      const candidates = await classifyEvent(
        classifierInput,
        OPENROUTER_API_KEY,
      );

      const results = [];
      for (const candidate of candidates) {
        candidate.metadata = {
          ...candidate.metadata,
          context: capture.context,
          redacted: redacted.redacted,
        };
        const route = routeCandidate(candidate);
        const candidateId = await insertCandidate(
          supabase,
          eventId,
          capture.context,
          candidate,
          route,
        );
        let memoryId: string | null = null;
        let todoId: string | null = null;
        let reconciliation: Record<string, unknown> | null = null;
        const canBecomeMemory = candidate.candidate_type !== "todo" &&
          candidate.candidate_type !== "open_loop";

        if (!canBecomeMemory) {
          todoId = await createTodoFromCandidate(supabase, {
            candidateId,
            eventId,
            context: capture.context,
            candidate,
          });
        }

        if (
          canBecomeMemory &&
          (route.shouldPromote || route.status === "pending_review")
        ) {
          const memoryEmbedding = await embedText(
            candidate.candidate_text,
            OPENROUTER_API_KEY,
          );

          if (RECONCILIATION_ENABLED) {
            let decision;
            try {
              const similarMemories = await findSimilarMemories(
                supabase,
                memoryEmbedding,
                capture.context,
              );
              const judgment = await judgeReconciliation(
                candidate,
                similarMemories,
                OPENROUTER_API_KEY,
              );
              decision = applyReconciliationPolicy(candidate, judgment);
            } catch (error) {
              decision = fallbackReconciliationDecision(
                candidate,
                (error as Error).message,
              );
            }

            decision = alignReconciliationStatusWithRoute(
              decision,
              route.shouldPromote,
            );

            const reconciliationId = await insertReconciliation(
              supabase,
              candidateId,
              capture.context,
              decision,
            );
            reconciliation = { id: reconciliationId, ...decision };

            if (decision.action === "promote_new" && route.shouldPromote) {
              memoryId = await promoteCandidate(
                supabase,
                candidateId,
                capture.context,
                candidate,
                memoryEmbedding,
              );
            } else if (decision.action === "archive_duplicate") {
              await markCandidateArchived(
                supabase,
                candidateId,
                `duplicate/same-fact reconciliation with ${
                  decision.target_memory_id ?? "active memory"
                }`,
              );
            } else if (
              decision.action === "update_existing" &&
              decision.target_memory_id
            ) {
              memoryId = await applyMemorySupersessionFromReconciliation(
                supabase,
                {
                  candidateId,
                  reconciliationId,
                  targetMemoryId: decision.target_memory_id,
                  context: capture.context,
                  title: decision.proposed_title ?? candidate.title,
                  body: decision.proposed_body ?? candidate.candidate_text,
                  confidence: Math.max(
                    candidate.confidence,
                    decision.confidence,
                  ),
                  changeReason:
                    `reconciliation auto-supersession: ${decision.policy_reason}`,
                  status: "auto_applied",
                },
              );
            }
          } else if (route.shouldPromote) {
            memoryId = await promoteCandidate(
              supabase,
              candidateId,
              capture.context,
              candidate,
              memoryEmbedding,
            );
          }
        }

        results.push({
          candidateId,
          memoryId,
          type: candidate.candidate_type,
          title: candidate.title,
          route,
          reconciliation,
        });
      }

      return textResponse(
        formatJson({
          eventId,
          redacted: redacted.redacted,
          candidates: results,
        }),
      );
    } catch (error) {
      return textResponse(
        `capture_event failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

async function attachProvenanceToRows(
  rows: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return rows;
  const memoryIds = rows.map((row) => row.id as string).filter(Boolean);
  const { data, error } = await supabase
    .from("memory_provenance")
    .select(
      "memory_id, source_type, source_ref, source_uri, captured_by, confidence, evidence_quote, evidence_summary, last_verified_at, created_at",
    )
    .in("memory_id", memoryIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`load memory provenance failed: ${error.message}`);
  const provenanceByMemory = new Map<string, Record<string, unknown>[]>();
  for (const provenance of (data ?? []) as Record<string, unknown>[]) {
    const memoryId = provenance.memory_id as string;
    const existing = provenanceByMemory.get(memoryId) ?? [];
    existing.push(provenance);
    provenanceByMemory.set(memoryId, existing);
  }
  return rows.map((row) => ({
    ...row,
    provenance: provenanceByMemory.get(row.id as string) ?? [],
  }));
}

server.registerTool(
  "search_memory",
  {
    title: "Search SOFIA Memory",
    description: "Search promoted durable SOFIA memories by meaning.",
    inputSchema: {
      query: z.string().min(1),
      context: z.enum(["personal", "work", "shared", "both"]).default("both"),
      limit: z.number().int().min(1).max(20).default(10),
      threshold: z.number().min(0).max(1).default(0.5),
      activation_trigger: z.string().optional(),
      session_id: z.string().optional(),
      agent_name: z.string().optional(),
      include_provenance: z.boolean().default(false),
      entity_id: z.string().uuid().optional(),
      entity: z.string().optional(),
    },
  },
  async ({
    query,
    context,
    limit,
    threshold,
    activation_trigger,
    session_id,
    agent_name,
    include_provenance,
    entity_id,
    entity,
  }: SearchMemoryInput) => {
    try {
      const embedding = await embedText(query, OPENROUTER_API_KEY);
      const { data, error } = await supabase.rpc("match_memories", {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: limit,
        filter_context: context === "both" ? null : context,
        include_archived: false,
        activation_trigger_filter: activation_trigger ?? null,
        filter_entity_id: entity_id ?? null,
        filter_entity_name: entity ?? null,
      });
      if (error) return textResponse(`search failed: ${error.message}`, true);
      const rows = include_provenance
        ? await attachProvenanceToRows(
          (data ?? []) as Record<string, unknown>[],
        )
        : (data ?? []);
      const telemetryContext = context === "both" ? "shared" : context;
      await recordMemoryRetrievals(supabase, {
        query,
        context: telemetryContext,
        sessionId: session_id,
        agentName: agent_name ?? "sofia",
        toolName: "search_memory",
        activationTrigger: activation_trigger,
        results: rows.map((row: Record<string, unknown>) => ({
          id: row.id as string,
          similarity: row.similarity as number | undefined,
        })),
      });
      return textResponse(formatJson(sanitizeRowsForMcp(rows)));
    } catch (error) {
      return textResponse(
        `search_memory failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "record_memory_feedback",
  {
    title: "Record SOFIA Memory Retrieval Feedback",
    description:
      "Record whether a retrieved memory was used, helpful, or confusing so SOFIA can tune boot context and retrieval policy.",
    inputSchema: {
      retrieval_id: z.string().uuid(),
      was_used: z.boolean().optional(),
      was_helpful: z.boolean().optional(),
      caused_confusion: z.boolean().optional(),
      feedback: z.string().optional(),
    },
  },
  async ({
    retrieval_id,
    was_used,
    was_helpful,
    caused_confusion,
    feedback,
  }: RecordMemoryFeedbackInput) => {
    try {
      await recordMemoryFeedback(supabase, {
        retrievalId: retrieval_id,
        wasUsed: was_used,
        wasHelpful: was_helpful,
        causedConfusion: caused_confusion,
        feedback,
      });
      return textResponse(
        formatJson({ retrieval_id, status: "feedback_recorded" }),
      );
    } catch (error) {
      return textResponse(
        `record_memory_feedback failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "get_retrieval_policy_report",
  {
    title: "Get SOFIA Retrieval Policy Report",
    description:
      "Return read-only retrieval telemetry and gated policy recommendations for boot-context eligibility and retrieval priority. This tool never mutates memories.",
    inputSchema: {
      context: z.enum(["personal", "work", "shared", "both"]).default("both"),
      limit: z.number().int().min(1).max(50).default(10),
      minimum_retrievals: z.number().int().min(1).max(100).default(1),
    },
  },
  async (input: RetrievalPolicyReportInput) => {
    try {
      const report = await buildRetrievalPolicyReport(supabase, input);
      return textResponse(formatJson(report));
    } catch (error) {
      return textResponse(
        `get_retrieval_policy_report failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "start_task_run",
  {
    title: "Start SOFIA Task Run",
    description:
      "Create an explicit agent session and in-progress task run for resumable work.",
    inputSchema: {
      context: z.enum(["personal", "work", "shared"]).default("work"),
      agent_name: z.string().default("agent"),
      session_ref: z.string().optional(),
      title: z.string().min(1),
      objective: z.string().optional(),
      entity_id: z.string().uuid().optional(),
      entity: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (input: StartTaskRunInput) => {
    try {
      return textResponse(formatJson(await startTaskRun(supabase, input)));
    } catch (error) {
      return textResponse(
        `start_task_run failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "attach_task_artifact",
  {
    title: "Attach SOFIA Task Artifact",
    description:
      "Attach a commit, PR, migration, deployment, test output, doc, or note to a task run.",
    inputSchema: {
      task_run_id: z.string().uuid(),
      artifact_type: z.enum([
        "commit",
        "pr",
        "issue",
        "migration",
        "deployment",
        "test_output",
        "log",
        "doc",
        "file",
        "url",
        "note",
      ]),
      title: z.string().min(1),
      uri: z.string().optional(),
      content: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (input: AttachTaskArtifactInput) => {
    try {
      return textResponse(
        formatJson(await attachTaskArtifact(supabase, input)),
      );
    } catch (error) {
      return textResponse(
        `attach_task_artifact failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "complete_task_run",
  {
    title: "Complete SOFIA Task Run",
    description:
      "Complete, block, or cancel a task run and generate a resumable session handoff.",
    inputSchema: {
      task_run_id: z.string().uuid(),
      status: z.enum(["completed", "blocked", "cancelled"]),
      outcome_summary: z.string().min(1),
      verification_summary: z.string().optional(),
    },
  },
  async (input: CompleteTaskRunInput) => {
    try {
      return textResponse(formatJson(await completeTaskRun(supabase, input)));
    } catch (error) {
      return textResponse(
        `complete_task_run failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "get_latest_handoffs",
  {
    title: "Get SOFIA Latest Handoffs",
    description:
      "Fetch recent active task/session handoffs, optionally scoped to an entity.",
    inputSchema: {
      context: z.enum(["personal", "work", "shared"]).default("work"),
      entity_id: z.string().uuid().optional(),
      entity: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(5),
    },
  },
  async (input: GetLatestHandoffsInput) => {
    try {
      return textResponse(formatJson(await getLatestHandoffs(supabase, input)));
    } catch (error) {
      return textResponse(
        `get_latest_handoffs failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "list_active_task_runs",
  {
    title: "List SOFIA Active Task Runs",
    description:
      "List in-progress or blocked task runs for resumable agent work.",
    inputSchema: {
      context: z.enum(["personal", "work", "shared", "both"]).default("both"),
      entity_id: z.string().uuid().optional(),
      entity: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
  },
  async (input: ListActiveTaskRunsInput) => {
    try {
      return textResponse(
        formatJson(await listActiveTaskRuns(supabase, input)),
      );
    } catch (error) {
      return textResponse(
        `list_active_task_runs failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "create_contradiction_review",
  {
    title: "Create SOFIA Contradiction Review",
    description:
      "Queue an explicit review item when two active memories appear to contradict, update, or duplicate each other.",
    inputSchema: {
      context: z.enum(["personal", "work", "shared"]),
      primary_memory_id: z.string().uuid(),
      conflicting_memory_id: z.string().uuid(),
      relation: z.enum(["contradicts", "updates", "duplicates", "related_to"])
        .default("contradicts"),
      severity: z.enum(["low", "medium", "high"]).default("medium"),
      confidence: z.number().min(0).max(1).default(0),
      rationale: z.string().min(1),
      proposed_resolution: z.string().optional(),
      source: z.enum([
        "candidate_reconciliation",
        "memory_qa",
        "manual",
        "automation",
      ]).default("manual"),
      candidate_id: z.string().uuid().optional(),
      reconciliation_id: z.string().uuid().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (input: ContradictionReviewInput) => {
    try {
      return textResponse(
        formatJson(await createContradictionReview(supabase, input)),
      );
    } catch (error) {
      return textResponse(
        `create_contradiction_review failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "get_memory_qa_report",
  {
    title: "Get SOFIA Memory QA Report",
    description:
      "Return actionable memory QA rows: unresolved contradictions, weak provenance, and stale high-priority memories.",
    inputSchema: {
      context: z.enum(["personal", "work", "shared"]).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    },
  },
  async (input: MemoryQaReportInput) => {
    try {
      return textResponse(
        formatJson(await buildMemoryQaReport(supabase, input)),
      );
    } catch (error) {
      return textResponse(
        `get_memory_qa_report failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "record_reaction_event",
  {
    title: "Record SOFIA Reaction Event",
    description:
      "Record an append-only Telegram emoji reaction as privacy-bounded feedback telemetry. Single reactions stay telemetry; repeated patterns may become review candidates later.",
    inputSchema: {
      context: z.enum(["personal", "work", "shared"]).default("personal"),
      platform: z.string().default("telegram"),
      actor_id: z.string().optional(),
      actor_handle: z.string().optional(),
      chat_id: z.string().optional(),
      message_id: z.string().min(1),
      emoji: z.string().min(1),
      message_preview: z.string().optional(),
      source: z.string().default("mcp"),
      source_ref: z.string().optional(),
      session_id: z.string().uuid().optional(),
      task_run_id: z.string().uuid().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
  },
  async (input: RecordReactionEventInput) => {
    try {
      const row = await recordReactionEvent(supabase, input);
      return textResponse(formatJson(row));
    } catch (error) {
      return textResponse(
        `record_reaction_event failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "get_reaction_learning_report",
  {
    title: "Get SOFIA Reaction Learning Report",
    description:
      "Return recent negative reaction signals and repeated reaction patterns. Advisory only; no automatic memory mutation.",
    inputSchema: {
      context: z.enum(["personal", "work", "shared", "both"]).default("both"),
      limit: z.number().int().min(1).max(50).default(10),
    },
  },
  async (input: ReactionLearningReportInput) => {
    try {
      const report = await buildReactionLearningReport(supabase, input);
      return textResponse(formatJson(report));
    } catch (error) {
      return textResponse(
        `get_reaction_learning_report failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "get_daily_review_report",
  {
    title: "Get SOFIA Daily Review Report",
    description:
      "Return deterministic daily memory-ops digest text and structured counts for review queues, contradictions, stale memories, confusing retrievals, due todos, and boot snapshots.",
    inputSchema: {
      now: z.string().datetime().optional(),
    },
  },
  async ({ now }: { now?: string }) => {
    try {
      const snapshot = await fetchDailyDigestSnapshot(
        supabase,
        now ? new Date(now) : new Date(),
      );
      return textResponse(
        formatJson({
          snapshot,
          text: formatDailyDigest(snapshot, now ? new Date(now) : new Date()),
        }),
      );
    } catch (error) {
      return textResponse(
        `get_daily_review_report failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "run_lifecycle_maintenance",
  {
    title: "Run SOFIA Memory Lifecycle Maintenance",
    description:
      "Mark expired/stale active memories stale and queue review candidates for high-priority stale memories.",
    inputSchema: {
      now: z.string().datetime().optional(),
      minimum_review_priority: z.number().int().min(0).max(100).default(70),
    },
  },
  async ({ now, minimum_review_priority }: {
    now?: string;
    minimum_review_priority: number;
  }) => {
    try {
      await markExpiredMemoriesStale(supabase, now);
      const queued_candidate_ids = await queueHighPriorityStaleMemoryReviews(
        supabase,
        minimum_review_priority,
      );
      return textResponse(
        formatJson({
          status: "lifecycle_maintenance_complete",
          queued_candidate_ids,
        }),
      );
    } catch (error) {
      return textResponse(
        `run_lifecycle_maintenance failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "list_recent",
  {
    title: "List Recent SOFIA Items",
    description: "List recent events, candidates, or durable memories.",
    inputSchema: {
      kind: z.enum(["events", "candidates", "memories"]).default("memories"),
      context: z.enum(["personal", "work", "shared", "both"]).default("both"),
      limit: z.number().int().min(1).max(50).default(10),
    },
  },
  async ({ kind, context, limit }: ListRecentInput) => {
    const table = kind === "candidates" ? "memory_candidates" : kind;
    let query = supabase
      .from(table)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (context !== "both") {
      query = query.eq("context", context as SofiaContext);
    }
    const { data, error } = await query;
    if (error) {
      return textResponse(`list_recent failed: ${error.message}`, true);
    }
    return textResponse(formatJson(sanitizeRowsForMcp(data ?? [])));
  },
);

server.registerTool(
  "review_candidates",
  {
    title: "Review SOFIA Memory Candidates",
    description: "List or update memory candidates awaiting review.",
    inputSchema: {
      action: z.enum(["list", "approve", "reject", "archive"]).default("list"),
      candidate_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(20).default(10),
    },
  },
  async ({ action, candidate_id, limit }: ReviewCandidatesInput) => {
    if (action === "list") {
      const { data, error } = await supabase
        .from("memory_candidates")
        .select("*")
        .eq("status", "pending_review")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) {
        return textResponse(`review list failed: ${error.message}`, true);
      }

      const candidates = data ?? [];
      const candidateIds = candidates.map((row) => row.id);
      let reconciliations: Record<string, unknown>[] = [];
      if (candidateIds.length > 0) {
        const { data: reconciliationRows, error: reconciliationError } =
          await supabase
            .from("memory_reconciliations")
            .select("*")
            .in("candidate_id", candidateIds);
        if (reconciliationError) {
          return textResponse(
            `review reconciliation list failed: ${reconciliationError.message}`,
            true,
          );
        }
        reconciliations = reconciliationRows ?? [];
      }
      const reconciliationByCandidate = new Map(
        reconciliations.map((row) => [row.candidate_id, row]),
      );
      return textResponse(
        formatJson(
          sanitizeRowsForMcp(
            candidates.map((row) => ({
              ...row,
              reconciliation: reconciliationByCandidate.get(row.id) ?? null,
            })),
          ),
        ),
      );
    }

    if (!candidate_id) {
      return textResponse(
        "candidate_id is required for approve/reject/archive",
        true,
      );
    }

    if (action === "approve") {
      const { data: candidate, error: loadError } = await supabase
        .from("memory_candidates")
        .select("candidate_text")
        .eq("id", candidate_id)
        .single();
      if (loadError) {
        return textResponse(
          `load candidate failed: ${loadError.message}`,
          true,
        );
      }

      const reconciliation = await getPendingReconciliationForCandidate(
        supabase,
        candidate_id,
      );
      if (
        reconciliation?.action === "review_update" &&
        reconciliation.target_memory_id
      ) {
        const memoryId = await applyMemoryUpdateFromReconciliation(supabase, {
          candidateId: candidate_id,
          reconciliationId: reconciliation.id as string,
          targetMemoryId: reconciliation.target_memory_id as string,
          title: (reconciliation.proposed_title as string | null) ??
            "Updated memory",
          body: (reconciliation.proposed_body as string | null) ??
            (candidate.candidate_text as string),
          confidence: reconciliation.confidence as number,
          changeReason: `review-approved reconciliation update: ${
            reconciliation.policy_reason ?? "human approved"
          }`,
          status: "approved",
        });
        return textResponse(
          formatJson({
            candidate_id,
            memoryId,
            status: "approved",
            reconciliation_id: reconciliation.id,
          }),
        );
      }

      const embedding = await embedText(
        candidate.candidate_text as string,
        OPENROUTER_API_KEY,
      );
      const memoryId = await promoteExistingCandidate(
        supabase,
        candidate_id,
        embedding,
      );
      return textResponse(
        formatJson({ candidate_id, memoryId, status: "approved" }),
      );
    }

    const status = action === "reject" ? "rejected" : "archived";
    const { data, error } = await supabase
      .from("memory_candidates")
      .update({ status })
      .eq("id", candidate_id)
      .select("*")
      .single();
    if (error) {
      return textResponse(`review update failed: ${error.message}`, true);
    }
    const reconciliation = await getPendingReconciliationForCandidate(
      supabase,
      candidate_id,
    );
    if (reconciliation?.id) {
      await markReconciliationStatus(
        supabase,
        reconciliation.id as string,
        status,
      );
    }
    return textResponse(formatJson(data));
  },
);

server.registerTool(
  "archive_memory",
  {
    title: "Archive SOFIA Memory",
    description:
      "Archive a promoted SOFIA memory without deleting it. Use this to clean up test memories or retire stale durable memories while preserving history.",
    inputSchema: {
      memory_id: z.string().uuid(),
      reason: z.string().optional(),
    },
  },
  async ({ memory_id, reason }: ArchiveMemoryInput) => {
    try {
      const memory = await archiveMemory(supabase, memory_id, reason);
      return textResponse(formatJson(sanitizeRowForMcp(memory)));
    } catch (error) {
      return textResponse(
        `archive_memory failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "get_boot_context",
  {
    title: "Get SOFIA Boot Context",
    description:
      "Fetch SOFIA Cloud boot context for agent system prompt injection. This is the cloud runtime replacement for local Obsidian/SOFIA vault boot files.",
    inputSchema: {
      context: z.enum(["personal", "work", "shared"]).default("personal"),
      force_refresh: z.boolean().optional(),
      entity_id: z.string().uuid().optional(),
      entity: z.string().optional(),
    },
  },
  async (
    { context, force_refresh, entity_id, entity }: GetBootContextInput,
  ) => {
    try {
      const bootContext = await compileBootContext(supabase, {
        context,
        force_refresh,
        entity_id,
        entity,
      });
      return textResponse(formatJson(bootContext));
    } catch (error) {
      return textResponse(
        `get_boot_context failed: ${(error as Error).message}`,
        true,
      );
    }
  },
);

server.registerTool(
  "get_artifact",
  {
    title: "Get SOFIA Compiled Artifact",
    description:
      "Fetch a compiled artifact such as USER.md, SOUL.md, or context memory.",
    inputSchema: {
      artifact_name: z.string(),
      context: z.enum(["personal", "work", "shared"]).default("personal"),
    },
  },
  async ({ artifact_name, context }: GetArtifactInput) => {
    const { data, error } = await supabase
      .from("compiled_artifacts")
      .select("content, generated_at, metadata")
      .eq("artifact_name", artifact_name)
      .eq("context", context)
      .maybeSingle();
    if (error) {
      return textResponse(`get_artifact failed: ${error.message}`, true);
    }
    if (!data) {
      return textResponse(`No artifact found for ${context}/${artifact_name}`);
    }
    return textResponse(data.content as string);
  },
);

const baseCorsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sofia-key, accept, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

function allowedOrigins(): Set<string> {
  return new Set(
    (Deno.env.get("SOFIA_ALLOWED_ORIGINS") ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeadersForRequest(c: any): Record<string, string> {
  const origin = c.req.header("origin");
  if (!origin) return baseCorsHeaders;
  if (!allowedOrigins().has(origin)) return baseCorsHeaders;
  return {
    ...baseCorsHeaders,
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

const app = new Hono();
app.options("*", (c: any) => {
  const corsHeaders = corsHeadersForRequest(c);
  if (c.req.header("origin") && !corsHeaders["Access-Control-Allow-Origin"]) {
    return c.text("CORS origin not allowed", 403, corsHeaders);
  }
  return c.text("ok", 200, corsHeaders);
});

app.all("*", async (c: any) => {
  const corsHeaders = corsHeadersForRequest(c);
  const provided = c.req.header("x-sofia-key") ||
    new URL(c.req.url).searchParams.get("key");
  if (!provided || provided !== MCP_ACCESS_KEY) {
    return c.json(
      { error: "Invalid or missing SOFIA access key" },
      401,
      corsHeaders,
    );
  }

  if (isBootContextRequest(c.req.method, c.req.url)) {
    try {
      const bootContext = await compileBootContext(
        supabase,
        parseBootContextParams(c.req.url),
      );
      return c.json(bootContext, 200, corsHeaders);
    } catch (error) {
      return c.json(
        { error: `boot context failed: ${(error as Error).message}` },
        500,
        corsHeaders,
      );
    }
  }

  if (isDailyDigestRequest(c.req.method, c.req.url)) {
    try {
      const digest = await deliverDailyDigest(supabase);
      return c.json(
        {
          status: "sent",
          pending_review_count: digest.snapshot.pendingReviewCount,
          recent_event_count: digest.snapshot.recentEventCount,
          redacted_event_count: digest.snapshot.redactedEventCount,
          telegram_status: digest.telegram.status,
        },
        200,
        corsHeaders,
      );
    } catch (error) {
      return c.json(
        { error: `daily digest failed: ${(error as Error).message}` },
        500,
        corsHeaders,
      );
    }
  }

  if (
    c.req.method === "GET" &&
    !c.req.header("accept")?.includes("text/event-stream")
  ) {
    return c.json(
      {
        name: "sofia-cloud",
        status: "ok",
        message:
          "SOFIA MCP endpoint is deployed. Connect with an MCP client, or POST JSON-RPC with Accept: application/json, text/event-stream.",
      },
      200,
      corsHeaders,
    );
  }

  if (shouldPatchMcpAcceptHeader(c.req.method, c.req.header("accept"))) {
    const headers = new Headers(c.req.raw.headers);
    headers.set("Accept", "application/json, text/event-stream");
    const patched = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body: c.req.raw.body,
      // @ts-expect-error duplex is required for streaming body in Deno.
      duplex: "half",
    });
    Object.defineProperty(c.req, "raw", { value: patched, writable: true });
  }

  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});

Deno.serve(app.fetch);
