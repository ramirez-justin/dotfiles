import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Offline contract tests for the tier aliases. They use the installed Pi SDK
// and pi-subagents runner with a local fixture provider: no credentials,
// network access, or real provider requests.

const AGENT_ROOT = join(import.meta.dir, "..");
const EXTENSION = join(AGENT_ROOT, "extensions/model-tiers.ts");
const MAPPING = join(AGENT_ROOT, "extensions/model-tiers.json");
const SUBAGENTS = join(
	homedir(),
	".pi/agent/npm/node_modules/@tintinweb/pi-subagents",
);
const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const piBin = Bun.which("pi");
if (!piBin) throw new Error("pi is not on PATH; install it with mise");
const PI_ENTRY = realpathSync(
	Bun.resolveSync(
		"@earendil-works/pi-coding-agent",
		dirname(realpathSync(piBin)),
	),
);
const PI_AI_ENTRY = realpathSync(
	Bun.resolveSync("@earendil-works/pi-ai", PI_ENTRY),
);
const PI_TUI_ENTRY = realpathSync(
	Bun.resolveSync("@earendil-works/pi-tui", PI_ENTRY),
);
if (!existsSync(join(SUBAGENTS, "src/agent-runner.ts"))) {
	throw new Error(`pi-subagents is not installed at ${SUBAGENTS}`);
}

// Pi loads extension packages against its own copy of the SDK. Mirror that so
// pi-subagents shares one ModelRuntime implementation with these sessions.
const SDK_ENTRIES: Record<string, string> = {
	"@earendil-works/pi-coding-agent": PI_ENTRY,
	"@earendil-works/pi-ai": PI_AI_ENTRY,
	"@earendil-works/pi-tui": PI_TUI_ENTRY,
};
Bun.plugin({
	name: "installed-pi-sdk",
	setup(build) {
		build.onLoad({ filter: /\/pi-subagents\/src\/.*\.ts$/ }, async (args) => {
			let contents = await Bun.file(args.path).text();
			for (const [name, entry] of Object.entries(SDK_ENTRIES)) {
				contents = contents.replaceAll(`"${name}"`, JSON.stringify(entry));
			}
			return { contents, loader: "ts" };
		});
	},
});

const root = mkdtempSync(join(tmpdir(), "model-tiers-"));
const agentDir = join(root, "agent");
const project = join(root, "project");
const extensionDir = join(agentDir, "extensions");
const fixtureMapping = join(extensionDir, "model-tiers.json");
const fixtureExtension = join(extensionDir, "model-tiers.ts");
const ENV_KEYS = [
	"PI_CODING_AGENT_DIR",
	"PI_CODING_AGENT_SESSION_DIR",
	"PI_OFFLINE",
] as const;
const originalEnv = Object.fromEntries(
	ENV_KEYS.map((key) => [key, process.env[key]]),
);
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
process.env.PI_OFFLINE = "1";

type Sdk = typeof import("@earendil-works/pi-coding-agent");
type Ai = typeof import("@earendil-works/pi-ai");
let sdk: Sdk;
let ai: Ai;
const requests: { model: string; reasoning?: string }[] = [];

function writeMapping(mapping: unknown) {
	writeFileSync(fixtureMapping, JSON.stringify(mapping));
}

async function createParent() {
	const { createFauxCore, fauxAssistantMessage } = ai;
	const ids = ["parent", "model-1", "model-2", "model-3", "model-4"];
	const faux = createFauxCore({ api: "fixture-api", provider: "fixture" });
	faux.setResponses(
		Array.from({ length: 50 }, () => (_context, options, _state, model) => {
			requests.push({ model: model.id, reasoning: options?.reasoning });
			return fauxAssistantMessage("fixture response");
		}),
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
		models: ids.map((id) => ({
			id,
			name: id,
			reasoning: true,
			thinkingLevelMap: { xhigh: "xhigh", max: "max" },
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100_000,
			maxTokens: 1_000,
		})),
	});
	let captured: { pi: unknown; ctx: unknown } | undefined;
	const resourceLoader = new sdk.DefaultResourceLoader({
		cwd: project,
		agentDir,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		extensionFactories: [
			(pi) => {
				pi.on("session_start", (_event, ctx) => {
					captured = { pi, ctx };
				});
			},
		],
	});
	await resourceLoader.reload();
	const { session } = await sdk.createAgentSession({
		cwd: project,
		agentDir,
		modelRuntime,
		resourceLoader,
		model: modelRuntime.getModel("fixture", "parent"),
		thinkingLevel: "medium",
		sessionManager: sdk.SessionManager.inMemory(project),
		settingsManager: sdk.SettingsManager.inMemory(),
	});
	await session.bindExtensions({});
	if (!captured) throw new Error("parent extension context was not bound");
	return { session, modelRuntime, ...captured };
}

async function route(
	runtime: InstanceType<Sdk["ModelRuntime"]>,
	tier: string,
	thinkingLevel = "high",
) {
	const model = runtime.getModel("tiers", tier);
	if (!model) throw new Error(`tiers/${tier} is not registered`);
	const routed = await runtime.resolveModel(model, [], {
		reason: "user",
		thinkingLevel: thinkingLevel as never,
	});
	return `${routed.model.provider}/${routed.model.id}:${routed.thinkingLevel}`;
}

beforeAll(async () => {
	mkdirSync(extensionDir, { recursive: true });
	mkdirSync(project, { recursive: true });
	copyFileSync(EXTENSION, fixtureExtension);
	cpSync(join(AGENT_ROOT, "agents"), join(agentDir, "agents"), {
		recursive: true,
	});
	// A discovered extension that isolated agents must not load.
	writeFileSync(
		join(extensionDir, "probe.ts"),
		`export default function (pi) {
	pi.registerTool({
		name: "probe_tool",
		label: "Probe",
		description: "Extension probe",
		parameters: { type: "object", properties: {} },
		async execute() {
			return { content: [{ type: "text", text: "probe" }], details: undefined };
		},
	});
}
`,
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

describe("model tier aliases", () => {
	test("ships a mapping for every tier", async () => {
		const mapping = await Bun.file(MAPPING).json();
		expect(Object.keys(mapping).sort()).toEqual([
			"tier-1",
			"tier-2",
			"tier-3",
			"tier-4",
		]);
	});

	test("route to the mapped model with every thinking level unchanged", async () => {
		writeMapping({ "tier-1": "fixture/model-1", "tier-2": "fixture/model-2" });
		const { session, modelRuntime } = await createParent();
		try {
			const tier = modelRuntime.getModel("tiers", "tier-1");
			expect(tier?.name).toBe("Tier 1");
			for (const level of THINKING) {
				expect(await route(modelRuntime, "tier-1", level)).toBe(
					`fixture/model-1:${level}`,
				);
			}
			expect(await route(modelRuntime, "tier-2", "xhigh")).toBe(
				"fixture/model-2:xhigh",
			);
		} finally {
			session.dispose();
		}
	});

	test("apply a mapping-only upgrade on reload", async () => {
		writeMapping({ "tier-1": "fixture/model-1" });
		const { session, modelRuntime } = await createParent();
		try {
			expect(await route(modelRuntime, "tier-1")).toBe("fixture/model-1:high");
			writeMapping({ "tier-1": "fixture/model-3" });
			await session.reload();
			expect(await route(modelRuntime, "tier-1")).toBe("fixture/model-3:high");
		} finally {
			session.dispose();
		}
	});

	test("reject missing and virtual targets instead of falling back", async () => {
		writeMapping({
			"tier-1": "fixture/missing",
			"tier-2": "tiers/tier-3",
			"tier-3": "fixture/model-3",
		});
		const { session, modelRuntime } = await createParent();
		try {
			await expect(route(modelRuntime, "tier-1")).rejects.toThrow(
				"fixture/missing",
			);
			await expect(route(modelRuntime, "tier-2")).rejects.toThrow(
				"not a physical model",
			);
		} finally {
			session.dispose();
		}
	});

	test("report an invalid mapping instead of registering aliases", async () => {
		for (const mapping of [
			[],
			{},
			{ "tier-1": 7 },
			{ "tier-1": "no-provider" },
			{ "tier-1": "fixture/" },
			{ tier: "fixture/model-1" },
		]) {
			writeMapping(mapping);
			const { session, modelRuntime } = await createParent();
			try {
				const { errors } = session.resourceLoader.getExtensions();
				expect(errors.map((error) => error.error).join("\n")).toContain(
					"model-tiers.json",
				);
				expect(modelRuntime.getModels("tiers")).toEqual([]);
			} finally {
				session.dispose();
			}
		}
	});

	test("dispatch every agent through its tier, isolating extensions", async () => {
		writeMapping({
			"tier-1": "fixture/model-1",
			"tier-2": "fixture/model-2",
			"tier-3": "fixture/model-3",
			"tier-4": "fixture/model-4",
		});
		const runner = await import(join(SUBAGENTS, "src/agent-runner.ts"));
		const types = await import(join(SUBAGENTS, "src/agent-types.ts"));
		const custom = await import(join(SUBAGENTS, "src/custom-agents.ts"));
		const invocation = await import(join(SUBAGENTS, "src/invocation-config.ts"));
		const resolver = await import(join(SUBAGENTS, "src/model-resolver.ts"));
		const agents = custom.loadCustomAgents(project, true);
		types.registerAgents(agents);
		const { session, modelRuntime, pi, ctx } = await createParent();
		const children = [];
		const isolated: string[] = [];
		try {
			expect(session.getAllTools().map((tool) => tool.name)).toContain(
				"probe_tool",
			);
			expect(agents.size).toBe(10);
			for (const [name, config] of agents) {
				const resolved = invocation.resolveAgentInvocationConfig(config, {});
				const model = resolver.resolveModel(
					resolved.modelInput,
					(ctx as { modelRegistry: unknown }).modelRegistry,
				);
				expect(typeof model).not.toBe("string");
				expect(`${model.provider}/${model.id}`).toBe(config.model);
				requests.length = 0;
				const result = await runner.runAgent(ctx, name, "Reply briefly.", {
					pi,
					model,
					thinkingLevel: resolved.thinking,
					isolated: resolved.isolated,
				});
				children.push(result.session);
				const tier = config.model.replace("tiers/", "");
				expect(requests).toEqual([
					{
						model: `model-${tier.replace("tier-", "")}`,
						reasoning: config.thinking,
					},
				]);
				expect(result.session.model?.provider).toBe("tiers");
				if (resolved.isolated) {
					const loaded = result.session.resourceLoader.getExtensions();
					expect(loaded.extensions).toEqual([]);
					expect(result.session.getActiveToolNames().sort()).toEqual(
						[...config.builtinToolNames].sort(),
					);
					isolated.push(name);
				} else {
					const loaded = result.session.resourceLoader.getExtensions();
					expect(loaded.extensions.map((ext) => ext.path)).toContain(
						fixtureExtension,
					);
				}
			}
			expect(isolated.sort()).toEqual(["AdvancedPlan", "simplifier"]);
			for (const child of children.splice(0)) child.dispose();
			expect(await route(modelRuntime, "tier-1", "max")).toBe(
				"fixture/model-1:max",
			);
		} finally {
			for (const child of children) child.dispose();
			session.dispose();
		}
	}, 60_000);
});
