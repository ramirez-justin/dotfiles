// Read-only, conservative handoff preflight. Reads only the documented
// pi-subagents registry (Symbol.for("pi-subagents:manager")): hasRunning()
// includes queued work, and getRecord(id) returns live top-level records.
// It is not an atomic lock against other extensions' later switch handlers.

type Row = Record<string, unknown>;
interface GuardContext {
	isIdle(): boolean;
	hasPendingMessages(): boolean;
	sessionManager: { getBranch(): readonly unknown[] };
}
const isRow = (value: unknown): value is Row =>
	value !== null && typeof value === "object" && !Array.isArray(value);
export const UNAVAILABLE = "Cannot verify subagent state; handoff cancelled.";

export function handoffProblem(
	ctx: GuardContext,
	registry: unknown,
): string | undefined {
	try {
		if (ctx.isIdle() !== true || ctx.hasPendingMessages() !== false) {
			return "Finish pending work before handing off.";
		}
		if (
			!isRow(registry) ||
			typeof registry.hasRunning !== "function" ||
			typeof registry.getRecord !== "function"
		) {
			return UNAVAILABLE;
		}
		if (registry.hasRunning() !== false) {
			return "Finish queued or running subagents before handing off.";
		}
		const branch = ctx.sessionManager.getBranch();
		if (!Array.isArray(branch)) return UNAVAILABLE;
		for (const entry of branch) {
			if (
				!isRow(entry) ||
				entry.type !== "custom" ||
				entry.customType !== "subagents:record"
			) {
				continue;
			}
			if (!isRow(entry.data) || typeof entry.data.id !== "string" || !entry.data.id) {
				return UNAVAILABLE;
			}
			const record: unknown = registry.getRecord(entry.data.id);
			// Missing: historical record from an earlier process; history stays stored.
			if (record === undefined) continue;
			if (!isRow(record)) return UNAVAILABLE;
			// Optional flag: undefined means unread.
			if (record.resultConsumed !== true) {
				return (
					"Ask Pi to collect pending results with " +
					"get_subagent_result, then retry /handoff."
				);
			}
		}
		return undefined;
	} catch {
		return UNAVAILABLE;
	}
}
