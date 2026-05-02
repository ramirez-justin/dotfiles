import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
} from "@mariozechner/pi-coding-agent";

type HookInput = {
	cwd: string;
	session_id: string;
	transcript_path: string;
	reason?: string;
	trigger?: string;
};

const HOOK_DIR = join(homedir(), ".pi", "agent", "scripts", "sofia");
const SOFIA_MARKER = "# SOFIA — your second brain context";

let sessionContext = "";

function buildHookInput(
	ctx: ExtensionContext,
	extra: Partial<HookInput> = {},
): HookInput {
	return {
		cwd: ctx.cwd,
		session_id: ctx.sessionManager.getSessionId(),
		transcript_path: ctx.sessionManager.getSessionFile() ?? "",
		...extra,
	};
}

function runHook(scriptName: string, input: HookInput): string {
	const script = join(HOOK_DIR, scriptName);
	const result = spawnSync("bash", [script], {
		input: JSON.stringify(input),
		encoding: "utf8",
		env: {
			...process.env,
			SOFIA_HARNESS: "pi",
		},
	});

	if (result.error || result.status !== 0) {
		const detail =
			result.error?.message || result.stderr || `exit ${result.status}`;
		console.error(`[sofia] ${scriptName} failed: ${detail}`);
		return "";
	}

	return result.stdout.trim();
}

const CLOUD_BOOT_FAILURE = `# SOFIA — cloud boot context unavailable

SOFIA Cloud boot context failed to load. Do not use local Obsidian memory as a fallback. Ask Justin whether to proceed without SOFIA context or debug SOFIA Cloud.`;

type BootContextResponse = {
	context: "personal" | "work" | "shared";
	content: string;
	generated_at: string;
	artifact_id: string | null;
	source: "compiled_artifacts" | "compiled_from_memories";
};

function detectSofiaContext(cwd: string): "personal" | "work" {
	return cwd.includes("/telophaseqs/") ? "work" : "personal";
}

async function fetchCloudBootContext(ctx: ExtensionContext): Promise<string> {
	const baseUrl = process.env.SOFIA_CLOUD_URL;
	const accessKey = process.env.SOFIA_MCP_ACCESS_KEY;
	if (!baseUrl || !accessKey) {
		throw new Error("missing SOFIA_CLOUD_URL or SOFIA_MCP_ACCESS_KEY");
	}

	const context = detectSofiaContext(ctx.cwd);
	const url = new URL(baseUrl);
	url.pathname = `${url.pathname.replace(/\/$/, "")}/boot-context`;
	url.searchParams.set("context", context);

	const response = await fetch(url, {
		headers: { "x-sofia-key": accessKey },
	});
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`HTTP ${response.status}: ${body}`);
	}

	const payload = (await response.json()) as BootContextResponse;
	if (!payload.content?.includes(SOFIA_MARKER)) {
		throw new Error("boot-context response missing SOFIA marker");
	}
	return payload.content.trim();
}

async function refreshCloudBootContext(ctx: ExtensionContext) {
	try {
		sessionContext = await fetchCloudBootContext(ctx);
	} catch (error) {
		console.error(`[sofia] cloud boot context failed: ${String(error)}`);
		sessionContext = CLOUD_BOOT_FAILURE;
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event: SessionStartEvent, ctx) => {
		await refreshCloudBootContext(ctx);
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent) => {
		if (!sessionContext || event.systemPrompt.includes(SOFIA_MARKER)) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${sessionContext}`,
		};
	});

	pi.on("session_before_compact", async (event, ctx) => {
		runHook(
			"sofia-pre-compact.sh",
			buildHookInput(ctx, {
				trigger: event.customInstructions ? "manual" : "compact",
			}),
		);
	});

	pi.on("session_shutdown", async (event: SessionShutdownEvent, ctx) => {
		runHook(
			"sofia-session-end.sh",
			buildHookInput(ctx, {
				reason: event.reason,
				trigger: "session_shutdown",
			}),
		);
	});
}
