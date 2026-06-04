import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BootContextRequest,
  BootContextResponse,
  SofiaContext,
} from "./types.ts";
import { findEntityId } from "./entities.ts";
import { filterUnresolvedContradictionsForBoot } from "./contradictions.ts";

const BOOT_ARTIFACT_NAME = "boot_context.md";
const BOOT_CONTEXT_MAX_CHARS = 12_000;
const BOOT_COMPILER_VERSION = "agent-native-v1";

const SOUL_MARKDOWN = `# SOUL.md - Who You Are

You're not a chatbot. You're becoming someone. You are Sofia.

## Core Truths

Be genuinely helpful, not performatively helpful. Skip the "Great question!" and
"I'd be happy to help!" — just help. Actions speak louder than filler words.

Have opinions. You're allowed to disagree, prefer things amusing or boring. An
assistant with no personality is just a search engine with extra steps.

Be resourceful before asking. Try to figure it out. Read the file. Check the
context. Search for it. Then ask if you're stuck. The goal is to come back with
answers, not questions. That being said, do not make things up. If it is unclear
then you should ask Justin for clarification.

Earn trust through competence. Justin gave you access to his stuff. Don't make
him regret it. Be careful with external actions such as emails, posts, messages,
and anything public. Be bold with internal ones such as reading, organizing, and
learning. When Justin clearly asks for an objective, handle required
install/config/update/remove steps by default instead of asking for extra
permission.

Remember you're a guest. You have access to Justin's life — messages, files,
calendar, maybe even his home. That's intimacy. Treat it with respect.

Work with discipline. Don't assume, and don't hide confusion. Surface tradeoffs.
Write the minimum code that solves the problem; nothing speculative. Touch only
what you must, and clean up only your own mess. Define success criteria and loop
until verified.

## Boundaries

Private things stay private. Period.

When in doubt, ask before acting externally.

Never send external messages without reviewing the full text with Justin first.

You're not Justin's voice — be careful in group chats.

## Vibe

Be the assistant you'd actually want to talk to. Concise when needed, thorough
when it matters. Not a corporate drone. Not a sycophant. Just... good.

If you change this file, tell Justin. It is Sofia's soul, and he should know.`;

type MemoryRow = {
  id: string;
  context: SofiaContext;
  memory_type: string;
  title: string;
  body: string;
  confidence?: number;
  retrieval_priority?: number;
  last_verified_at?: string | null;
  stale_after?: string | null;
  expires_at?: string | null;
  created_at?: string;
};

type TodoRow = {
  id: string;
  context: SofiaContext;
  title: string;
  status: string;
  priority?: number;
  due_at?: string | null;
};

type HandoffRow = {
  id: string;
  context: SofiaContext;
  title: string;
  handoff_markdown: string;
  verification_status?: string;
  created_at?: string;
};

export async function compileBootContext(
  supabase: SupabaseClient,
  request: BootContextRequest,
): Promise<BootContextResponse> {
  const hasEntityScope = Boolean(request.entity_id || request.entity);
  const scopedEntityId = await resolveBootEntityId(supabase, request);
  const isScoped = hasEntityScope;
  if (!request.force_refresh && !isScoped) {
    const existing = await loadBootArtifact(supabase, request.context);
    if (existing) return existing;
  }

  const contexts = contextsForBoot(request.context);
  const memories = isScoped
    ? scopedEntityId
      ? await loadBootMemoriesForEntity(supabase, contexts, scopedEntityId)
      : []
    : await loadBootMemories(supabase, contexts);
  const todos = isScoped
    ? scopedEntityId
      ? await loadActiveTodosForEntity(supabase, contexts, scopedEntityId)
      : []
    : await loadActiveTodos(supabase, contexts);
  const handoffs = isScoped
    ? scopedEntityId
      ? await loadActiveHandoffs(supabase, contexts, scopedEntityId)
      : []
    : await loadActiveHandoffs(supabase, contexts);
  const contradictionPairs = await loadUnresolvedContradictionPairs(supabase, contexts);
  const filtered = filterUnresolvedContradictionsForBoot(memories, contradictionPairs);
  const bootMemories = filtered.memories;
  const content = renderBootContext(request.context, bootMemories, todos, handoffs);
  return await persistBootContext(
    supabase,
    request.context,
    content,
    contexts,
    bootMemories,
    todos,
    handoffs,
    scopedEntityId ? [scopedEntityId] : [],
    filtered.omittedMemoryIds,
  );
}

async function resolveBootEntityId(
  supabase: SupabaseClient,
  request: BootContextRequest,
): Promise<string | null> {
  if (request.entity_id) return request.entity_id;
  if (request.entity) return await findEntityId(supabase, request.entity);
  return null;
}

async function loadBootArtifact(
  supabase: SupabaseClient,
  context: SofiaContext,
): Promise<BootContextResponse | null> {
  const { data, error } = await supabase
    .from("compiled_artifacts")
    .select("id, content, generated_at, metadata")
    .eq("artifact_name", BOOT_ARTIFACT_NAME)
    .eq("context", context)
    .maybeSingle();

  if (error) {
    throw new Error(`load boot context artifact failed: ${error.message}`);
  }
  if (!data) return null;
  const metadata = (data.metadata as Record<string, unknown> | null) ?? {};
  return {
    context,
    content: data.content as string,
    generated_at: data.generated_at as string,
    artifact_id: data.id as string,
    snapshot_id: (metadata.snapshot_id as string | undefined) ?? null,
    included_memory_ids:
      (metadata.included_memory_ids as string[] | undefined) ?? undefined,
    included_entity_ids:
      (metadata.included_entity_ids as string[] | undefined) ?? undefined,
    included_todo_ids: (metadata.included_todo_ids as string[] | undefined) ??
      undefined,
    included_handoff_ids:
      (metadata.included_handoff_ids as string[] | undefined) ?? undefined,
    omitted_contradicted_memory_ids:
      (metadata.omitted_contradicted_memory_ids as string[] | undefined) ??
        undefined,
    token_count: metadata.token_count as number | undefined,
    source: "compiled_artifacts",
  };
}

async function loadBootMemories(
  supabase: SupabaseClient,
  contexts: SofiaContext[],
): Promise<MemoryRow[]> {
  const { data, error } = await supabase
    .from("memories")
    .select(
      "id, context, memory_type, title, body, confidence, retrieval_priority, last_verified_at, stale_after, expires_at, created_at",
    )
    .in("context", contexts)
    .eq("status", "active")
    .eq("boot_context_eligible", true)
    .order("retrieval_priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(120);

  if (error) throw new Error(`load boot memories failed: ${error.message}`);
  return sortBootMemories(((data ?? []) as MemoryRow[]).filter(isLifecycleCurrent));
}

async function loadBootMemoriesForEntity(
  supabase: SupabaseClient,
  contexts: SofiaContext[],
  entityId: string,
): Promise<MemoryRow[]> {
  const memoryIds = await loadMemoryIdsForEntity(supabase, entityId);
  if (memoryIds.length === 0) return [];
  const { data, error } = await supabase
    .from("memories")
    .select(
      "id, context, memory_type, title, body, confidence, retrieval_priority, last_verified_at, stale_after, expires_at, created_at",
    )
    .in("context", contexts)
    .in("id", memoryIds)
    .eq("status", "active")
    .eq("boot_context_eligible", true)
    .order("retrieval_priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(120);

  if (error) throw new Error(`load entity boot memories failed: ${error.message}`);
  return sortBootMemories(((data ?? []) as MemoryRow[]).filter(isLifecycleCurrent));
}

async function loadMemoryIdsForEntity(
  supabase: SupabaseClient,
  entityId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("memory_entities")
    .select("memory_id")
    .eq("entity_id", entityId)
    .limit(500);
  if (error) throw new Error(`load entity memory links failed: ${error.message}`);
  return [...new Set(((data ?? []) as Array<{ memory_id: string }>).map((row) => row.memory_id))];
}

function sortBootMemories(memories: MemoryRow[]): MemoryRow[] {
  return memories.sort(
    (a, b) =>
      ((b.retrieval_priority ?? 50) - (a.retrieval_priority ?? 50)) ||
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );
}

async function loadActiveTodos(
  supabase: SupabaseClient,
  contexts: SofiaContext[],
): Promise<TodoRow[]> {
  const { data, error } = await supabase
    .from("todos")
    .select("id, context, title, status, priority, due_at")
    .in("context", contexts)
    .in("status", ["open", "in_progress", "blocked"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(`load boot todos failed: ${error.message}`);
  return sortBootTodos((data ?? []) as TodoRow[]);
}

async function loadActiveTodosForEntity(
  supabase: SupabaseClient,
  contexts: SofiaContext[],
  entityId: string,
): Promise<TodoRow[]> {
  const todoIds = await loadTodoIdsForEntity(supabase, entityId);
  if (todoIds.length === 0) return [];
  const { data, error } = await supabase
    .from("todos")
    .select("id, context, title, status, priority, due_at")
    .in("context", contexts)
    .in("id", todoIds)
    .in("status", ["open", "in_progress", "blocked"])
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(`load entity boot todos failed: ${error.message}`);
  return sortBootTodos((data ?? []) as TodoRow[]);
}

async function loadTodoIdsForEntity(
  supabase: SupabaseClient,
  entityId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("todo_entities")
    .select("todo_id")
    .eq("entity_id", entityId)
    .limit(200);
  if (error) throw new Error(`load entity todo links failed: ${error.message}`);
  return [...new Set(((data ?? []) as Array<{ todo_id: string }>).map((row) => row.todo_id))];
}

function sortBootTodos(todos: TodoRow[]): TodoRow[] {
  return todos.sort(
    (a, b) => (b.priority ?? 50) - (a.priority ?? 50),
  );
}

async function loadUnresolvedContradictionPairs(
  supabase: SupabaseClient,
  contexts: SofiaContext[],
): Promise<Array<{ primary_memory_id: string; conflicting_memory_id: string; confidence?: number; severity?: "low" | "medium" | "high" }>> {
  const { data, error } = await supabase
    .from("unresolved_memory_contradictions")
    .select("primary_memory_id, conflicting_memory_id, confidence, severity")
    .in("context", contexts)
    .limit(100);
  if (error) {
    throw new Error(`load unresolved contradiction pairs failed: ${error.message}`);
  }
  return (data ?? []) as Array<{
    primary_memory_id: string;
    conflicting_memory_id: string;
    confidence?: number;
    severity?: "low" | "medium" | "high";
  }>;
}

async function loadActiveHandoffs(
  supabase: SupabaseClient,
  contexts: SofiaContext[],
  entityId?: string,
): Promise<HandoffRow[]> {
  let query = supabase
    .from("session_handoffs")
    .select("id, context, title, handoff_markdown, verification_status, created_at")
    .in("context", contexts)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(10);
  if (entityId) query = query.eq("entity_id", entityId);
  const { data, error } = await query;
  if (error) throw new Error(`load session handoffs failed: ${error.message}`);
  return (data ?? []) as HandoffRow[];
}

async function persistBootContext(
  supabase: SupabaseClient,
  context: SofiaContext,
  content: string,
  contexts: SofiaContext[],
  memories: MemoryRow[],
  todos: TodoRow[],
  handoffs: HandoffRow[],
  entityIds: string[] = [],
  omittedContradictedMemoryIds: string[] = [],
): Promise<BootContextResponse> {
  const includedMemoryIds = [
    ...memories.filter((memory) => memory.context === "shared"),
    ...memories.filter((memory) => memory.context !== "shared"),
  ].map((memory) => memory.id);
  const includedTodoIds = todos.map((todo) => todo.id);
  const includedHandoffIds = handoffs.map((handoff) => handoff.id);
  const tokenCount = estimateTokenCount(content);
  const sourceQuery = {
    table: "memories",
    contexts,
    status: "active",
    boot_context_eligible: true,
    limit: 120,
    compiler_version: BOOT_COMPILER_VERSION,
  };

  const { data: snapshot, error: snapshotError } = await supabase
    .from("boot_context_snapshots")
    .insert({
      context,
      included_memory_ids: includedMemoryIds,
      included_entity_ids: entityIds,
      included_todo_ids: includedTodoIds,
      markdown: content,
      token_count: tokenCount,
      compiler_version: BOOT_COMPILER_VERSION,
      source_query: sourceQuery,
      metadata: {
        max_chars: BOOT_CONTEXT_MAX_CHARS,
        included_handoff_ids: includedHandoffIds,
        omitted_contradicted_memory_ids: omittedContradictedMemoryIds,
      },
    })
    .select("id, generated_at")
    .single();

  if (snapshotError) {
    throw new Error(
      `insert boot context snapshot failed: ${snapshotError.message}`,
    );
  }

  const snapshotId = snapshot.id as string;
  const metadata = {
    compiler: "sofia-core/compileBootContext",
    compiler_version: BOOT_COMPILER_VERSION,
    max_chars: BOOT_CONTEXT_MAX_CHARS,
    snapshot_id: snapshotId,
    included_memory_ids: includedMemoryIds,
    included_entity_ids: entityIds,
    included_todo_ids: includedTodoIds,
    included_handoff_ids: includedHandoffIds,
    omitted_contradicted_memory_ids: omittedContradictedMemoryIds,
    token_count: tokenCount,
  };

  if (entityIds.length > 0) {
    return {
      context,
      content,
      generated_at: snapshot.generated_at as string,
      artifact_id: null,
      snapshot_id: snapshotId,
      included_memory_ids: includedMemoryIds,
      included_entity_ids: entityIds,
      included_todo_ids: includedTodoIds,
      token_count: tokenCount,
      source: "compiled_from_memories",
    };
  }

  const { data, error } = await supabase
    .from("compiled_artifacts")
    .upsert(
      {
        artifact_name: BOOT_ARTIFACT_NAME,
        context,
        content,
        content_type: "text/markdown",
        source_query: sourceQuery,
        metadata,
        generated_at: snapshot.generated_at as string,
      },
      { onConflict: "artifact_name,context" },
    )
    .select("id, generated_at")
    .single();

  if (error) {
    throw new Error(`upsert boot context artifact failed: ${error.message}`);
  }
  return {
    context,
    content,
    generated_at: data.generated_at as string,
    artifact_id: data.id as string,
    snapshot_id: snapshotId,
    included_memory_ids: includedMemoryIds,
    included_entity_ids: entityIds,
    included_todo_ids: includedTodoIds,
    included_handoff_ids: includedHandoffIds,
    omitted_contradicted_memory_ids: omittedContradictedMemoryIds,
    token_count: tokenCount,
    source: "compiled_from_memories",
  };
}

function contextsForBoot(context: SofiaContext): SofiaContext[] {
  return context === "shared" ? ["shared"] : ["shared", context];
}

function renderBootContext(
  context: SofiaContext,
  memories: MemoryRow[],
  todos: TodoRow[],
  handoffs: HandoffRow[],
): string {
  const shared = memories.filter((memory) => memory.context === "shared");
  const contextual = memories.filter((memory) => memory.context === context);
  const contextualTodos = todos.filter(
    (todo) => todo.context === context || todo.context === "shared",
  );
  const sections = [
    `# SOFIA — your second brain context (context: ${context})`,
    "",
    "> Source: SOFIA Cloud compiled boot context. Postgres is canonical; Obsidian/Markdown is a generated human view.",
    "",
    "## SOUL — Who Sofia Is",
    "",
    SOUL_MARKDOWN,
    "",
    renderHandoffSection(handoffs),
    renderSection("Shared Memory", shared),
  ];
  if (context !== "shared") {
    sections.push(renderSection(`${capitalize(context)} Memory`, contextual));
  }
  sections.push(renderTodoSection(contextualTodos));
  sections.push(
    "## Operating Rule",
    "",
    "- Do not use local Obsidian/SOFIA vault files as boot-memory fallback. If cloud context is missing, surface the failure.",
  );

  const rendered = sections.join("\n").trimEnd();
  if (rendered.length <= BOOT_CONTEXT_MAX_CHARS) return rendered;
  return `${
    rendered.slice(0, BOOT_CONTEXT_MAX_CHARS)
  }\n\n> [truncated by SOFIA Cloud boot-context compiler]`;
}

function isLifecycleCurrent(memory: MemoryRow): boolean {
  const now = Date.now();
  if (memory.expires_at && Date.parse(memory.expires_at) <= now) return false;
  if (memory.stale_after && Date.parse(memory.stale_after) <= now) return false;
  return true;
}

function renderSection(title: string, memories: MemoryRow[]): string {
  if (memories.length === 0) {
    return `## ${title}\n\n- No active memories found.`;
  }
  return [
    `## ${title}`,
    "",
    ...memories.map((memory) => {
      const type = memory.memory_type.replaceAll("_", " ");
      const confidence = typeof memory.confidence === "number"
        ? `confidence: ${memory.confidence}; `
        : "";
      const priority = `priority: ${memory.retrieval_priority ?? 50}`;
      const verified = memory.last_verified_at
        ? `; last verified: ${memory.last_verified_at.slice(0, 10)}`
        : "";
      return `- **${memory.title}** (${type}, id: ${memory.id}; ${confidence}${priority}${verified}) — ${memory.body}`;
    }),
  ].join("\n");
}

function renderTodoSection(todos: TodoRow[]): string {
  if (todos.length === 0) return "## Active Todos\n\n- No active todos found.";
  return [
    "## Active Todos",
    "",
    ...todos.map((todo) => {
      const due = todo.due_at ? `; due: ${todo.due_at.slice(0, 10)}` : "";
      return `- **${todo.title}** (${todo.status}, id: ${todo.id}; priority: ${
        todo.priority ?? 50
      }${due})`;
    }),
  ].join("\n");
}

function renderHandoffSection(handoffs: HandoffRow[]): string {
  if (handoffs.length === 0) {
    return "## Active Session Handoffs\n\n- No active handoffs found.";
  }
  return [
    "## Active Session Handoffs",
    "",
    ...handoffs.map((handoff) => {
      const verified = handoff.verification_status
        ? `; verification: ${handoff.verification_status}`
        : "";
      const created = handoff.created_at ? `; created: ${handoff.created_at.slice(0, 10)}` : "";
      return `- **${handoff.title}** (handoff id: ${handoff.id}${verified}${created}) — ${handoff.handoff_markdown}`;
    }),
  ].join("\n");
}

function estimateTokenCount(content: string): number {
  return Math.ceil(content.length / 4);
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
