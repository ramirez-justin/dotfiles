import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { StreamableHTTPTransport } from "@hono/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { z } from "zod";
import { classifyEvent, embedText } from "./classifier.ts";
import {
	createServiceClient,
	insertCandidate,
	insertEvent,
	promoteCandidate,
	promoteExistingCandidate,
} from "./db.ts";
import { formatJson, sanitizeRowsForMcp, textResponse } from "./format.ts";
import { shouldPatchMcpAcceptHeader } from "./http.ts";
import { redactSecrets } from "./redact.ts";
import { routeCandidate } from "./router.ts";
import type { CaptureEventInput, SofiaContext } from "./types.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const supabase = createServiceClient();

const server = new McpServer({ name: "sofia-cloud", version: "0.1.0" });

type SearchMemoryInput = {
	query: string;
	context: "personal" | "work" | "shared" | "both";
	limit: number;
	threshold: number;
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

type GetArtifactInput = {
	artifact_name: string;
	context: "personal" | "work" | "shared";
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
				if (
					route.shouldPromote &&
					candidate.candidate_type !== "todo" &&
					candidate.candidate_type !== "open_loop"
				) {
					const memoryEmbedding = await embedText(
						candidate.candidate_text,
						OPENROUTER_API_KEY,
					);
					memoryId = await promoteCandidate(
						supabase,
						candidateId,
						capture.context,
						candidate,
						memoryEmbedding,
					);
				}
				results.push({
					candidateId,
					memoryId,
					type: candidate.candidate_type,
					title: candidate.title,
					route,
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
		},
	},
	async ({ query, context, limit, threshold }: SearchMemoryInput) => {
		try {
			const embedding = await embedText(query, OPENROUTER_API_KEY);
			const { data, error } = await supabase.rpc("match_memories", {
				query_embedding: embedding,
				match_threshold: threshold,
				match_count: limit,
				filter_context: context === "both" ? null : context,
				include_archived: false,
			});
			if (error) return textResponse(`search failed: ${error.message}`, true);
			return textResponse(formatJson(sanitizeRowsForMcp(data ?? [])));
		} catch (error) {
			return textResponse(
				`search_memory failed: ${(error as Error).message}`,
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
		if (context !== "both")
			query = query.eq("context", context as SofiaContext);
		const { data, error } = await query;
		if (error)
			return textResponse(`list_recent failed: ${error.message}`, true);
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
			if (error)
				return textResponse(`review list failed: ${error.message}`, true);
			return textResponse(formatJson(sanitizeRowsForMcp(data ?? [])));
		}

		if (!candidate_id)
			return textResponse(
				"candidate_id is required for approve/reject/archive",
				true,
			);

		if (action === "approve") {
			const { data: candidate, error: loadError } = await supabase
				.from("memory_candidates")
				.select("candidate_text")
				.eq("id", candidate_id)
				.single();
			if (loadError)
				return textResponse(
					`load candidate failed: ${loadError.message}`,
					true,
				);
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
		if (error)
			return textResponse(`review update failed: ${error.message}`, true);
		return textResponse(formatJson(data));
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
		if (error)
			return textResponse(`get_artifact failed: ${error.message}`, true);
		if (!data)
			return textResponse(`No artifact found for ${context}/${artifact_name}`);
		return textResponse(data.content as string);
	},
);

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Headers":
		"authorization, x-client-info, apikey, content-type, x-sofia-key, accept, mcp-session-id",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
};

const app = new Hono();
app.options("*", (c: any) => c.text("ok", 200, corsHeaders));

app.all("*", async (c: any) => {
	const provided =
		c.req.header("x-sofia-key") || new URL(c.req.url).searchParams.get("key");
	if (!provided || provided !== MCP_ACCESS_KEY) {
		return c.json(
			{ error: "Invalid or missing SOFIA access key" },
			401,
			corsHeaders,
		);
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
