// @ts-nocheck
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type Envelope = "RO" | "RW";

const DEFAULT_TIMEOUT_MS = 120_000;
const EXPLICIT_PREFIX = "$cortex-run";

function aiKitRoot(): string {
	return (
		process.env.SNOWFLAKE_AI_KIT_ROOT ||
		join(homedir(), ".local/share/snowflake-ai-kit")
	);
}

function executeScript(): string {
	return join(
		aiKitRoot(),
		"plugins/cortex-code/scripts/router/execute_cortex.py",
	);
}

function hasSnowflakeIntent(text: string): boolean {
	return /\b(snowflake|cortex|snowsql|snow\s+sql|warehouse|warehouses|dynamic\s+table|dynamic\s+tables)\b/i.test(
		text,
	);
}

function isLikelyWrite(text: string): boolean {
	return /\b(insert|update|delete|merge|copy\s+into|create|alter|drop|truncate|rename|grant|revoke|suspend|resume|resize)\b/i.test(
		text,
	);
}

function buildArgs(
	prompt: string,
	envelope: Envelope,
	resumeLast: boolean,
): string[] {
	const args = [
		"-u",
		executeScript(),
		"--prompt",
		prompt,
		"--envelope",
		envelope,
		"--codex",
	];
	if (resumeLast) args.push("--resume-last");
	return args;
}

function formatFailure(message: string): string {
	return `Cortex Code is not ready: ${message}\n\nRun the dotfiles automation:\n\n  cd ~/Repositories/dotfiles\n  mise run snowflake-ai-kit-install\n\nThat task clones/updates Snowflake AI Kit, runs its installer, verifies \`cortex\`, and tests \`snow connection test -c default\`.`;
}

async function runCortex(
	pi: ExtensionAPI,
	prompt: string,
	envelope: Envelope,
	resumeLast: boolean,
	signal?: AbortSignal,
) {
	const script = executeScript();
	if (!existsSync(script)) {
		return {
			ok: false,
			text: formatFailure(`missing Snowflake AI Kit script at ${script}`),
		};
	}

	const which = await pi.exec(
		"bash",
		["-lc", "command -v cortex && cortex --version"],
		{
			timeout: 10_000,
		},
	);
	if (which.code !== 0) {
		return {
			ok: false,
			text: formatFailure("`cortex` is not on PATH"),
		};
	}

	const result = await pi.exec(
		"python3",
		buildArgs(prompt, envelope, resumeLast),
		{
			signal,
			timeout: DEFAULT_TIMEOUT_MS,
		},
	);
	const stdout = result.stdout?.trim() || "";
	const stderr = result.stderr?.trim() || "";
	const output = [stdout, stderr && `stderr:\n${stderr}`]
		.filter(Boolean)
		.join("\n\n");

	if (result.code !== 0) {
		return {
			ok: false,
			text: output || `Cortex Code failed with exit code ${result.code}`,
		};
	}

	return { ok: true, text: output || "Cortex Code completed with no output." };
}

export default function cortexCodeExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "cortex_run",
		label: "Cortex Code",
		description:
			"Run a Snowflake request through Snowflake Cortex Code CLI. Defaults to read-only RO envelope.",
		parameters: Type.Object({
			prompt: Type.String({
				description: "The Snowflake task or question to send to Cortex Code.",
			}),
			envelope: Type.Optional(
				Type.Union([Type.Literal("RO"), Type.Literal("RW")], {
					description:
						"RO for read-only work, RW for Snowflake mutations. Defaults to RO.",
				}),
			),
			resumeLast: Type.Optional(
				Type.Boolean({
					description:
						"Resume the last Cortex Code session for follow-up prompts.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const prompt = params.prompt.trim();
			const envelope = (params.envelope || "RO") as Envelope;
			const resumeLast = Boolean(params.resumeLast);

			if (!prompt) {
				return {
					content: [{ type: "text", text: "Missing Cortex prompt." }],
					isError: true,
				};
			}

			if (envelope === "RW") {
				const ok = ctx.hasUI
					? await ctx.ui.confirm(
							"Cortex Code RW envelope",
							`Allow Cortex Code to run with write permissions?\n\n${prompt}`,
						)
					: false;
				if (!ok) {
					return {
						content: [
							{
								type: "text",
								text: "Cortex Code RW execution was not approved.",
							},
						],
						isError: true,
					};
				}
			}

			onUpdate?.({
				content: [
					{ type: "text", text: `Running Cortex Code (${envelope})...` },
				],
			});
			const result = await runCortex(pi, prompt, envelope, resumeLast, signal);
			return {
				content: [{ type: "text", text: result.text }],
				isError: !result.ok,
				details: { envelope, resumeLast, aiKitRoot: aiKitRoot() },
			};
		},
	});

	pi.registerCommand("cortex-run", {
		description: "Run a Snowflake prompt through Cortex Code",
		handler: async (args, ctx) => {
			let prompt = args.trim();
			let envelope: Envelope = isLikelyWrite(prompt) ? "RW" : "RO";
			let resumeLast = false;

			while (prompt.startsWith("--")) {
				if (prompt.startsWith("--rw ")) {
					envelope = "RW";
					prompt = prompt.slice(5).trim();
					continue;
				}
				if (prompt.startsWith("--ro ")) {
					envelope = "RO";
					prompt = prompt.slice(5).trim();
					continue;
				}
				if (prompt.startsWith("--resume ")) {
					resumeLast = true;
					prompt = prompt.slice(9).trim();
					continue;
				}
				break;
			}

			if (!prompt) {
				ctx.ui.notify(
					"Usage: /cortex-run [--ro|--rw] [--resume] <prompt>",
					"warning",
				);
				return;
			}

			if (envelope === "RW") {
				const ok = await ctx.ui.confirm(
					"Cortex Code RW envelope",
					`Allow Cortex Code to run with write permissions?\n\n${prompt}`,
				);
				if (!ok) return;
			}

			ctx.ui.setStatus("cortex-code", `Running Cortex Code (${envelope})...`);
			try {
				const result = await runCortex(pi, prompt, envelope, resumeLast);
				pi.sendMessage({
					customType: "cortex-code-result",
					content: result.text,
					display: true,
					details: {
						ok: result.ok,
						envelope,
						resumeLast,
						aiKitRoot: aiKitRoot(),
					},
				});
				ctx.ui.notify(
					result.ok ? "Cortex Code completed." : "Cortex Code failed.",
					result.ok ? "info" : "error",
				);
			} finally {
				ctx.ui.setStatus("cortex-code", undefined);
			}
		},
	});

	pi.on("input", async (event) => {
		if (event.source === "extension") return { action: "continue" };
		const text = event.text.trim();
		if (!text.startsWith(EXPLICIT_PREFIX)) return { action: "continue" };

		const prompt = text.slice(EXPLICIT_PREFIX.length).trim();
		if (!prompt) {
			return {
				action: "transform",
				text: "Use the cortex-code skill. Explain that $cortex-run needs a prompt.",
			};
		}

		const envelope = isLikelyWrite(prompt) ? "RW" : "RO";
		return {
			action: "transform",
			text:
				`Use the cortex_run tool now with envelope ${envelope}. ` +
				`If envelope RW is requested, ask for confirmation first. Prompt: ${prompt}`,
			images: event.images,
		};
	});

	pi.on("before_agent_start", async (event) => {
		if (
			!hasSnowflakeIntent(event.prompt) ||
			event.prompt.trim().startsWith(EXPLICIT_PREFIX)
		) {
			return;
		}

		return {
			message: {
				customType: "cortex-code-routing-hint",
				content:
					"Snowflake/Cortex intent detected. Prefer the cortex-code skill and the " +
					"cortex_run tool for Snowflake work. Use RO for read-only requests and " +
					"ask before RW mutations.",
				display: false,
			},
		};
	});
}
