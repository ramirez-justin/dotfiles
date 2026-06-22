// @ts-nocheck
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ClaudeSettingsInput = {
	hookScriptPath: string;
	sentinelPath: string;
};

type PlannerRunInput = {
	cwd: string;
	request: string;
	timeoutSeconds?: number;
	startupDelaySeconds?: number;
};

type PlannerRunResult = {
	ok: boolean;
	text: string;
	planPath?: string;
	transcriptPath?: string;
	details: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_SECONDS = 240;
const DEFAULT_STARTUP_DELAY_SECONDS = 4;
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function workspaceDir(cwd: string): string {
	return join(cwd, ".pi/claude-code");
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

export function buildClaudePlanPrompt(request: string): string {
	return `You are a planning agent being consulted by Pi.

Your job is to think through the user's request and produce a practical implementation plan. Do not modify repository files. Do not run mutating shell commands. You may inspect files if needed, but your final response should be a concise plan Pi can execute with its currently selected model.

Include:
- Goal and success criteria
- Relevant files or areas to inspect/change
- Implementation steps
- Verification/test steps
- Risks or open questions, if any

User request:
${request.trim()}`;
}

export function makeClaudeSettings(input: ClaudeSettingsInput) {
	return {
		hooks: {
			Stop: [
				{
					matcher: "*",
					hooks: [
						{
							type: "command",
							command: `node ${shellQuote(input.hookScriptPath)} ${shellQuote(
								input.sentinelPath,
							)}`,
						},
					],
				},
			],
		},
	};
}

function textFromContent(content: unknown): string | undefined {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	const parts = content
		.map((part) => {
			if (typeof part === "string") return part;
			if (part && typeof part === "object" && typeof part.text === "string") {
				return part.text;
			}
			return undefined;
		})
		.filter(Boolean);
	return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function extractLatestAssistantText(transcriptText: string): string {
	let latest = "";
	for (const line of transcriptText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let entry: any;
		try {
			entry = JSON.parse(trimmed);
		} catch {
			continue;
		}

		const role = entry.role ?? entry.message?.role ?? entry.type;
		if (role !== "assistant") continue;

		const text =
			textFromContent(entry.message?.content) ??
			textFromContent(entry.content) ??
			(typeof entry.text === "string" ? entry.text : undefined);
		if (text?.trim()) latest = text.trim();
	}
	return latest;
}

function readSentinel(path: string): Record<string, unknown> {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return {};
	}
}

async function runClaudePlanner(
	pi: ExtensionAPI,
	input: PlannerRunInput,
): Promise<PlannerRunResult> {
	const request = input.request.trim();
	if (!request) {
		return { ok: false, text: "Missing planning request.", details: {} };
	}

	const which = await pi.exec(
		"zsh",
		[
			"-ic",
			"source ~/.zshrc >/dev/null 2>&1 || true; command -v claude && claude --version",
		],
		{ timeout: 30_000 },
	);
	if (which.code !== 0) {
		return {
			ok: false,
			text: "Claude Code is not available after sourcing ~/.zshrc.",
			details: { stdout: which.stdout, stderr: which.stderr },
		};
	}

	const dir = workspaceDir(input.cwd);
	mkdirSync(dir, { recursive: true });
	const id = timestamp();
	const settingsPath = join(dir, `${id}-settings.json`);
	const sentinelPath = join(dir, `${id}-stop-sentinel.json`);
	const configPath = join(dir, `${id}-runner-config.json`);
	const planPath = join(dir, `${id}-plan.md`);
	const prompt = buildClaudePlanPrompt(request);

	writeFileSync(
		settingsPath,
		JSON.stringify(
			makeClaudeSettings({
				hookScriptPath: join(EXTENSION_DIR, "stop-hook.mjs"),
				sentinelPath,
			}),
			null,
			2,
		),
		"utf8",
	);
	writeFileSync(
		configPath,
		JSON.stringify(
			{
				cwd: input.cwd,
				prompt,
				settingsPath,
				sentinelPath,
				timeoutSeconds: input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
				startupDelaySeconds:
					input.startupDelaySeconds ?? DEFAULT_STARTUP_DELAY_SECONDS,
			},
			null,
			2,
		),
		"utf8",
	);

	const runner = await pi.exec(
		"python3",
		[join(EXTENSION_DIR, "pty-runner.py"), configPath],
		{
			timeout: ((input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) + 20) * 1000,
		},
	);
	let runnerDetails: Record<string, unknown> = {};
	try {
		runnerDetails = JSON.parse(
			runner.stdout.trim().split(/\r?\n/).at(-1) || "{}",
		);
	} catch {
		runnerDetails = { stdout: runner.stdout, stderr: runner.stderr };
	}

	const sentinel = readSentinel(sentinelPath);
	const transcriptPath =
		typeof sentinel.transcript_path === "string"
			? sentinel.transcript_path
			: undefined;
	const transcriptText =
		transcriptPath && existsSync(transcriptPath)
			? readFileSync(transcriptPath, "utf8")
			: "";
	const plan = extractLatestAssistantText(transcriptText);
	if (plan) writeFileSync(planPath, `${plan.trim()}\n`, "utf8");

	if (runner.code !== 0 || !plan) {
		return {
			ok: false,
			text:
				plan ||
				"Claude Code planning did not produce a readable assistant plan before timeout.",
			planPath: plan ? planPath : undefined,
			transcriptPath,
			details: { runner: runnerDetails, sentinel, stderr: runner.stderr },
		};
	}

	return {
		ok: true,
		text: plan,
		planPath,
		transcriptPath,
		details: { runner: runnerDetails, sentinel, claude: which.stdout.trim() },
	};
}

function formatResult(result: PlannerRunResult): string {
	const pathLine = result.planPath
		? `\n\nPlan saved to: ${result.planPath}`
		: "";
	const transcriptLine = result.transcriptPath
		? `\nTranscript: ${result.transcriptPath}`
		: "";
	return `${result.text}${pathLine}${transcriptLine}`;
}

export default function claudeCodePlanner(pi: ExtensionAPI) {
	pi.registerTool({
		name: "claude_code_plan",
		label: "Claude Code Plan",
		description:
			"Ask interactive Claude Code to produce a planning-only response through a pseudo-TTY. Uses Claude Code subscription flow, not claude -p.",
		parameters: {
			type: "object",
			properties: {
				request: {
					type: "string",
					description: "Planning request for Claude Code.",
				},
				timeoutSeconds: {
					type: "number",
					description: "Maximum seconds to wait. Defaults to 240.",
				},
			},
			required: ["request"],
		},
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			onUpdate?.({
				content: [
					{
						type: "text",
						text: "Launching interactive Claude Code planner...",
					},
				],
			});
			const result = await runClaudePlanner(pi, {
				cwd: ctx.cwd || process.cwd(),
				request: params.request,
				timeoutSeconds: params.timeoutSeconds,
			});
			return {
				content: [{ type: "text", text: formatResult(result) }],
				isError: !result.ok,
				details: result.details,
			};
		},
	});

	pi.registerCommand("claude-plan", {
		description: "Ask interactive Claude Code for a planning-only response",
		handler: async (args, ctx) => {
			const request = args.trim();
			if (!request) {
				ctx.ui.notify("Usage: /claude-plan <planning request>", "warning");
				return;
			}
			ctx.ui.setStatus("claude-plan", "Planning with Claude Code...");
			try {
				const result = await runClaudePlanner(pi, {
					cwd: ctx.cwd || process.cwd(),
					request,
				});
				pi.sendMessage({
					customType: "claude-code-plan",
					display: true,
					content: formatResult(result),
					details: result.details,
				});
				ctx.ui.notify(
					result.ok
						? "Claude Code plan ready."
						: "Claude Code planning failed.",
					result.ok ? "info" : "error",
				);
			} finally {
				ctx.ui.setStatus("claude-plan", undefined);
			}
		},
	});
}
