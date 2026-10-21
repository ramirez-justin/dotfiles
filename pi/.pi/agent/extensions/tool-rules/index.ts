// @ts-nocheck -- Pi runtime types are installed outside this repository.
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { classify, extractInvocation, MALFORMED, type Rule } from "./rules.ts";

// Blocks prohibited shell calls and asks for exact-call consent before
// approval-required ones. Heuristic guardrail, not a sandbox: see README.

async function ask(ctx: ExtensionContext, message: string) {
	if (!ctx.hasUI || ctx.signal?.aborted) return false;
	const approved = await ctx.ui.confirm("Approve guarded command?", message, {
		signal: ctx.signal,
	});
	return approved === true && !ctx.signal?.aborted;
}

function denied(rules: readonly Rule[]) {
	const names = rules.map((rule) => rule.name).join(", ");
	const messages = rules.map((rule) => rule.message).join(" ");
	return `Blocked by tool-rules (${names}): not approved. ${messages} Approval covers one exact call and needs an interactive UI.`;
}

export default function toolRules(pi: ExtensionAPI) {
	// One dialog at a time; each call gets its own answer, never a cached one.
	let queue: Promise<unknown> = Promise.resolve();

	pi.on("tool_call", async (event, ctx) => {
		const invocation = extractInvocation(event.toolName, event.input, ctx.cwd);
		if (invocation === undefined) return undefined;
		if (invocation === MALFORMED) {
			return {
				block: true,
				reason: `Blocked by tool-rules: ${event.toolName} input has an unrecognized shell payload shape.`,
			};
		}
		const decision = classify(invocation);
		if (!decision) return undefined;
		if (decision.action === "block") {
			return { block: true, reason: decision.reason };
		}
		const { commands } = invocation;
		const message = [
			`Tool: ${invocation.toolName}`,
			`Cwd: ${invocation.cwd ?? "unknown (no absolute cwd supplied)"}`,
			`Rules: ${decision.rules.map((rule) => rule.name).join(", ")}`,
			"",
			...commands.map((command, i) =>
				commands.length > 1 ? `[${i + 1}] ${command}` : command,
			),
		].join("\n");
		const answer = queue.then(() => ask(ctx, message));
		queue = answer.catch(() => undefined);
		const approved = await answer.catch(() => false);
		return approved ? undefined : { block: true, reason: denied(decision.rules) };
	});
}
