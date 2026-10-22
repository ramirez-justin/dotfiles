import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Offline native-session checks for the global session-flow configuration
// and extensions. Only the model provider and terminal UI are fakes; the
// session, extension loader, runtime switch, and installed pi-subagents
// extension are real. No credentials or network are used.

const AGENT_SOURCE = join(import.meta.dir, "..");
const piBin = Bun.which("pi");
if (!piBin) throw new Error("pi is not on PATH; install it with mise");
const PI_ENTRY = realpathSync(
	Bun.resolveSync("@earendil-works/pi-coding-agent", dirname(realpathSync(piBin))),
);
const PI_AI_ENTRY = realpathSync(Bun.resolveSync("@earendil-works/pi-ai", PI_ENTRY));
// Installed package, loaded by absolute path; nothing is installed or copied.
const SUBAGENTS = join(
	homedir(),
	".pi/agent/npm/node_modules/@tintinweb/pi-subagents/src/index.ts",
);
const REGISTRY = Symbol.for("pi-subagents:manager");
const SECRET = "SECRET_SENTINEL_e71b";

const root = mkdtempSync(join(tmpdir(), "session-flow-"));
const agentDir = join(root, "agent");
const project = join(root, "project");
const sessionsDir = join(root, "sessions");
const ENV_KEYS = [
	"PI_CODING_AGENT_DIR",
	"PI_CODING_AGENT_SESSION_DIR",
	"PI_OFFLINE",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

type Sdk = typeof import("@earendil-works/pi-coding-agent");
type Ai = typeof import("@earendil-works/pi-ai");
let sdk: Sdk;
let ai: Ai;
let modelRuntime: Awaited<ReturnType<Sdk["ModelRuntime"]["create"]>>;

// --- Faux model boundary -------------------------------------------------

interface Request {
	kind: "summary" | "handoff" | "main";
	text: string;
	messages: { role: string; text: string; toolsAdded: number }[];
}
const requests: Request[] = [];
// Main session requests declare tools; tool-less side requests are
// attributed to the phase under test, not identified by prompt wording.
let sideKind: "summary" | "handoff" = "summary";
type HandoffReply = () => unknown;
let handoffReply: HandoffReply = () => "DRAFT: continue the focused task";

const textOf = (content: unknown) =>
	typeof content === "string" ? content : JSON.stringify(content);

function respond(context: { messages: Record<string, unknown>[] }) {
	const { fauxAssistantMessage, fauxToolCall } = ai;
	const messages = context.messages.map((message) => ({
		role: String(message.role),
		text: textOf(message.content),
		toolsAdded: Array.isArray(message.toolsAdded) ? message.toolsAdded.length : 0,
	}));
	const text = JSON.stringify(messages);
	const declared = messages.reduce((sum, message) => sum + message.toolsAdded, 0);
	const kind = declared > 0 ? "main" : sideKind;
	requests.push({ kind, text, messages });
	if (kind === "summary") return fauxAssistantMessage("FAUX-SUMMARY of old work");
	if (kind === "handoff") {
		const reply = handoffReply();
		if (reply instanceof Error) throw reply;
		return typeof reply === "string" ? fauxAssistantMessage(reply) : reply;
	}
	const lastUser = messages.findLastIndex((message) => message.role === "user");
	const prompt = messages[lastUser]?.text ?? "";
	const results = messages
		.slice(lastUser)
		.filter((message) => message.role === "toolResult").length;
	if (prompt.includes("SCENARIO:compact") && results === 0) {
		return fauxAssistantMessage(fauxToolCall("big", {}), { stopReason: "toolUse" });
	}
	if (prompt.includes("SCENARIO:loop") && results < 3) {
		return fauxAssistantMessage(fauxToolCall("flaky", { target: SECRET }), {
			stopReason: "toolUse",
		});
	}
	return fauxAssistantMessage("main reply");
}

const tools = (pi: { registerTool(tool: unknown): void }) => {
	pi.registerTool({
		name: "big",
		label: "big",
		description: "Return a large synthetic result",
		parameters: { type: "object", properties: {} },
		async execute() {
			const text = `RECENT-RESULT ${"x".repeat(84_000)}`;
			return { content: [{ type: "text", text }], details: undefined };
		},
	});
	pi.registerTool({
		name: "flaky",
		label: "flaky",
		description: "Always fail identically",
		parameters: { type: "object", properties: {} },
		async execute() {
			throw new Error(`FLAKY-ERROR ${SECRET}`);
		},
	});
};

beforeAll(async () => {
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_CODING_AGENT_SESSION_DIR = sessionsDir;
	process.env.PI_OFFLINE = "1";
	mkdirSync(project, { recursive: true });
	// Copy only the intended global settings: no packages, auth, or models.
	const settings = JSON.parse(readFileSync(join(AGENT_SOURCE, "settings.json"), "utf8"));
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({ compaction: settings.compaction }),
	);
	cpSync(join(AGENT_SOURCE, "subagents.json"), join(agentDir, "subagents.json"));
	for (const name of ["failure-loop", "handoff"]) {
		cpSync(join(AGENT_SOURCE, "extensions", name), join(agentDir, "extensions", name), {
			recursive: true,
		});
	}
	sdk = await import(PI_ENTRY);
	ai = await import(PI_AI_ENTRY);
	const faux = ai.createFauxCore({ api: "fixture-api", provider: "fixture" });
	faux.setResponses(Array.from({ length: 200 }, () => respond) as never);
	modelRuntime = await sdk.ModelRuntime.create({
		authPath: join(root, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(root, "models-store.json"),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const model = (id: string, contextWindow: number) => ({
		id,
		name: id,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: 1_000,
	});
	modelRuntime.registerProvider("fixture", {
		api: "fixture-api",
		// Never contacted: streamSimple answers locally.
		baseUrl: "http://fixture.invalid",
		apiKey: "fixture-not-a-secret",
		streamSimple: faux.streamSimple,
		// small: native trigger 70000 - 16384 = 53616 tokens.
		models: [model("parent", 200_000), model("small", 70_000)],
	} as never);
});

afterAll(() => {
	for (const key of ENV_KEYS) {
		const value = originalEnv[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	rmSync(root, { recursive: true, force: true });
});

async function plainSession(modelId: string) {
	const resourceLoader = new sdk.DefaultResourceLoader({
		cwd: project,
		agentDir,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		extensionFactories: [tools as never],
	});
	await resourceLoader.reload();
	const { session } = await sdk.createAgentSession({
		cwd: project,
		agentDir,
		modelRuntime,
		resourceLoader,
		model: modelRuntime.getModel("fixture", modelId),
		sessionManager: sdk.SessionManager.inMemory(project),
		settingsManager: sdk.SettingsManager.create(project, agentDir),
	});
	await session.bindExtensions({});
	return session;
}

describe("native compaction", () => {
	test("compacts in place between a tool batch and the next request", async () => {
		const session = await plainSession("small");
		const sessionId = session.sessionId;
		const start = requests.length;
		try {
			// Faux usage reports each prompt as input and cache write, so native
			// usage-based totals are about twice the prompt (P). Old ~20k + tail
			// ~21k: after tools, 2*P(old) + tail ~ 64k exceeds the trigger. The
			// tail exceeds keepRecentTokens (20k), so the old prompt is summarized;
			// afterwards 2*P(summary + tail) ~ 46k stays below the trigger.
			await session.prompt(`SCENARIO:compact OLD-CONTEXT ${"o".repeat(80_000)}`);
			await session.waitForIdle();
			const run = requests.slice(start);
			expect(run.map((request) => request.kind)).toEqual(["main", "summary", "main"]);
			const next = run[2];
			expect(next.text).toContain("FAUX-SUMMARY");
			expect(next.text).toContain("RECENT-RESULT");
			expect(next.text).not.toContain("OLD-CONTEXT");
			expect(session.sessionId).toBe(sessionId);
			const entries = session.sessionManager.getBranch();
			expect(entries.some((entry) => entry.type === "compaction")).toBe(true);
		} finally {
			session.dispose();
		}
	}, 60_000);
});

describe("native failure-loop redirect", () => {
	test("adds one note after the third identical failure, without extra runs", async () => {
		const session = await plainSession("parent");
		const start = requests.length;
		try {
			await session.prompt("SCENARIO:loop");
			const mains = requests.slice(start).filter((request) => request.kind === "main");
			expect(mains).toHaveLength(4);
			// Identify the persisted entry structurally, then follow its payload.
			const branch = session.sessionManager.getBranch();
			const noteEntries = branch.filter(
				(entry) => entry.type === "custom_message" && entry.customType === "failure-loop",
			);
			expect(noteEntries).toHaveLength(1);
			const note = noteEntries[0] as { content: unknown; display: unknown };
			expect(note.display).toBe(true);
			expect(typeof note.content).toBe("string");
			expect(JSON.stringify(note)).not.toContain(SECRET);
			const entryIndex = branch.indexOf(noteEntries[0]);
			const resultEntries = branch.flatMap((entry, index) =>
				entry.type === "message" && entry.message.role === "toolResult" ? [index] : [],
			);
			expect(resultEntries).toHaveLength(3);
			expect(entryIndex).toBeGreaterThan(Math.max(...resultEntries));
			const carries = (request: Request) =>
				request.messages.filter((message) => message.text.includes(String(note.content)));
			expect(mains.map((request) => carries(request).length)).toEqual([0, 0, 0, 1]);
			const final = mains[3];
			const noteIndex = final.messages.indexOf(carries(final)[0]);
			const lastResult = final.messages.findLastIndex(
				(message) => message.role === "toolResult",
			);
			expect(noteIndex).toBeGreaterThan(lastResult);
			const results = session.messages.filter((message) => message.role === "toolResult");
			expect(results).toHaveLength(3);
			for (const result of results) {
				expect(result.isError).toBe(true);
				expect(JSON.stringify(result.content)).toContain(`FLAKY-ERROR ${SECRET}`);
			}
			await session.waitForIdle();
			expect(requests.length - start).toBe(4);
		} finally {
			session.dispose();
		}
	}, 60_000);
});

// --- Runtime with installed subagents, TUI boundary faked ---------------

interface Ui {
	notices: string[];
	editorText: string | undefined;
	prefills: string[];
	editorReply: (prefill: string) => string | undefined | Promise<string | undefined>;
	cancelLoader: boolean;
	customCalls: number;
	failSetEditor: boolean;
	errors: string[];
}

function fakeUi(state: Ui) {
	const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
	const tui = { requestRender() {} };
	// Pi copies the bound UI's own methods ({ ...ui }), so every method an
	// extension uses must exist here. Installed pi-subagents uses these
	// four; the no-ops match Pi's own headless UI context.
	return {
		theme,
		setWidget() {},
		setStatus() {},
		addAutocompleteProvider() {},
		onTerminalInput: () => () => {},
		notify(message: string) {
			state.notices.push(message);
		},
		setEditorText(text: string) {
			if (state.failSetEditor) throw new Error(`editor broke ${SECRET}`);
			state.editorText = text;
		},
		getEditorText: () => state.editorText ?? "",
		async editor(_title: string, prefill = "") {
			state.prefills.push(prefill);
			return state.editorReply(prefill);
		},
		custom(factory: (...args: unknown[]) => unknown) {
			state.customCalls++;
			return new Promise((resolve) => {
				let settled = false;
				let component: { dispose?(): void; handleInput?(data: string): void };
				const done = (value: unknown) => {
					if (settled) return;
					settled = true;
					queueMicrotask(() => component?.dispose?.());
					resolve(value);
				};
				component = factory(tui, theme, {}, done) as typeof component;
				// Escape, through the real loader's own cancel binding.
				if (state.cancelLoader) component.handleInput?.("\x1b");
			});
		},
	};
}

describe("native handoff and subagents", () => {
	let runtime: Awaited<ReturnType<Sdk["createAgentSessionRuntime"]>>;
	let toolNames: string[] = [];
	const ui: Ui = {
		notices: [],
		editorText: undefined,
		prefills: [],
		editorReply: (prefill) => `${prefill}\nEDITED`,
		cancelLoader: false,
		customCalls: 0,
		failSetEditor: false,
		errors: [],
	};

	beforeAll(async () => {
		sideKind = "handoff";
		// The interactive TUI initializes its theme before extension UI runs.
		sdk.initTheme(undefined, false);
		const createRuntime = async (options: {
			cwd: string;
			agentDir: string;
			sessionManager: InstanceType<Sdk["SessionManager"]>;
			sessionStartEvent?: unknown;
		}) => {
			const services = await sdk.createAgentSessionServices({
				cwd: options.cwd,
				agentDir: options.agentDir,
				modelRuntime,
				settingsManager: sdk.SettingsManager.create(options.cwd, options.agentDir),
				resourceLoaderOptions: {
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					noContextFiles: true,
					additionalExtensionPaths: [SUBAGENTS],
					extensionFactories: [
						((pi: { getAllTools(): { name: string }[]; on: Function }) => {
							pi.on("session_start", () => {
								toolNames = pi.getAllTools().map((tool) => tool.name);
							});
						}) as never,
					],
				},
			});
			const result = await sdk.createAgentSessionFromServices({
				services,
				sessionManager: options.sessionManager,
				sessionStartEvent: options.sessionStartEvent as never,
				model: modelRuntime.getModel("fixture", "parent"),
			});
			return { ...result, services, diagnostics: services.diagnostics };
		};
		runtime = await sdk.createAgentSessionRuntime(createRuntime as never, {
			cwd: project,
			agentDir,
			sessionManager: sdk.SessionManager.create(project, sessionsDir),
		});
		const bind = (session: typeof runtime.session) =>
			session.bindExtensions({
				mode: "tui",
				uiContext: fakeUi(ui) as never,
				commandContextActions: {
					waitForIdle: () => runtime.session.waitForIdle(),
					newSession: (options) => runtime.newSession(options),
					fork: (entryId, options) => runtime.fork(entryId, options),
					navigateTree: () => Promise.resolve({ cancelled: true }),
					switchSession: (path, options) => runtime.switchSession(path, options),
					reload: async () => {},
				},
				// The host's extension error route, as interactive mode binds it.
				onError: (error) => {
					ui.errors.push(`${error.extensionPath}: ${error.error}`);
				},
			});
		runtime.setRebindSession(bind);
		await bind(runtime.session);
		await runtime.session.prompt("seed question about SEED-TOPIC");
	}, 60_000);

	afterAll(async () => {
		await runtime?.dispose();
		expect(ui.errors).toEqual([]);
	});

	const reset = () => {
		// Normal native flows must not report any extension error.
		expect(ui.errors).toEqual([]);
		ui.notices = [];
		ui.prefills = [];
		ui.cancelLoader = false;
		ui.customCalls = 0;
		ui.failSetEditor = false;
		ui.editorReply = (prefill) => `${prefill}\nEDITED`;
		handoffReply = () => "DRAFT: continue the focused task";
	};

	async function withRegistry(override: unknown, run: () => Promise<void>) {
		const store = globalThis as Record<PropertyKey, unknown>;
		const original = store[REGISTRY];
		store[REGISTRY] = override;
		try {
			await run();
		} finally {
			store[REGISTRY] = original;
		}
	}

	async function expectUnchanged(run: () => Promise<void>) {
		const id = runtime.session.sessionId;
		const before = runtime.session.messages.length;
		await run();
		expect(runtime.session.sessionId).toBe(id);
		expect(runtime.session.messages).toHaveLength(before);
		expect(ui.notices.join("\n")).not.toContain(SECRET);
	}

	const handoffRequests = () => requests.filter((request) => request.kind === "handoff");
	const busy = { hasRunning: () => true, getRecord: () => undefined };

	test("global subagents config keeps Agent and removes workflows", () => {
		expect(toolNames).toContain("Agent");
		expect(toolNames).not.toContain("SubagentWorkflow");
		const registry = (globalThis as Record<PropertyKey, unknown>)[REGISTRY] as Record<
			string,
			unknown
		>;
		expect(typeof registry?.hasRunning).toBe("function");
		expect(typeof registry?.getRecord).toBe("function");
	});

	test("refuses busy subagents before any generation", async () => {
		reset();
		const start = handoffRequests().length;
		await expectUnchanged(() =>
			withRegistry(busy, () => runtime.session.prompt("/handoff next goal")),
		);
		expect(handoffRequests().length).toBe(start);
		expect(ui.notices.join("\n")).toContain("subagents");
		await expectUnchanged(() =>
			withRegistry(undefined, () => runtime.session.prompt("/handoff next goal")),
		);
		expect(ui.notices.join("\n")).toContain("Cannot verify");
		expect(handoffRequests().length).toBe(start);
	});

	test("stops on loader cancel and unusable generations", async () => {
		const failures: HandoffReply[] = [
			() => ai.fauxAssistantMessage("partial", { stopReason: "length" }),
			() => ai.fauxAssistantMessage("x", { stopReason: "error", errorMessage: SECRET }),
			() =>
				ai.fauxAssistantMessage(ai.fauxToolCall("bash", { command: SECRET }), {
					stopReason: "toolUse",
				}),
			() => "   ",
			() => new Error(SECRET),
		];
		for (const failure of failures) {
			reset();
			handoffReply = failure;
			const start = handoffRequests().length;
			await expectUnchanged(() => runtime.session.prompt("/handoff next goal"));
			expect(handoffRequests().length).toBe(start + 1);
			expect(ui.prefills).toEqual([]);
			expect(ui.notices).toEqual([
				"Handoff draft generation failed; current session unchanged.",
			]);
		}
		reset();
		ui.cancelLoader = true;
		await expectUnchanged(() => runtime.session.prompt("/handoff next goal"));
		expect(ui.prefills).toEqual([]);
		expect(ui.notices).toEqual(["Handoff cancelled; current session unchanged."]);
	});

	test("rechecks the guard after generation and after editing", async () => {
		reset();
		handoffReply = () => {
			(globalThis as Record<PropertyKey, unknown>)[REGISTRY] = busy;
			return "DRAFT";
		};
		const store = globalThis as Record<PropertyKey, unknown>;
		const original = store[REGISTRY];
		try {
			await expectUnchanged(() => runtime.session.prompt("/handoff next goal"));
		} finally {
			store[REGISTRY] = original;
		}
		expect(ui.prefills).toEqual([]);
		expect(ui.notices.join("\n")).toContain("subagents");

		reset();
		ui.editorReply = (prefill) => {
			store[REGISTRY] = busy;
			return prefill;
		};
		try {
			await expectUnchanged(() => runtime.session.prompt("/handoff next goal"));
		} finally {
			store[REGISTRY] = original;
		}
		expect(ui.prefills).toHaveLength(1);
		expect(ui.notices.join("\n")).toContain("subagents");
	});

	test("stops on editor cancel or blank draft and blocks reentry", async () => {
		for (const reply of [undefined, "  \n "]) {
			reset();
			ui.editorReply = () => reply;
			await expectUnchanged(() => runtime.session.prompt("/handoff next goal"));
			expect(ui.prefills).toHaveLength(1);
			expect(ui.notices).toEqual(["Handoff cancelled; current session unchanged."]);
		}
		reset();
		let switchResult: unknown;
		ui.editorReply = async () => {
			await runtime.session.prompt("/handoff second");
			// Backstop: an in-flight handoff vetoes an unsafe switch.
			await withRegistry(busy, async () => {
				switchResult = await runtime.newSession();
			});
			return undefined;
		};
		await expectUnchanged(() => runtime.session.prompt("/handoff next goal"));
		expect(ui.prefills).toHaveLength(1);
		expect(ui.notices.join("\n")).toContain("already in progress");
		expect(switchResult).toEqual({ cancelled: true });
	});

	test("opens a linked session with the edited, unsent draft", async () => {
		reset();
		const parent = runtime.session.sessionFile;
		const parentId = runtime.session.sessionId;
		const mainBefore = requests.filter((request) => request.kind === "main").length;
		const start = handoffRequests().length;
		await runtime.session.prompt("/handoff implement the next step");
		const sent = handoffRequests().slice(start);
		expect(sent).toHaveLength(1);
		expect(sent[0].messages.every((message) => message.toolsAdded === 0)).toBe(true);
		expect(sent[0].text).toContain("SEED-TOPIC");
		expect(sent[0].text).toContain("implement the next step");
		expect(ui.prefills).toHaveLength(1);
		expect(ui.prefills[0]).toContain("DRAFT: continue the focused task");
		expect(ui.prefills[0].toLowerCase()).toContain("not new authorization");
		expect(runtime.session.sessionId).not.toBe(parentId);
		expect(runtime.session.sessionManager.getHeader()?.parentSession).toBe(parent);
		expect(ui.editorText).toBe(`${ui.prefills[0]}\nEDITED`);
		expect(runtime.session.messages).toHaveLength(0);
		await Bun.sleep(50);
		expect(requests.filter((request) => request.kind === "main").length).toBe(
			mainBefore,
		);
	});

	test("reports post-switch failures without claiming the session is unchanged", async () => {
		reset();
		await runtime.session.prompt("seed again about SEED-TOPIC");
		const parentId = runtime.session.sessionId;
		ui.failSetEditor = true;
		await runtime.session.prompt("/handoff next goal");
		// Native replacement has no rollback once teardown starts.
		expect(runtime.session.sessionId).not.toBe(parentId);
		const reported = [...ui.notices, ...ui.errors].join("\n");
		expect(reported).not.toContain("unchanged");
		expect(reported).not.toContain(SECRET);
		expect(ui.errors).toHaveLength(1);
		expect(ui.errors[0]).toStartWith("command:handoff: ");
		ui.errors = [];
		ui.failSetEditor = false;
	});
});
