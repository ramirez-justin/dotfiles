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

function buildHookInput(ctx: ExtensionContext, extra: Partial<HookInput> = {}): HookInput {
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
		const detail = result.error?.message || result.stderr || `exit ${result.status}`;
		console.error(`[sofia] ${scriptName} failed: ${detail}`);
		return "";
	}

	return result.stdout.trim();
}

function extractAdditionalContext(hookOutput: string): string {
	if (!hookOutput) return "";
	try {
		const parsed = JSON.parse(hookOutput) as {
			hookSpecificOutput?: { additionalContext?: string };
		};
		return parsed.hookSpecificOutput?.additionalContext?.trim() ?? "";
	} catch (error) {
		console.error(`[sofia] failed to parse session-start output: ${String(error)}`);
		return "";
	}
}

function refreshSessionContext(event: SessionStartEvent, ctx: ExtensionContext) {
	const output = runHook(
		"sofia-session-start.sh",
		buildHookInput(ctx, { reason: event.reason, trigger: "session_start" }),
	);
	sessionContext = extractAdditionalContext(output);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (event, ctx) => {
		refreshSessionContext(event, ctx);
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
