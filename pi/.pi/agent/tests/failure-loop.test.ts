import { describe, expect, test } from "bun:test";
import failureLoop from "../extensions/failure-loop/index.ts";
import { FailureLoopDetector } from "../extensions/failure-loop/detector.ts";

// Detector and adapter behavior. The real session boundary is covered in
// session-flow.test.ts.

const SECRET = "SECRET_SENTINEL_91c4";

interface Call {
	id: string;
	name: string;
	args?: unknown;
	error?: string;
	details?: unknown;
	isError?: boolean;
	resultName?: string;
}

function turn(calls: Call[], outcome = "completed") {
	return {
		outcome,
		message: {
			content: [
				{ type: "text", text: "trying" },
				...calls.map((call) => ({
					type: "toolCall",
					id: call.id,
					name: call.name,
					arguments: call.args ?? {},
				})),
			],
		},
		toolResults: calls.map((call) => ({
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.resultName ?? call.name,
			content: [{ type: "text", text: call.error ?? "boom" }],
			details: call.details,
			isError: call.isError ?? true,
		})),
	};
}

const failing = (id = "a", extra: Partial<Call> = {}) =>
	turn([{ id, name: "bash", args: { command: "make" }, ...extra }]);

function observeAll(detector: FailureLoopDetector, turns: unknown[]) {
	return turns.map((item) => detector.observe(item as never));
}

describe("failure-loop detector", () => {
	test("nudges exactly once on the third identical failed batch", () => {
		const detector = new FailureLoopDetector();
		expect(
			observeAll(detector, [
				failing("1"),
				failing("2"),
				failing("3"),
				failing("4"),
				failing("5"),
			]),
		).toEqual([false, false, true, false, false]);
	});

	test("treats reordered keys and batch order as equivalent", () => {
		const detector = new FailureLoopDetector();
		const a = (id: string, args: unknown) => ({
			id,
			name: "read",
			args,
			details: { b: 1, a: [2, 1] },
		});
		const b = (id: string) => ({ id, name: "bash", args: { command: "x" } });
		expect(
			observeAll(detector, [
				turn([a("1", { path: "p", limit: 2 }), b("2")]),
				turn([b("3"), a("4", { limit: 2, path: "p" })]),
				turn([a("5", { path: "p", limit: 2 }), b("6")]),
			]),
		).toEqual([false, false, true]);
	});

	test("changed arguments, errors, or details start a new streak", () => {
		for (const changed of [
			{ args: { command: "make test" } },
			{ error: "different" },
			{ details: { exitCode: 2 } },
		]) {
			const detector = new FailureLoopDetector();
			expect(
				observeAll(detector, [
					failing("1"),
					failing("2"),
					failing("3", changed),
					failing("4"),
				]),
			).toEqual([false, false, false, false]);
		}
	});

	test("success, mixed, exempt, toolless, malformed, or aborted turns reset", () => {
		const resets: unknown[] = [
			failing("x", { isError: false }),
			turn([
				{ id: "x", name: "bash", args: { command: "make" } },
				{ id: "y", name: "read", isError: false },
			]),
			turn([{ id: "x", name: "get_subagent_result", args: { id: "a" } }]),
			turn([{ id: "x", name: "lens_diagnostics", args: { waitMs: 9 } }]),
			turn([]),
			turn([{ id: "x", name: "bash" }], "aborted"),
			turn([{ id: "x", name: "bash" }], "error"),
			failing("x", { resultName: "read" }),
			failing("x", { args: { value: 1n } }),
			failing("x", { args: { when: new Date(0) } }),
			{ ...failing("x"), toolResults: [null] },
			{ ...failing("x"), message: { content: "text" } },
			{ ...failing("x"), toolResults: [...failing("x").toolResults, null] },
			null,
		];
		for (const reset of resets) {
			const detector = new FailureLoopDetector();
			expect(
				observeAll(detector, [
					failing("1"),
					failing("2"),
					reset,
					failing("3"),
					failing("4"),
				]),
			).toEqual([false, false, false, false, false]);
			expect(detector.observe(failing("5") as never)).toBe(true);
		}
	});

	test("requires complete one-to-one call ID matching", () => {
		const detector = new FailureLoopDetector();
		const duplicate = turn([
			{ id: "same", name: "bash", args: { command: "make" } },
			{ id: "same", name: "bash", args: { command: "make" } },
		]);
		const unmatched = failing("1");
		unmatched.toolResults[0].toolCallId = "other";
		for (const bad of [duplicate, duplicate, duplicate, unmatched]) {
			expect(detector.observe(bad as never)).toBe(false);
		}
	});

	test("reset permits a later new streak", () => {
		const detector = new FailureLoopDetector();
		observeAll(detector, [failing("1"), failing("2")]);
		detector.reset();
		expect(observeAll(detector, [failing("3"), failing("4"), failing("5")])).toEqual([
			false,
			false,
			true,
		]);
	});
});

type Handler = (event: unknown, ctx?: unknown) => unknown;

function loadAdapter() {
	const handlers = new Map<string, Handler[]>();
	failureLoop({
		on(name: string, handler: Handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
	} as never);
	const emit = (name: string, event: unknown = { type: name }) =>
		(handlers.get(name) ?? []).map((handler) => handler(event))[0];
	return { handlers, emit };
}

describe("failure-loop adapter", () => {
	test("returns one generic displayed entry without continuation", async () => {
		const { emit } = loadAdapter();
		const secret = () =>
			failing("1", { args: { command: SECRET }, error: `${SECRET} denied` });
		expect(await emit("turn_end", secret())).toBeUndefined();
		expect(await emit("turn_end", secret())).toBeUndefined();
		const result = (await emit("turn_end", secret())) as Record<string, unknown>;
		expect(Object.keys(result)).toEqual(["entries"]);
		const entries = result.entries as Record<string, unknown>[];
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			type: "custom_message",
			customType: "failure-loop",
			display: true,
		});
		expect(typeof entries[0].content).toBe("string");
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	test("resets on lifecycle boundaries", async () => {
		for (const boundary of [
			"input",
			"agent_start",
			"session_start",
			"session_compact",
		]) {
			const { emit, handlers } = loadAdapter();
			expect(handlers.has(boundary)).toBe(true);
			await emit("turn_end", failing("1"));
			await emit("turn_end", failing("2"));
			await emit(boundary);
			expect(await emit("turn_end", failing("3"))).toBeUndefined();
		}
	});

	test("keeps state per extension instance", async () => {
		const first = loadAdapter();
		const second = loadAdapter();
		await first.emit("turn_end", failing("1"));
		await first.emit("turn_end", failing("2"));
		await second.emit("turn_end", failing("3"));
		expect(await first.emit("turn_end", failing("4"))).toBeDefined();
	});
});
