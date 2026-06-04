import type { SupabaseClient } from "@supabase/supabase-js";
import type { SofiaContext } from "./types.ts";
import { findEntityId } from "./entities.ts";

export type TaskRunStatus = "in_progress" | "blocked" | "completed" | "cancelled";
export type TaskArtifactType =
  | "commit"
  | "pr"
  | "issue"
  | "migration"
  | "deployment"
  | "test_output"
  | "log"
  | "doc"
  | "file"
  | "url"
  | "note";

export type StartTaskRunInput = {
  context: SofiaContext;
  agent_name: string;
  session_ref?: string;
  title: string;
  objective?: string;
  entity_id?: string;
  entity?: string;
  metadata?: Record<string, unknown>;
};

export type StartTaskRunResult = {
  session_id: string;
  task_run_id: string;
  status: TaskRunStatus;
};

export type AttachTaskArtifactInput = {
  task_run_id: string;
  artifact_type: TaskArtifactType;
  title: string;
  uri?: string;
  content?: string;
  metadata?: Record<string, unknown>;
};

export type TaskArtifactRow = {
  id: string;
  task_run_id: string;
  artifact_type: TaskArtifactType;
  title: string;
  uri?: string | null;
  content?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
};

export type CompleteTaskRunInput = {
  task_run_id: string;
  status: Exclude<TaskRunStatus, "in_progress">;
  outcome_summary: string;
  verification_summary?: string;
};

export type CompleteTaskRunResult = {
  task_run_id: string;
  handoff_id: string;
  completed_at: string;
};

export type GetLatestHandoffsInput = {
  context: SofiaContext;
  entity_id?: string;
  entity?: string;
  limit: number;
};

export type HandoffRow = {
  id: string;
  session_id?: string;
  task_run_id: string;
  context?: SofiaContext;
  entity_id?: string | null;
  title: string;
  handoff_markdown: string;
  verification_status?: string;
  artifact_ids?: string[];
  created_at?: string;
};

export type ListActiveTaskRunsInput = {
  context: SofiaContext | "both";
  entity_id?: string;
  entity?: string;
  limit: number;
};

export async function startTaskRun(
  supabase: SupabaseClient,
  input: StartTaskRunInput,
): Promise<StartTaskRunResult> {
  const entityId = await resolveTaskEntityId(supabase, input.entity_id, input.entity);
  const metadata = input.metadata ?? {};
  const { data: session, error: sessionError } = await supabase
    .from("agent_sessions")
    .insert({
      context: input.context,
      agent_name: input.agent_name,
      session_ref: input.session_ref ?? null,
      status: "active",
      metadata,
    })
    .select("id")
    .single();
  if (sessionError) throw new Error(`start task session failed: ${sessionError.message}`);

  const { data: task, error: taskError } = await supabase
    .from("task_runs")
    .insert({
      session_id: session.id,
      context: input.context,
      entity_id: entityId,
      title: input.title,
      objective: input.objective ?? null,
      status: "in_progress",
      metadata,
    })
    .select("id, status")
    .single();
  if (taskError) throw new Error(`start task run failed: ${taskError.message}`);

  return {
    session_id: session.id as string,
    task_run_id: task.id as string,
    status: (task.status as TaskRunStatus | undefined) ?? "in_progress",
  };
}

export async function attachTaskArtifact(
  supabase: SupabaseClient,
  input: AttachTaskArtifactInput,
): Promise<TaskArtifactRow> {
  const { data, error } = await supabase
    .from("task_artifacts")
    .insert({
      task_run_id: input.task_run_id,
      artifact_type: input.artifact_type,
      title: input.title,
      uri: input.uri ?? null,
      content: input.content ?? null,
      metadata: input.metadata ?? {},
    })
    .select("id, task_run_id, artifact_type, title, uri, content, metadata, created_at")
    .single();
  if (error) throw new Error(`attach task artifact failed: ${error.message}`);
  return data as TaskArtifactRow;
}

export async function completeTaskRun(
  supabase: SupabaseClient,
  input: CompleteTaskRunInput,
): Promise<CompleteTaskRunResult> {
  const completedAt = new Date().toISOString();
  const { data: task, error: taskError } = await supabase
    .from("task_runs")
    .update({
      status: input.status,
      completed_at: completedAt,
      outcome_summary: input.outcome_summary,
      verification_summary: input.verification_summary ?? null,
    })
    .eq("id", input.task_run_id)
    .select("id, session_id, context, entity_id, title, objective, status, outcome_summary, verification_summary")
    .single();
  if (taskError) throw new Error(`complete task run failed: ${taskError.message}`);

  const artifacts = await loadTaskArtifacts(supabase, input.task_run_id);
  const handoffMarkdown = renderTaskHandoff(task as Record<string, unknown>, artifacts);
  const verificationStatus = verificationStatusFor(input.status, input.verification_summary);
  const artifactIds = artifacts.map((artifact) => artifact.id);

  const { data: handoff, error: handoffError } = await supabase
    .from("session_handoffs")
    .insert({
      session_id: task.session_id,
      task_run_id: task.id,
      context: task.context,
      entity_id: task.entity_id ?? null,
      title: task.title,
      handoff_markdown: handoffMarkdown,
      status: "active",
      verification_status: verificationStatus,
      artifact_ids: artifactIds,
      metadata: {
        completed_task_status: input.status,
        artifact_count: artifactIds.length,
      },
    })
    .select("id")
    .single();
  if (handoffError) throw new Error(`insert session handoff failed: ${handoffError.message}`);

  return {
    task_run_id: task.id as string,
    handoff_id: handoff.id as string,
    completed_at: completedAt,
  };
}

export async function getLatestHandoffs(
  supabase: SupabaseClient,
  input: GetLatestHandoffsInput,
): Promise<HandoffRow[]> {
  const entityId = await resolveTaskEntityId(supabase, input.entity_id, input.entity);
  let query = supabase
    .from("session_handoffs")
    .select("id, session_id, task_run_id, context, entity_id, title, handoff_markdown, verification_status, artifact_ids, created_at")
    .eq("context", input.context)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(input.limit);
  if (entityId) query = query.eq("entity_id", entityId);
  const { data, error } = await query;
  if (error) throw new Error(`get latest handoffs failed: ${error.message}`);
  return (data ?? []) as HandoffRow[];
}

export async function listActiveTaskRuns(
  supabase: SupabaseClient,
  input: ListActiveTaskRunsInput,
): Promise<Array<Record<string, unknown>>> {
  const entityId = await resolveTaskEntityId(supabase, input.entity_id, input.entity);
  let query = supabase
    .from("task_runs")
    .select("id, session_id, context, entity_id, title, objective, status, started_at, metadata")
    .in("status", ["in_progress", "blocked"])
    .order("started_at", { ascending: false })
    .limit(input.limit);
  if (input.context !== "both") query = query.eq("context", input.context);
  if (entityId) query = query.eq("entity_id", entityId);
  const { data, error } = await query;
  if (error) throw new Error(`list active task runs failed: ${error.message}`);
  return (data ?? []) as Array<Record<string, unknown>>;
}

async function loadTaskArtifacts(
  supabase: SupabaseClient,
  taskRunId: string,
): Promise<TaskArtifactRow[]> {
  const { data, error } = await supabase
    .from("task_artifacts")
    .select("id, task_run_id, artifact_type, title, uri, content, metadata, created_at")
    .eq("task_run_id", taskRunId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`load task artifacts failed: ${error.message}`);
  return (data ?? []) as TaskArtifactRow[];
}

async function resolveTaskEntityId(
  supabase: SupabaseClient,
  entityId?: string,
  entity?: string,
): Promise<string | null> {
  if (entityId) return entityId;
  if (entity) return await findEntityId(supabase, entity);
  return null;
}

function verificationStatusFor(
  status: CompleteTaskRunInput["status"],
  verificationSummary?: string,
): string {
  if (status === "blocked") return "blocked";
  if (status === "cancelled") return "not_run";
  if (!verificationSummary?.trim()) return "unknown";
  if (/fail|error|blocked/i.test(verificationSummary)) return "failed";
  if (/pass|passed|ok|verified|succeeded|success/i.test(verificationSummary)) return "passed";
  return "unknown";
}

function renderTaskHandoff(
  task: Record<string, unknown>,
  artifacts: TaskArtifactRow[],
): string {
  const lines = [
    `# ${task.title}`,
    "",
    `- Task run: ${task.id}`,
    `- Status: ${task.status}`,
  ];
  if (task.objective) lines.push(`- Objective: ${task.objective}`);
  if (task.outcome_summary) {
    lines.push("", "## Outcome", "", String(task.outcome_summary));
  }
  if (task.verification_summary) {
    lines.push("", "## Verification", "", String(task.verification_summary));
  }
  lines.push("", "## Artifacts", "");
  if (artifacts.length === 0) {
    lines.push("- No artifacts recorded.");
  } else {
    for (const artifact of artifacts) {
      const uri = artifact.uri ? ` — ${artifact.uri}` : "";
      const content = artifact.content ? ` — ${artifact.content}` : "";
      lines.push(`- ${artifact.id}: ${artifact.title} (${artifact.artifact_type})${uri}${content}`);
    }
  }
  return lines.join("\n");
}
