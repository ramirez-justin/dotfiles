import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import toolRules from "../extensions/tool-rules/index.ts";
import {
	classify,
	extractInvocation,
	MALFORMED,
	RULES,
} from "../extensions/tool-rules/rules.ts";

// Offline tests: no command matched here is ever executed, and the session
// test uses a local faux provider with no credentials or network access.

const REPO = "/work/repo";
const SCOPED = "/work/infra/snowflake-objects/prod";

function decide(command: string, cwd: string | undefined = REPO) {
	return classify({ toolName: "bash", commands: [command], cwd });
}

function ruleNames(command: string, cwd?: string) {
	const decision = decide(command, cwd);
	if (!decision) return "allow";
	if (decision.action === "block") return `block:${decision.reason}`;
	return `confirm:${decision.rules.map((rule) => rule.name).join(",")}`;
}

function expectRule(commands: string[], rule: string, cwd?: string) {
	for (const command of commands) {
		const action = RULES.find((r) => r.name === rule)?.action;
		const result = ruleNames(command, cwd);
		expect({ command, result: result.startsWith(`${action}:`) }).toEqual({
			command,
			result: true,
		});
		expect({ command, named: result.includes(rule) }).toEqual({
			command,
			named: true,
		});
	}
}

function expectAllow(commands: string[], cwd?: string) {
	for (const command of commands) {
		expect({ command, result: ruleNames(command, cwd) }).toEqual({
			command,
			result: "allow",
		});
	}
}

describe("fixed rule table", () => {
	test("has exactly the five guardrails", () => {
		expect(RULES.map((rule) => [rule.name, rule.action])).toEqual([
			["snowflake-terraform", "block"],
			["uv-dbt", "block"],
			["git-merge", "confirm"],
			["force-push", "confirm"],
			["recursive-force-rm", "confirm"],
		]);
		for (const rule of RULES) expect(rule.condition.flags).not.toMatch(/[gy]/);
	});

	test("blocks uv-based dbt in direct, wrapped, and chained forms", () => {
		expectRule(
			[
				"uv run dbt parse",
				"uv dbt build",
				"uv run --frozen dbt parse",
				"/opt/homebrew/bin/uv run dbt run",
				"env DBT_TARGET=dev uv run dbt parse",
				"DBT_TARGET=dev uv run dbt parse",
				"bash -lc 'uv run dbt parse'",
				'zsh -ic "uv run dbt test"',
				"cd project && uv run dbt parse",
				"ls; uv run dbt parse",
				"ls\nuv run dbt parse",
				"false || uv dbt build",
			],
			"uv-dbt",
		);
	});

	test("blocks Snowflake Terraform/Terragrunt plan/apply in scope", () => {
		const commands = [
			"terraform plan",
			"terragrunt apply",
			"/usr/local/bin/terraform apply -auto-approve",
			"terraform -chdir=modules/warehouse plan",
			"TF_LOG=debug terragrunt run-all plan",
			"env A=1 terraform plan -out=tfplan",
			"bash -lc 'terragrunt plan'",
			"terraform fmt && terraform apply",
		];
		expectRule(commands, "snowflake-terraform", SCOPED);
		expectRule(["terraform plan"], "snowflake-terraform", "/a/snowflake-objects");
		for (const cwd of [
			"/work/infra",
			"/work/snowflake-objects-old/prod",
			"/work/my-snowflake-objects",
			"/work/snowflake-objectsx",
		]) {
			expectAllow(commands, cwd);
		}
		expectAllow(
			["terraform fmt", "terraform validate", "terraform show plan.out"],
			SCOPED,
		);
	});

	test("confirms git merge and gh pr merge", () => {
		expectRule(
			[
				"git merge feature",
				"git -C /work/repo merge main",
				"/usr/bin/git merge feature",
				"env GIT_EDITOR=true git merge feature",
				"gh pr merge 12 --squash",
				"zsh -ic 'git merge feature'",
				"git fetch && git merge origin/main",
			],
			"git-merge",
		);
	});

	test("confirms force pushes before and after remote args", () => {
		expectRule(
			[
				"git push -f",
				"git push --force origin main",
				"git push origin main --force",
				"git push origin main -f",
				"git push --force-with-lease",
				"git push --force-with-lease=main:abc123 origin main",
				"git -C /work/repo push -uf origin feature",
				"git push origin HEAD --force-with-lease",
				"bash -lc 'git push -f origin main'",
				"git push origin +main",
				"git push origin +HEAD:main",
				"git push origin +refs/heads/feature:refs/heads/main",
				"git -C /work/repo push origin +main",
				"zsh -ic 'git push origin +HEAD:main'",
			],
			"force-push",
		);
	});

	test("confirms recursive force deletion in all flag forms", () => {
		expectRule(
			[
				"rm -rf build",
				"rm -fr build",
				"rm -r -f build",
				"rm -f -r build",
				"rm -Rf build",
				"rm -R -f build",
				"rm --recursive --force build",
				"rm -r --force build",
				"/bin/rm -rf build",
				"bash -lc 'rm -rf build'",
				"make clean; rm -rf dist",
			],
			"recursive-force-rm",
		);
	});

	test("allows benign commands and does not cross shell separators", () => {
		expectAllow([
			"git status",
			"git diff",
			"git push",
			"git push origin main",
			"git push -u origin feature-fix",
			"git push --follow-tags",
			"git push --force-if-includes",
			"git push origin main && ls -f",
			"git push origin main:refs/heads/main",
			"git push origin main && echo +1",
			"git push origin main; expr 1 +2",
			"git merge-base main HEAD",
			"git log --merges",
			"gh pr view 12",
			"dbt parse",
			"dbt run --select model",
			"uv run pytest",
			"uv sync",
			"rm file",
			"rm -f file",
			"rm -r dir",
			"rm -r dir && ls -f",
			"rm -r dir; touch -f marker",
			"docker run --rm -f image",
			"terraform plan",
		]);
	});

	test("conservatively matches quoted examples (not a shell parser)", () => {
		expect(ruleNames("printf 'uv run dbt'")).toStartWith("block:");
		expect(ruleNames("echo 'git merge main'")).toBe("confirm:git-merge");
		expect(ruleNames('rg "rm -rf" docs')).toBe("confirm:recursive-force-rm");
	});
});

describe("producer extraction", () => {
	const CONTEXT_EXECUTE = ["ctx_execute", "context_mode_ctx_execute"];
	const CONTEXT_BATCH = ["ctx_batch_execute", "context_mode_ctx_batch_execute"];

	test("uses Bash command and session cwd", () => {
		expect(extractInvocation("bash", { command: "ls" }, REPO)).toEqual({
			toolName: "bash",
			commands: ["ls"],
			cwd: REPO,
		});
	});

	test("reads shell code and batch commands from context-mode tools", () => {
		for (const name of CONTEXT_EXECUTE) {
			expect(
				extractInvocation(
					name,
					{ language: "shell", code: "git status", cwd: SCOPED },
					REPO,
				),
			).toEqual({ toolName: name, commands: ["git status"], cwd: SCOPED });
		}
		for (const name of CONTEXT_BATCH) {
			expect(
				extractInvocation(
					name,
					{
						commands: [
							{ label: "a", command: "ls" },
							{ label: "b", command: "git diff" },
						],
					},
					REPO,
				),
			).toEqual({ toolName: name, commands: ["ls", "git diff"], cwd: undefined });
		}
	});

	test("never resolves omitted, relative, or home-relative context cwd", () => {
		for (const cwd of [undefined, "repo", "./repo", "~/repo", "$HOME/repo"]) {
			const invocation = extractInvocation(
				"ctx_execute",
				{ language: "shell", code: "ls", cwd },
				REPO,
			);
			expect(invocation).toEqual({
				toolName: "ctx_execute",
				commands: ["ls"],
				cwd: undefined,
			});
		}
	});

	test("ignores non-shell code and unrelated tools", () => {
		for (const language of ["javascript", "python", "typescript"]) {
			expect(
				extractInvocation(
					"ctx_execute",
					{
						language,
						code: "require('child_process').execSync('git merge x')",
					},
					REPO,
				),
			).toBeUndefined();
		}
		for (const name of [
			"read",
			"write",
			"ctx_execute_file",
			"ctx_fetch_and_index",
			"context_mode_ctx_execute_file",
			"my_ctx_execute",
			"ctx_execute_extra",
			"Bash",
		]) {
			expect(
				extractInvocation(name, { command: "uv run dbt", code: "git merge" }, REPO),
			).toBeUndefined();
		}
	});

	test("fails closed on malformed recognized shell payloads", () => {
		const cases: [string, unknown][] = [
			["bash", { command: 5 }],
			["bash", null],
			["ctx_execute", { code: "ls" }],
			["ctx_execute", { language: 1, code: "ls" }],
			["ctx_execute", { language: "shell" }],
			["ctx_execute", { language: "shell", code: "ls", cwd: 5 }],
			["context_mode_ctx_execute", { language: "shell", code: ["ls"] }],
			["ctx_batch_execute", {}],
			["ctx_batch_execute", { commands: "ls" }],
			["ctx_batch_execute", { commands: ["ls"] }],
			["ctx_batch_execute", { commands: [{ label: "a" }] }],
			["context_mode_ctx_batch_execute", { commands: [null] }],
			["ctx_batch_execute", { commands: [], cwd: {} }],
			["ctx_batch_execute", { commands: [] }],
			["context_mode_ctx_batch_execute", { commands: [], cwd: REPO }],
		];
		for (const [name, input] of cases) {
			expect({ name, input, out: extractInvocation(name, input, REPO) }).toEqual(
				{ name, input, out: MALFORMED },
			);
		}
	});

	test("asks for an absolute cwd before scoped Terraform decisions", () => {
		for (const name of [...CONTEXT_EXECUTE, ...CONTEXT_BATCH]) {
			for (const cwd of [undefined, "snowflake-objects", "~/snowflake-objects"]) {
				const input = name.includes("batch")
					? { commands: [{ label: "tf", command: "terraform plan" }], cwd }
					: { language: "shell", code: "terraform plan", cwd };
				const invocation = extractInvocation(name, input, REPO);
				if (!invocation || invocation === MALFORMED) throw new Error(name);
				const decision = classify(invocation);
				expect(decision?.action).toBe("block");
				expect(decision?.action === "block" && decision.reason).toContain(
					"absolute cwd",
				);
			}
		}
		const outside = extractInvocation(
			"ctx_execute",
			{ language: "shell", code: "terraform plan", cwd: "/work/infra" },
			REPO,
		);
		if (!outside || outside === MALFORMED) throw new Error("outside");
		expect(classify(outside)).toBeUndefined();
		const inside = { ...outside, cwd: SCOPED };
		expect(classify(inside)?.action).toBe("block");
	});

	test("other rules do not need a context-mode cwd", () => {
		const unknown = (commands: string[]) =>
			classify({ toolName: "ctx_batch_execute", commands, cwd: undefined });
		expect(unknown(["git status", "dbt parse"])).toBeUndefined();
		expect(unknown(["git merge x"])?.action).toBe("confirm");
	});

	test("any block wins over confirms across the whole batch", () => {
		for (const commands of [
			["git merge x", "rm -rf build", "uv run dbt parse"],
			["uv run dbt parse", "git merge x", "rm -rf build"],
		]) {
			const decision = classify({
				toolName: "ctx_batch_execute",
				commands,
				cwd: "/work/repo",
			});
			expect(decision?.action).toBe("block");
		}
		const confirms = classify({
			toolName: "ctx_batch_execute",
			commands: ["git merge x", "ls", "git push -f"],
			cwd: undefined,
		});
		expect(
			confirms?.action === "confirm" && confirms.rules.map((r) => r.name),
		).toEqual(["git-merge", "force-push"]);
	});
});

// Synthetic hook harness: one registered handler and a scripted UI.
type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

function loadHook() {
	let handler: Handler | undefined;
	toolRules({
		on(name: string, fn: Handler) {
			if (name === "tool_call") handler = fn;
		},
	} as never);
	if (!handler) throw new Error("tool_call handler was not registered");
	return handler;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

interface Prompt {
	title: string;
	message: string;
	opts: { signal?: AbortSignal } | undefined;
	answer: ReturnType<typeof deferred<boolean>>;
}

function fakeContext(options: { hasUI?: boolean; signal?: AbortSignal } = {}) {
	const prompts: Prompt[] = [];
	const ctx = {
		cwd: REPO,
		hasUI: options.hasUI ?? true,
		signal: options.signal,
		ui: {
			confirm(title: string, message: string, opts?: { signal?: AbortSignal }) {
				const answer = deferred<boolean>();
				prompts.push({ title, message, opts, answer });
				return answer.promise;
			},
		},
	};
	return { ctx, prompts };
}

const bash = (command: string) => ({
	type: "tool_call",
	toolName: "bash",
	toolCallId: crypto.randomUUID(),
	input: { command },
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("exact-call consent hook", () => {
	const SECRET = "PAYLOAD_SENTINEL_7f3a";

	test("returns undefined without prompting when nothing matches", async () => {
		const hook = loadHook();
		const { ctx, prompts } = fakeContext();
		expect(await hook(bash(`git status ${SECRET}`), ctx)).toBeUndefined();
		expect(
			await hook(
				{
					type: "tool_call",
					toolName: "ctx_execute",
					toolCallId: "x",
					input: { language: "python", code: "git merge" },
				},
				ctx,
			),
		).toBeUndefined();
		expect(prompts).toHaveLength(0);
	});

	test("blocks prohibited and malformed calls without prompting or echoing", async () => {
		const hook = loadHook();
		const { ctx, prompts } = fakeContext();
		const blocked = (await hook(
			bash(`git merge x; uv run dbt parse --vars ${SECRET}`),
			ctx,
		)) as { block: boolean; reason: string };
		expect(blocked.block).toBe(true);
		expect(blocked.reason).toContain("uv-dbt");
		expect(blocked.reason).toContain("installed dbt");
		expect(blocked.reason).not.toContain(SECRET);
		const malformed = (await hook(
			{
				type: "tool_call",
				toolName: "ctx_batch_execute",
				toolCallId: "x",
				input: { commands: [`git merge ${SECRET}`] },
			},
			ctx,
		)) as { block: boolean; reason: string };
		expect(malformed.block).toBe(true);
		expect(malformed.reason).not.toContain(SECRET);
		expect(prompts).toHaveLength(0);
	});

	test("one approval covers only the displayed invocation", async () => {
		const hook = loadHook();
		const controller = new AbortController();
		const { ctx, prompts } = fakeContext({ signal: controller.signal });
		const first = hook(bash(`git merge ${SECRET}`), ctx);
		await tick();
		expect(prompts).toHaveLength(1);
		expect(prompts[0].message).toContain("Tool: bash");
		expect(prompts[0].message).toContain(`Cwd: ${REPO}`);
		expect(prompts[0].message).toContain(`git merge ${SECRET}`);
		expect(prompts[0].opts?.signal).toBe(controller.signal);
		prompts[0].answer.resolve(true);
		expect(await first).toBeUndefined();

		const second = hook(bash(`git merge ${SECRET}`), ctx);
		await tick();
		expect(prompts).toHaveLength(2);
		prompts[1].answer.resolve(false);
		const denied = (await second) as { block: boolean; reason: string };
		expect(denied.block).toBe(true);
		expect(denied.reason).toContain("git-merge");
		expect(denied.reason).not.toContain(SECRET);
	});

	test("aggregates a batch into one dialog with an unknown-cwd label", async () => {
		const hook = loadHook();
		const { ctx, prompts } = fakeContext();
		const call = hook(
			{
				type: "tool_call",
				toolName: "context_mode_ctx_batch_execute",
				toolCallId: "x",
				input: {
					commands: [
						{ label: "a", command: "git merge feature" },
						{ label: "b", command: "git push -f origin feature" },
					],
				},
			},
			ctx,
		);
		await tick();
		expect(prompts).toHaveLength(1);
		const { message } = prompts[0];
		expect(message).toContain("Tool: context_mode_ctx_batch_execute");
		expect(message).toContain("Cwd: unknown");
		expect(message).toContain("git merge feature");
		expect(message).toContain("git push -f origin feature");
		prompts[0].answer.resolve(true);
		expect(await call).toBeUndefined();
	});

	test("denies without UI, on cancellation, and on dialog failure", async () => {
		const hook = loadHook();
		const headless = fakeContext({ hasUI: false });
		expect(await hook(bash("rm -rf build"), headless.ctx)).toMatchObject({
			block: true,
		});
		expect(headless.prompts).toHaveLength(0);

		const aborted = new AbortController();
		aborted.abort();
		const early = fakeContext({ signal: aborted.signal });
		expect(await hook(bash("rm -rf build"), early.ctx)).toMatchObject({
			block: true,
		});
		expect(early.prompts).toHaveLength(0);

		const late = new AbortController();
		const lateCtx = fakeContext({ signal: late.signal });
		const afterAnswer = hook(bash("rm -rf build"), lateCtx.ctx);
		await tick();
		late.abort();
		lateCtx.prompts[0].answer.resolve(true);
		expect(await afterAnswer).toMatchObject({ block: true });

		const failing = fakeContext();
		const thrown = hook(bash("rm -rf build"), failing.ctx);
		await tick();
		failing.prompts[0].answer.reject(new Error(`ui broke ${SECRET}`));
		const failed = (await thrown) as { block: boolean; reason: string };
		expect(failed.block).toBe(true);
		expect(failed.reason).not.toContain(SECRET);

		// The failure released the queue for the next call.
		const next = hook(bash("rm -rf build"), failing.ctx);
		await tick();
		expect(failing.prompts).toHaveLength(2);
		failing.prompts[1].answer.resolve(true);
		expect(await next).toBeUndefined();
	});

	test("serializes dialogs and keeps answers independent", async () => {
		const hook = loadHook();
		const { ctx, prompts } = fakeContext();
		const queuedAbort = new AbortController();
		const queued = fakeContext({ signal: queuedAbort.signal });
		const a = hook(bash("git merge a"), ctx);
		const b = hook(bash("git merge b"), ctx);
		const c = hook(bash("git merge c"), queued.ctx);
		await tick();
		expect(prompts.map((p) => p.message.includes("git merge a"))).toEqual([true]);
		prompts[0].answer.resolve(false);
		expect(await a).toMatchObject({ block: true });
		await tick();
		expect(prompts).toHaveLength(2);
		expect(prompts[1].message).toContain("git merge b");
		queuedAbort.abort();
		prompts[1].answer.resolve(true);
		expect(await b).toBeUndefined();
		// Cancelled while queued: denied without ever showing a dialog.
		expect(await c).toMatchObject({ block: true });
		expect(queued.prompts).toHaveLength(0);
	});
});

// Offline real-session proof through normal extension discovery.
const piBin = Bun.which("pi");
if (!piBin) throw new Error("pi is not on PATH; install it with mise");
const PI_ENTRY = realpathSync(
	Bun.resolveSync("@earendil-works/pi-coding-agent", dirname(realpathSync(piBin))),
);
const PI_AI_ENTRY = realpathSync(
	Bun.resolveSync("@earendil-works/pi-ai", PI_ENTRY),
);

const root = mkdtempSync(join(tmpdir(), "tool-rules-"));
const agentDir = join(root, "agent");
const project = join(root, "project");
const ENV_KEYS = [
	"PI_CODING_AGENT_DIR",
	"PI_CODING_AGENT_SESSION_DIR",
	"PI_OFFLINE",
] as const;
const originalEnv = Object.fromEntries(
	ENV_KEYS.map((key) => [key, process.env[key]]),
);

type Sdk = typeof import("@earendil-works/pi-coding-agent");
type Ai = typeof import("@earendil-works/pi-ai");
let sdk: Sdk;
let ai: Ai;

beforeAll(async () => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
	process.env.PI_OFFLINE = "1";
	mkdirSync(project, { recursive: true });
	cpSync(
		join(import.meta.dir, "../extensions/tool-rules"),
		join(agentDir, "extensions/tool-rules"),
		{ recursive: true },
	);
	sdk = await import(PI_ENTRY);
	ai = await import(PI_AI_ENTRY);
});

afterAll(() => {
	for (const key of ENV_KEYS) {
		const value = originalEnv[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

describe("installed Pi session", () => {
	test("intercepts matching calls before execution", async () => {
		const { createFauxCore, fauxAssistantMessage, fauxToolCall } = ai;
		const calls: Record<string, [string, Record<string, unknown>]> = {
			blocked: [
				"bash",
				{ command: "printf 'uv run dbt'; printf marker > blocked.txt" },
			],
			benign: ["bash", { command: "printf marker > benign.txt" }],
			ctxBlocked: [
				"ctx_batch_execute",
				{
					commands: [
						{ label: "ok", command: "echo ok" },
						{ label: "no", command: "printf 'uv run dbt'" },
					],
				},
			],
			ctxHeadless: [
				"context_mode_ctx_execute",
				{ language: "shell", code: "printf 'git merge x'", cwd: project },
			],
			ctxBenign: [
				"ctx_batch_execute",
				{ commands: [{ label: "ok", command: "echo ok" }] },
			],
		};
		const faux = createFauxCore({ api: "fixture-api", provider: "fixture" });
		faux.setResponses(
			Array.from({ length: 20 }, () => (context) => {
				const last = context.messages.at(-1);
				const text = last?.role === "user" ? JSON.stringify(last.content) : "";
				const scenario = Object.keys(calls).find((key) =>
					text.includes(`SCENARIO:${key}`),
				);
				if (!scenario) return fauxAssistantMessage("done");
				const [name, args] = calls[scenario];
				return fauxAssistantMessage(fauxToolCall(name, args), {
					stopReason: "toolUse",
				});
			}) as never,
		);
		const modelRuntime = await sdk.ModelRuntime.create({
			authPath: join(root, "auth.json"),
			modelsPath: null,
			modelsStorePath: join(root, "models-store.json"),
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		modelRuntime.registerProvider("fixture", {
			api: "fixture-api",
			// Never contacted: streamSimple answers locally.
			baseUrl: "http://fixture.invalid",
			apiKey: "fixture-not-a-secret",
			streamSimple: faux.streamSimple,
			models: [
				{
					id: "parent",
					name: "parent",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 100_000,
					maxTokens: 1_000,
				},
			],
		});
		const executed: string[] = [];
		const fakeContextTool = (name: string) => ({
			name,
			label: name,
			description: "Fake context-mode shell tool",
			parameters: { type: "object", properties: {} },
			async execute() {
				executed.push(name);
				return { content: [{ type: "text", text: "ran" }], details: undefined };
			},
		});
		const resourceLoader = new sdk.DefaultResourceLoader({
			cwd: project,
			agentDir,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			extensionFactories: [
				(pi) => {
					pi.registerTool(fakeContextTool("ctx_batch_execute") as never);
					pi.registerTool(fakeContextTool("context_mode_ctx_execute") as never);
				},
			],
		});
		await resourceLoader.reload();
		const loaded = resourceLoader
			.getExtensions()
			.extensions.map((extension) => extension.path);
		expect(loaded.some((path) => path.endsWith("tool-rules/index.ts"))).toBe(true);
		const { session } = await sdk.createAgentSession({
			cwd: project,
			agentDir,
			modelRuntime,
			resourceLoader,
			model: modelRuntime.getModel("fixture", "parent"),
			sessionManager: sdk.SessionManager.inMemory(project),
			settingsManager: sdk.SettingsManager.inMemory(),
		});
		await session.bindExtensions({});
		const lastToolResult = () => {
			const result = session.messages.findLast((m) => m.role === "toolResult");
			return JSON.stringify(result);
		};
		try {
			await session.prompt("SCENARIO:blocked");
			expect(lastToolResult()).toContain("tool-rules");
			expect(lastToolResult()).toContain("uv-dbt");
			expect(existsSync(join(project, "blocked.txt"))).toBe(false);

			await session.prompt("SCENARIO:benign");
			expect(existsSync(join(project, "benign.txt"))).toBe(true);

			await session.prompt("SCENARIO:ctxBlocked");
			await session.prompt("SCENARIO:ctxHeadless");
			expect(lastToolResult()).toContain("git-merge");
			expect(executed).toEqual([]);

			await session.prompt("SCENARIO:ctxBenign");
			expect(executed).toEqual(["ctx_batch_execute"]);
		} finally {
			session.dispose();
		}
	}, 60_000);
});
