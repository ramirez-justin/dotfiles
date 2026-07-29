import { describe, expect, test } from "bun:test";
import { basename, join } from "node:path";
import type { MemoryCandidate } from "./candidate.ts";
import type { MutationResult } from "./memory-store.ts";
import type { RepositoryIdentity } from "./project-identity.ts";
import * as governorModule from "./index.ts";

interface MemoryGovernorDependencies {
	memoryRoot: string;
	resolveIdentity(cwd: string): Promise<RepositoryIdentity>;
	buildPrompt(input: {
		memoryRoot: string;
		identity: RepositoryIdentity;
		advisoryCandidate?: MemoryCandidate;
	}): Promise<{ text: string; warnings: string[] }>;
	ensureScopedProject(input: {
		root: string;
		identity: RepositoryIdentity;
	}): Promise<{ path: string; created: boolean }>;
	mutateFile(input: {
		path: string;
		spec: unknown;
		mutate(text: string):
			| { changed: boolean; text: string; summary: string }
			| Promise<{ changed: boolean; text: string; summary: string }>;
	}): Promise<MutationResult>;
	auditTargets(root: string): Promise<string[]>;
	createReadTool(deps: {
		memoryRoot: string;
		resolveCurrentIdentity(cwd?: string): Promise<RepositoryIdentity | undefined>;
	}): any;
	detectCandidate(text: string): MemoryCandidate | undefined;
}

const createMemoryGovernor =
	"createMemoryGovernor" in governorModule
		? (governorModule.createMemoryGovernor as (
				pi: never,
				overrides: Partial<MemoryGovernorDependencies>,
			) => void)
		: () => {
				throw new Error("createMemoryGovernor is not implemented");
			};

const identity: RepositoryIdentity = {
	kind: "remote",
	canonicalKey: "remote:github.com/acme/service",
	coordinate: "github.com/acme/service",
	displayName: "acme/service",
	filename: "github.com--acme--service.md",
};

const templates: Record<string, string> = {
	"USER.md": "# User Memory\n\n## Rules\n\n- Safe.\n\n## Preferences\n",
	"WORKFLOWS.md":
		"# Workflow Memory\n\n## Rules\n\n- Safe.\n\n## Conventions\n",
	"PROJECTS.md":
		"# Project Memory\n\n## Rules\n\n- Safe.\n\n## Scoped Projects\n\n## Unscoped Facts\n",
	[identity.filename]:
		"# Project Memory\n\n## Rules\n\n- Safe.\n\n## Facts\n",
};

type EventHandler = (event: any, ctx: any) => Promise<any> | any;
type CommandHandler = (args: string, ctx: any) => Promise<any> | any;

function createExtensionHarness(
	overrides: Partial<MemoryGovernorDependencies> = {},
) {
	const events = new Map<string, EventHandler>();
	const commands = new Map<string, CommandHandler>();
	const tools = new Map<string, any>();
	const notifications: Array<{ text: string; level: string }> = [];
	const sentMessages: any[] = [];
	const mutations: Array<{ path: string; text: string }> = [];
	const identityCwds: string[] = [];
	const promptInputs: Array<{
		memoryRoot: string;
		identity: RepositoryIdentity;
		advisoryCandidate?: MemoryCandidate;
	}> = [];
	const memory = new Map<string, string>();
	const memoryRoot = "/memory";
	for (const [filename, text] of Object.entries(templates)) {
		const path =
			filename === identity.filename
				? join(memoryRoot, "projects", filename)
				: join(memoryRoot, filename);
		memory.set(path, text);
	}

	const deps: Partial<MemoryGovernorDependencies> = {
		memoryRoot,
		async resolveIdentity(cwd) {
			identityCwds.push(cwd);
			return identity;
		},
		async buildPrompt(input) {
			promptInputs.push(input);
			const advisory = input.advisoryCandidate
				? `\nbehavioral correction: ${input.advisoryCandidate.content}`
				: "";
			return {
				text: `<durable_memory>fresh-${promptInputs.length}${advisory}</durable_memory>`,
				warnings: [],
			};
		},
		async ensureScopedProject({ root, identity: currentIdentity }) {
			return {
				path: join(root, "projects", currentIdentity.filename),
				created: false,
			};
		},
		async mutateFile(input) {
			const current = memory.get(input.path) ?? "";
			const mutation = await input.mutate(current);
			mutations.push({ path: input.path, text: mutation.text });
			if (!mutation.changed) {
				return {
					status: "unchanged",
					text: mutation.text,
					summary: mutation.summary,
				};
			}
			memory.set(input.path, mutation.text);
			return {
				status: "written",
				text: mutation.text,
				summary: mutation.summary,
			};
		},
		async auditTargets(root) {
			return [
				join(root, "USER.md"),
				join(root, "WORKFLOWS.md"),
				join(root, "PROJECTS.md"),
				join(root, "projects", identity.filename),
			];
		},
		createReadTool(readerDeps) {
			return {
				name: "memory_read",
				async execute(
					_toolCallId: string,
					_parameters: unknown,
					_signal: AbortSignal,
					_onUpdate: unknown,
					ctx: { cwd: string },
				) {
					const currentIdentity =
						await readerDeps.resolveCurrentIdentity(ctx.cwd);
					return {
						content: [
							{ type: "text", text: currentIdentity?.canonicalKey ?? "missing" },
						],
					};
				},
			};
		},
		...overrides,
	};

	const pi = {
		on(name: string, handler: EventHandler) {
			events.set(name, handler);
		},
		registerCommand(
			name: string,
			definition: { handler: CommandHandler },
		) {
			commands.set(name, definition.handler);
		},
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		sendMessage(message: any) {
			sentMessages.push(message);
		},
		exec: async () => ({ stdout: "", code: 1 }),
	};

	function context(cwd: string, hasUI: boolean) {
		return {
			cwd,
			hasUI,
			ui: {
				notify(text: string, level: string) {
					if (!hasUI) throw new Error("UI used without ctx.hasUI");
					notifications.push({ text, level });
				},
			},
		};
	}

	return {
		pi: pi as never,
		deps,
		events,
		commands,
		tools,
		notifications,
		sentMessages,
		mutations,
		identityCwds,
		promptInputs,
		memory,
		async input(text: string, options: { cwd?: string; hasUI?: boolean } = {}) {
			return events.get("input")!(
				{ text, source: "interactive" },
				context(options.cwd ?? "/work/service", options.hasUI ?? true),
			);
		},
		async beforeAgentStart(
			systemPrompt: string,
			options: { cwd?: string; hasUI?: boolean } = {},
		) {
			return events.get("before_agent_start")!(
				{ prompt: "task", systemPrompt },
				context(options.cwd ?? "/work/service", options.hasUI ?? true),
			);
		},
		async audit(options: { cwd?: string; hasUI?: boolean } = {}) {
			return commands.get("memory-audit")!(
				"",
				context(options.cwd ?? "/work/service", options.hasUI ?? true),
			);
		},
	};
}

describe("memory governor lifecycle", () => {
	test("registers the reliable memory lifecycle", () => {
		const harness = createExtensionHarness();
		createMemoryGovernor(harness.pi, harness.deps);

		expect(harness.events.has("input")).toBe(true);
		expect(harness.events.has("before_agent_start")).toBe(true);
		expect(harness.commands.has("memory-audit")).toBe(true);
		expect(harness.tools.has("memory_read")).toBe(true);
	});

	test("keeps an inferred candidate private until one run then clears it", async () => {
		const harness = createExtensionHarness();
		createMemoryGovernor(harness.pi, harness.deps);

		await harness.input("You keep forgetting to verify the diff.");
		expect(harness.notifications).toEqual([]);
		expect(harness.sentMessages).toEqual([]);

		const first = await harness.beforeAgentStart("base prompt");
		expect(first.systemPrompt).toContain("behavioral correction");
		expect(first.systemPrompt).toContain("You keep forgetting");
		const second = await harness.beforeAgentStart(first.systemPrompt);
		expect(second.systemPrompt).not.toContain("You keep forgetting");
	});

	test("builds fresh memory once per run and leaves one memory block", async () => {
		const harness = createExtensionHarness();
		createMemoryGovernor(harness.pi, harness.deps);

		const first = await harness.beforeAgentStart(
			"base\n<durable_memory>stale</durable_memory>",
			{ cwd: "/work/one" },
		);
		const second = await harness.beforeAgentStart(first.systemPrompt, {
			cwd: "/work/two",
		});

		expect(harness.promptInputs).toHaveLength(2);
		expect(harness.identityCwds).toEqual(["/work/one", "/work/two"]);
		expect(first.systemPrompt.match(/<durable_memory>/g)).toHaveLength(1);
		expect(second.systemPrompt.match(/<durable_memory>/g)).toHaveLength(1);
		expect(second.systemPrompt).toContain("fresh-2");
	});

	test("memory_read resolves identity from execution cwd", async () => {
		const harness = createExtensionHarness();
		createMemoryGovernor(harness.pi, harness.deps);
		const tool = harness.tools.get("memory_read");

		await tool.execute(
			"call-1",
			{ scope: "current_project" },
			new AbortController().signal,
			undefined,
			{ cwd: "/tool/cwd" },
		);
		expect(harness.identityCwds).toEqual(["/tool/cwd"]);
	});
});

describe("explicit memory writes", () => {
	test("rejects unsafe project memory before persistent state access", async () => {
		const persistentCalls: string[] = [];
		const harness = createExtensionHarness({
			async resolveIdentity() {
				persistentCalls.push("resolveIdentity");
				return identity;
			},
			async ensureScopedProject() {
				persistentCalls.push("ensureScopedProject");
				return { path: "/memory/projects/unsafe.md", created: false };
			},
			async mutateFile() {
				persistentCalls.push("mutateFile");
				return { status: "written", text: "", summary: "written" };
			},
		});
		createMemoryGovernor(harness.pi, harness.deps);

		await harness.input("Remember: In this repo API_KEY=abc");

		expect(persistentCalls).toEqual([]);
		expect(harness.notifications).toEqual([
			{ text: "Memory rejected: secret-like content", level: "warning" },
		]);
	});

	test("only explicit Remember writes", async () => {
		const harness = createExtensionHarness();
		createMemoryGovernor(harness.pi, harness.deps);

		await harness.input("I prefer concise answers.");
		expect(harness.mutations).toEqual([]);
		await harness.input("Remember: Prefer concise answers.");
		expect(harness.mutations).toHaveLength(1);
		expect(harness.mutations[0].path).toBe("/memory/USER.md");
		expect(harness.mutations[0].text).toContain("## Preferences");
		expect(harness.mutations[0].text).toContain("- Prefer concise answers.");
	});

	test("routes workflow, project, and unscoped candidates safely", async () => {
		let inferred: MemoryCandidate | undefined;
		const harness = createExtensionHarness({
			detectCandidate(text) {
				if (text === "unscoped") return inferred;
				return undefined;
			},
		});
		createMemoryGovernor(harness.pi, harness.deps);

		inferred = {
			content: "Use the fallback fact.",
			reason: "explicit-memory",
			scope: "unscoped",
			autoWrite: true,
		};
		await harness.input("unscoped");

		const paths = harness.mutations.map((item) => item.path);
		expect(paths).toEqual(["/memory/PROJECTS.md"]);
		expect(harness.mutations[0].text).toContain("## Unscoped Facts");
	});

	test("routes workflow and project facts to their scoped sections", async () => {
		const harness = createExtensionHarness();
		createMemoryGovernor(harness.pi, harness.deps);

		await harness.input(
			"Remember: For PR reviews, use line-specific comments.",
		);
		await harness.input("Remember: In this repo, run mise run link.", {
			cwd: "/work/project",
		});

		expect(harness.mutations.map((item) => item.path)).toEqual([
			"/memory/WORKFLOWS.md",
			`/memory/projects/${identity.filename}`,
		]);
		expect(harness.mutations[0].text).toContain("## Conventions");
		expect(harness.mutations[1].text).toContain("## Facts");
		expect(harness.identityCwds).toContain("/work/project");
	});

	test("notifies only through available UI for rejected and conflict results", async () => {
		const results: MutationResult[] = [
			{ status: "rejected", text: "", reason: "unsafe content" },
			{ status: "conflict", path: "/memory/USER.md" },
		];
		const harness = createExtensionHarness({
			mutateFile: async () => results.shift()!,
		});
		createMemoryGovernor(harness.pi, harness.deps);

		await harness.input("Remember: Prefer concise answers.");
		await harness.input("Remember: Prefer direct answers.");
		expect(harness.notifications.map((notice) => notice.text).join("\n")).toMatch(
			/rejected.*unsafe content/i,
		);
		expect(harness.notifications.map((notice) => notice.text).join("\n")).toMatch(
			/conflict/i,
		);

		const noUi = createExtensionHarness({
			mutateFile: async () => ({
				status: "rejected",
				text: "",
				reason: "unsafe content",
			}),
		});
		createMemoryGovernor(noUi.pi, noUi.deps);
		await noUi.input("Remember: Prefer concise answers.", { hasUI: false });
		expect(noUi.notifications).toEqual([]);
	});
});

describe("memory audit", () => {
	test("audits top-level and indexed files sequentially through safe mutation", async () => {
		const order: string[] = [];
		let active = 0;
		let maximumActive = 0;
		const harness = createExtensionHarness({
			async mutateFile(input) {
				active += 1;
				maximumActive = Math.max(maximumActive, active);
				order.push(input.path);
				const duplicate = `${templates[basename(input.path)] ?? templates[identity.filename]}\n- Same.\n- Same.\n`;
				const mutation = await input.mutate(duplicate);
				await Promise.resolve();
				active -= 1;
				return {
					status: "written",
					text: mutation.text,
					summary: mutation.summary,
				};
			},
		});
		createMemoryGovernor(harness.pi, harness.deps);

		await harness.audit();
		expect(order).toEqual([
			"/memory/USER.md",
			"/memory/WORKFLOWS.md",
			"/memory/PROJECTS.md",
			`/memory/projects/${identity.filename}`,
		]);
		expect(maximumActive).toBe(1);
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0].content).toMatch(
			/USER\.md: removed 1 duplicate/i,
		);
		expect(harness.notifications).toEqual([
			{ text: "Memory audit complete.", level: "info" },
		]);
	});

	test("notifies an audit target enumeration failure when UI is available", async () => {
		const failure = new Error(
			"Project index drift: projects/github.com--acme--missing.md",
		);
		const harness = createExtensionHarness({
			auditTargets: async () => {
				throw failure;
			},
		});
		createMemoryGovernor(harness.pi, harness.deps);

		await harness.audit();
		expect(harness.notifications).toEqual([
			{ text: `Memory audit failed: ${failure.message}`, level: "error" },
		]);
		expect(harness.mutations).toEqual([]);
		expect(harness.sentMessages).toEqual([]);
	});

	test("rethrows an audit target enumeration failure without UI", async () => {
		const failure = new Error(
			"Project index drift: projects/github.com--acme--missing.md",
		);
		const harness = createExtensionHarness({
			auditTargets: async () => {
				throw failure;
			},
		});
		createMemoryGovernor(harness.pi, harness.deps);

		await expect(harness.audit({ hasUI: false })).rejects.toBe(failure);
		expect(harness.notifications).toEqual([]);
		expect(harness.mutations).toEqual([]);
		expect(harness.sentMessages).toEqual([]);
	});

	test("reports audit outcomes without touching UI when unavailable", async () => {
		const harness = createExtensionHarness();
		createMemoryGovernor(harness.pi, harness.deps);

		await harness.audit({ hasUI: false });
		expect(harness.notifications).toEqual([]);
		expect(harness.sentMessages).toHaveLength(1);
	});
});
