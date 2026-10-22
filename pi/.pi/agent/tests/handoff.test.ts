import { describe, expect, test } from "bun:test";
import { handoffProblem } from "../extensions/handoff/guard.ts";

// Pure guard behavior. The real command, runtime switch, and installed
// subagents registry are covered in session-flow.test.ts.

const SECRET = "SECRET_SENTINEL_5d2e";

const record = (id: unknown) => ({
	type: "custom",
	customType: "subagents:record",
	data: { id, result: SECRET },
});

function context(
	options: {
		idle?: unknown;
		pending?: unknown;
		branch?: unknown;
		throwing?: "idle" | "pending" | "branch";
	} = {},
) {
	const fail = () => {
		throw new Error(SECRET);
	};
	return {
		isIdle: () => (options.throwing === "idle" ? fail() : (options.idle ?? true)),
		hasPendingMessages: () =>
			options.throwing === "pending" ? fail() : (options.pending ?? false),
		sessionManager: {
			getBranch: () =>
				options.throwing === "branch" ? fail() : (options.branch ?? []),
		},
	} as never;
}

function registry(records: Record<string, unknown> = {}, running: unknown = false) {
	return {
		hasRunning: () => running,
		getRecord: (id: string) => records[id],
	};
}

const blocked = (problem: string | undefined) => {
	expect(problem).toBeString();
	expect(problem).not.toContain(SECRET);
	return problem as string;
};

describe("handoff guard", () => {
	test("allows idle sessions with no subagent activity", () => {
		expect(handoffProblem(context(), registry())).toBeUndefined();
		expect(
			handoffProblem(
				context({
					branch: [
						{ type: "message", message: { role: "user" } },
						{ type: "custom", customType: "other", data: {} },
						record("done"),
						record("historical"),
					],
				}),
				registry({ done: { id: "done", resultConsumed: true } }),
			),
		).toBeUndefined();
	});

	test("requires strictly idle with nothing pending", () => {
		for (const options of [
			{ idle: false },
			{ idle: "yes" },
			{ pending: true },
			{ pending: "no" },
		]) {
			const problem = handoffProblem(context(options), registry());
			expect(blocked(problem)).toContain("pending");
		}
	});

	test("blocks queued or running subagents", () => {
		for (const running of [true, undefined, "no"]) {
			const api = { ...registry(), hasRunning: () => running };
			blocked(handoffProblem(context(), api));
		}
		expect(blocked(handoffProblem(context(), registry({}, true)))).toContain(
			"subagents",
		);
	});

	test("fails closed on missing, incompatible, or throwing integration", () => {
		const throwing = {
			hasRunning: () => {
				throw new Error(SECRET);
			},
			getRecord: () => undefined,
		};
		for (const value of [
			undefined,
			null,
			{},
			{ hasRunning: () => false },
			{ getRecord: () => undefined },
			[],
			throwing,
		]) {
			expect(blocked(handoffProblem(context(), value))).toContain(
				"Cannot verify",
			);
		}
		for (const throwingPart of ["idle", "pending", "branch"] as const) {
			blocked(handoffProblem(context({ throwing: throwingPart }), registry()));
		}
		const recordThrows = {
			hasRunning: () => false,
			getRecord: () => {
				throw new Error(SECRET);
			},
		};
		blocked(handoffProblem(context({ branch: [record("a")] }), recordThrows));
		blocked(handoffProblem(context({ branch: "nope" }), registry()));
	});

	test("blocks unread live results and points to get_subagent_result", () => {
		for (const live of [
			{ resultConsumed: false, result: SECRET },
			{ result: SECRET },
			{ resultConsumed: "true" },
		]) {
			const problem = blocked(
				handoffProblem(
					context({ branch: [record("a")] }),
					registry({ a: live }),
				),
			);
			expect(problem).toContain("get_subagent_result");
		}
	});

	test("fails closed on malformed subagent metadata or records", () => {
		for (const bad of [record(""), record(5), { ...record("a"), data: null }]) {
			blocked(handoffProblem(context({ branch: [bad] }), registry()));
		}
		for (const live of [null, "settled", 5, []]) {
			blocked(
				handoffProblem(context({ branch: [record("a")] }), registry({ a: live })),
			);
		}
	});
});
