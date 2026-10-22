import { createHash } from "node:crypto";

type Row = Record<string, unknown>;
export interface FailureBatch {
	outcome: string;
	message: unknown;
	toolResults: readonly unknown[];
}
const isRow = (value: unknown): value is Row =>
	value !== null && typeof value === "object" && !Array.isArray(value);
// Waiting/polling tools legitimately repeat while background work progresses.
const EXEMPT = new Set(["get_subagent_result", "lens_diagnostics"]);

function canonical(value: unknown): string {
	const text = JSON.stringify(value, (_key, item) => {
		if (["function", "symbol", "bigint"].includes(typeof item)) {
			throw new Error("Unsupported signature value");
		}
		if (!isRow(item)) return item;
		const prototype = Object.getPrototypeOf(item);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new Error("Unsupported signature object");
		}
		return Object.fromEntries(
			Object.keys(item)
				.sort()
				.map((key) => [key, item[key]]),
		);
	});
	if (text === undefined) throw new Error("Missing signature");
	return text;
}

// Digest of an all-failed batch; undefined when the turn is not one.
// Results must match calls one-to-one, so duplicate call IDs cannot pass.
function signature(turn: FailureBatch): string | undefined {
	if (turn.outcome !== "completed" || !turn.toolResults.length) return;
	if (!isRow(turn.message) || !Array.isArray(turn.message.content)) return;
	const calls = turn.message.content.filter(
		(item): item is Row => isRow(item) && item.type === "toolCall",
	);
	if (calls.length !== turn.toolResults.length) return;
	const seen = new Set<string>();
	const items: string[] = [];
	for (const result of turn.toolResults) {
		if (!isRow(result) || result.isError !== true) return;
		const id = result.toolCallId;
		if (typeof id !== "string" || seen.has(id)) return;
		seen.add(id);
		const call = calls.find((item) => item.id === id);
		if (!call || typeof call.name !== "string") return;
		if (call.name !== result.toolName || EXEMPT.has(call.name)) return;
		items.push(
			canonical({
				name: call.name,
				arguments: call.arguments,
				content: result.content,
				details: result.details,
			}),
		);
	}
	return createHash("sha256").update(canonical(items.sort())).digest("hex");
}

export class FailureLoopDetector {
	private previous: string | undefined;
	private count = 0;

	reset(): void {
		this.previous = undefined;
		this.count = 0;
	}

	observe(turn: FailureBatch): boolean {
		let next: string | undefined;
		try {
			next = signature(turn);
		} catch {
			this.reset();
			return false;
		}
		if (next === undefined) {
			this.reset();
			return false;
		}
		this.count = next === this.previous ? this.count + 1 : 1;
		this.previous = next;
		return this.count === 3;
	}
}
