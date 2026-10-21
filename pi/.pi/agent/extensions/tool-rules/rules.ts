import { isAbsolute } from "node:path";

// Best-effort command-text guardrails. These regexes match text, not shell
// semantics: quoted examples can match, and aliases, scripts, dynamically
// built commands, and `cd`/`-chdir` into a new scope are not modeled.

export interface Rule {
	name: string;
	action: "block" | "confirm";
	condition: RegExp;
	message: string;
	snowflakeOnly?: boolean;
}

export interface ShellInvocation {
	toolName: string;
	commands: readonly string[];
	cwd?: string;
}

export type Decision =
	| { action: "block"; reason: string }
	| { action: "confirm"; rules: readonly Rule[] };

export const MALFORMED = "malformed";

// Text within one simple command: never crosses ; & | or a newline.
const SEG = String.raw`[^;&|\n\r]*`;
// End of a word, so `merge-base`, `plan.out`, and `--force-if-includes` miss.
const END = String.raw`(?![\w.-])`;
const short = (letters: string) => String.raw`-[A-Za-z]*[${letters}][A-Za-z]*${END}`;

export const RULES: readonly Rule[] = [
	{
		name: "snowflake-terraform",
		action: "block",
		snowflakeOnly: true,
		condition: new RegExp(
			String.raw`\b(?:terraform|terragrunt)\b${SEG}\s(?:plan|apply)${END}`,
		),
		message:
			"Terraform/Terragrunt plan/apply for Snowflake times out in Pi; leave it for the user to run.",
	},
	{
		name: "uv-dbt",
		action: "block",
		condition: /\buv\s+(?:run\s+)?(?:-[^\s;&|]*\s+)*dbt\b/,
		message: "Use the installed dbt command, not uv.",
	},
	{
		name: "git-merge",
		action: "confirm",
		condition: new RegExp(
			String.raw`\bgit\b${SEG}\smerge${END}|\bgh\b${SEG}\spr\s+merge${END}`,
		),
		message: "Merging requires explicit approval.",
	},
	{
		name: "force-push",
		action: "confirm",
		condition: new RegExp(
			String.raw`\bgit\b${SEG}\spush${END}${SEG}\s(?:--force(?:-with-lease)?(?![\w-])|${short("f")}|\+[^\s;&|])`,
		),
		message: "Force pushes require explicit approval.",
	},
	{
		name: "recursive-force-rm",
		action: "confirm",
		condition: new RegExp(
			String.raw`(?<![\w-])rm${END}` +
				String.raw`(?=${SEG}\s(?:--recursive${END}|${short("rR")}))` +
				String.raw`(?=${SEG}\s(?:--force${END}|${short("f")}))`,
		),
		message: "Recursive force deletion requires explicit approval.",
	},
];

const NEEDS_ABSOLUTE_CWD =
	"Terraform/Terragrunt plan/apply needs an explicit absolute cwd for this tool so the Snowflake scope can be checked; retry with an absolute cwd.";

// Documented path heuristic, not verified provider identity.
function inSnowflakeScope(cwd: string) {
	return cwd.split("/").includes("snowflake-objects");
}

const CONTEXT_EXECUTE = new Set(["ctx_execute", "context_mode_ctx_execute"]);
const CONTEXT_BATCH = new Set([
	"ctx_batch_execute",
	"context_mode_ctx_batch_execute",
]);

/**
 * Shell text a recognized tool will run, or MALFORMED when a recognized tool's
 * shell payload has an unexpected shape. Context-mode cwd is used only when
 * explicitly absolute; omitted or relative values resolve elsewhere.
 */
export function extractInvocation(
	toolName: string,
	input: unknown,
	sessionCwd: string,
): ShellInvocation | typeof MALFORMED | undefined {
	const fields = (input && typeof input === "object" ? input : {}) as Record<
		string,
		unknown
	>;
	if (toolName === "bash") {
		return typeof fields.command === "string"
			? { toolName, commands: [fields.command], cwd: sessionCwd }
			: MALFORMED;
	}
	const execute = CONTEXT_EXECUTE.has(toolName);
	if (!execute && !CONTEXT_BATCH.has(toolName)) return undefined;
	if (fields.cwd !== undefined && typeof fields.cwd !== "string") return MALFORMED;
	const cwd =
		typeof fields.cwd === "string" && isAbsolute(fields.cwd)
			? fields.cwd
			: undefined;
	if (execute) {
		if (typeof fields.language !== "string") return MALFORMED;
		if (fields.language !== "shell") return undefined;
		return typeof fields.code === "string"
			? { toolName, commands: [fields.code], cwd }
			: MALFORMED;
	}
	// The context-mode schema requires at least one batch command.
	if (!Array.isArray(fields.commands) || fields.commands.length === 0) {
		return MALFORMED;
	}
	const commands: string[] = [];
	for (const item of fields.commands) {
		const command = item && typeof item === "object" ? item.command : undefined;
		if (typeof command !== "string") return MALFORMED;
		commands.push(command);
	}
	return { toolName, commands, cwd };
}

/** Classify every command first; any block wins over all confirms. */
export function classify(invocation: ShellInvocation): Decision | undefined {
	const blocks = new Set<string>();
	const confirms: Rule[] = [];
	for (const command of invocation.commands) {
		for (const rule of RULES) {
			if (!rule.condition.test(command)) continue;
			if (rule.snowflakeOnly && invocation.cwd === undefined) {
				blocks.add(`${rule.name}: ${NEEDS_ABSOLUTE_CWD}`);
			} else if (rule.snowflakeOnly && !inSnowflakeScope(invocation.cwd ?? "")) {
				continue;
			} else if (rule.action === "block") {
				blocks.add(`${rule.name}: ${rule.message}`);
			} else if (!confirms.includes(rule)) {
				confirms.push(rule);
			}
		}
	}
	if (blocks.size > 0) {
		return { action: "block", reason: `Blocked by tool-rules. ${[...blocks].join(" ")}` };
	}
	return confirms.length > 0 ? { action: "confirm", rules: confirms } : undefined;
}
