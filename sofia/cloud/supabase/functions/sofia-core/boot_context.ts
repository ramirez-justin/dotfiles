import type { SupabaseClient } from "@supabase/supabase-js";
import type {
	BootContextRequest,
	BootContextResponse,
	SofiaContext,
} from "./types.ts";

const BOOT_ARTIFACT_NAME = "boot_context.md";
const BOOT_CONTEXT_MAX_CHARS = 12_000;

type MemoryRow = {
	id: string;
	context: SofiaContext;
	memory_type: string;
	title: string;
	body: string;
	confidence?: number;
	created_at?: string;
};

export async function compileBootContext(
	supabase: SupabaseClient,
	request: BootContextRequest,
): Promise<BootContextResponse> {
	if (!request.force_refresh) {
		const existing = await loadBootArtifact(supabase, request.context);
		if (existing) return existing;
	}

	const contexts = contextsForBoot(request.context);
	const memories = await loadActiveMemories(supabase, contexts);
	const content = renderBootContext(request.context, memories);
	return await upsertBootArtifact(supabase, request.context, content, contexts);
}

async function loadBootArtifact(
	supabase: SupabaseClient,
	context: SofiaContext,
): Promise<BootContextResponse | null> {
	const { data, error } = await supabase
		.from("compiled_artifacts")
		.select("id, content, generated_at")
		.eq("artifact_name", BOOT_ARTIFACT_NAME)
		.eq("context", context)
		.maybeSingle();

	if (error) {
		throw new Error(`load boot context artifact failed: ${error.message}`);
	}
	if (!data) return null;
	return {
		context,
		content: data.content as string,
		generated_at: data.generated_at as string,
		artifact_id: data.id as string,
		source: "compiled_artifacts",
	};
}

async function loadActiveMemories(
	supabase: SupabaseClient,
	contexts: SofiaContext[],
): Promise<MemoryRow[]> {
	const { data, error } = await supabase
		.from("memories")
		.select("id, context, memory_type, title, body, confidence, created_at")
		.in("context", contexts)
		.eq("status", "active")
		.order("context", { ascending: false })
		.order("memory_type", { ascending: true })
		.order("created_at", { ascending: false })
		.limit(80);

	if (error) throw new Error(`load boot memories failed: ${error.message}`);
	return (data ?? []) as MemoryRow[];
}

async function upsertBootArtifact(
	supabase: SupabaseClient,
	context: SofiaContext,
	content: string,
	contexts: SofiaContext[],
): Promise<BootContextResponse> {
	const { data, error } = await supabase
		.from("compiled_artifacts")
		.upsert(
			{
				artifact_name: BOOT_ARTIFACT_NAME,
				context,
				content,
				content_type: "text/markdown",
				source_query: {
					table: "memories",
					contexts,
					status: "active",
					limit: 80,
				},
				metadata: {
					compiler: "sofia-core/compileBootContext",
					max_chars: BOOT_CONTEXT_MAX_CHARS,
				},
				generated_at: new Date().toISOString(),
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
		source: "compiled_from_memories",
	};
}

function contextsForBoot(context: SofiaContext): SofiaContext[] {
	return context === "shared" ? ["shared"] : ["shared", context];
}

function renderBootContext(
	context: SofiaContext,
	memories: MemoryRow[],
): string {
	const shared = memories.filter((memory) => memory.context === "shared");
	const contextual = memories.filter((memory) => memory.context === context);
	const sections = [
		`# SOFIA — your second brain context (context: ${context})`,
		"",
		"> Source: SOFIA Cloud compiled boot context. Postgres is canonical; Obsidian/Markdown is a generated human view.",
		"",
		renderSection("Shared Memory", shared),
	];
	if (context !== "shared") {
		sections.push(renderSection(`${capitalize(context)} Memory`, contextual));
	}
	sections.push(
		"## Operating Rule",
		"",
		"- Do not use local Obsidian/SOFIA vault files as boot-memory fallback. If cloud context is missing, surface the failure.",
	);

	const rendered = sections.join("\n").trimEnd();
	if (rendered.length <= BOOT_CONTEXT_MAX_CHARS) return rendered;
	return `${rendered.slice(0, BOOT_CONTEXT_MAX_CHARS)}\n\n> [truncated by SOFIA Cloud boot-context compiler]`;
}

function renderSection(title: string, memories: MemoryRow[]): string {
	if (memories.length === 0)
		return `## ${title}\n\n- No active memories found.`;
	return [
		`## ${title}`,
		"",
		...memories.map((memory) => {
			const type = memory.memory_type.replaceAll("_", " ");
			return `- **${memory.title}** (${type}, id: ${memory.id}) — ${memory.body}`;
		}),
	].join("\n");
}

function capitalize(value: string): string {
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
