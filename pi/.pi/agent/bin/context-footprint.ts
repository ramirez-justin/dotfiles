#!/usr/bin/env bun
// Offline, content-free inventory of selected repository prompt payloads.
// Counts mixed source/rendered text; it is not a live prompt or token count.
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	readValidatedMemory,
	SCOPED_PROJECT_SPEC,
	USER_MEMORY_SPEC,
	WORKFLOW_MEMORY_SPEC,
} from "../extensions/memory-governor/memory-store.ts";
import { normalizeRemoteIdentity } from "../extensions/memory-governor/project-identity.ts";
import { buildPromptMemory } from "../extensions/memory-governor/prompt-memory.ts";

type Sdk = typeof import("@earendil-works/pi-coding-agent");

export interface Counts {
	utf8Bytes: number;
	unicodeCodePoints: number;
}

interface Issue {
	code: string;
	path?: string;
	count?: number;
}

interface Body extends Counts {
	kind: "skill-body" | "prompt-template-body";
	path: string;
}

export interface Report {
	scope: "repository-payload-inventory";
	context: "github.com/ramirez-justin/dotfiles";
	status: "ok" | "warning" | "error";
	components: Record<string, Counts>;
	lazyBodies: Body[];
	resources: {
		skills: number;
		catalogedSkills: number;
		disabledSkills: number;
		promptTemplates: number;
	} | null;
	memoryWarningCount: number | null;
	selectedRepositoryPayloadTotal: Counts | null;
	lazyBodyInventoryTotal: Counts | null;
	issues: Issue[];
	exclusions: string[];
}

const AGENT = "pi/.pi/agent";
const SKILLS = `${AGENT}/skills`;
const PROMPTS = `${AGENT}/prompts`;
const MEMORY = `${AGENT}/memory`;
const EXCLUSIONS = [
	"base-provider-prompts-and-tool-schemas",
	"runtime-wrappers-and-extension-instructions",
	"installed-external-package-resources",
	"ancestor-project-claude-and-agent-instructions",
	"additional-system-prompt-files",
	"conversation-history-and-transient-advisories",
	"memory-index-and-other-project-memory",
	"lazy-invocation-wrappers-arguments-and-supporting-files",
];

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

class Failure extends Error {
	constructor(readonly issue: Issue) {
		super(issue.code);
	}
}

function fail(code: string, path?: string, count?: number): never {
	const issue: Issue = { code };
	if (path !== undefined) issue.path = path;
	if (count !== undefined) issue.count = count;
	throw new Failure(issue);
}

function emptyReport(): Report {
	return {
		scope: "repository-payload-inventory",
		context: "github.com/ramirez-justin/dotfiles",
		status: "ok",
		components: {},
		lazyBodies: [],
		resources: null,
		memoryWarningCount: null,
		selectedRepositoryPayloadTotal: null,
		lazyBodyInventoryTotal: null,
		issues: [],
		exclusions: [...EXCLUSIONS],
	};
}

// Only fixed codes and relative paths are serialized, never raw errors.
function errorReport(error: unknown): Report {
	const report = emptyReport();
	report.status = "error";
	report.issues = [
		error instanceof Failure ? error.issue : { code: "UNEXPECTED_FAILURE" },
	];
	return report;
}

export function measure(text: string): Counts {
	return {
		utf8Bytes: Buffer.byteLength(text, "utf8"),
		unicodeCodePoints: [...text].length,
	};
}

function sum(items: Counts[]): Counts {
	return items.reduce(
		(total, item) => ({
			utf8Bytes: total.utf8Bytes + item.utf8Bytes,
			unicodeCodePoints: total.unicodeCodePoints + item.unicodeCodePoints,
		}),
		{ utf8Bytes: 0, unicodeCodePoints: 0 },
	);
}

// Root is canonical; relative paths come only from fixed roots or dirent
// names. Canonical equality rejects leaf links and linked ancestors. This is
// not an OS sandbox or an atomic snapshot against concurrent replacement.
async function covered(root: string, path: string, directory = false) {
	const target = join(root, path);
	try {
		if ((await realpath(target)) !== target) fail("PATH_BOUNDARY", path);
		const metadata = await lstat(target);
		if (directory ? !metadata.isDirectory() : !metadata.isFile()) {
			fail("INVALID_RESOURCE", path);
		}
		return target;
	} catch (error) {
		if (error instanceof Failure) throw error;
		fail("READ_FAILURE", path);
	}
}

async function text(root: string, path: string): Promise<string> {
	const absolute = await covered(root, path);
	let bytes: Buffer;
	try {
		bytes = await readFile(absolute);
	} catch {
		fail("READ_FAILURE", path);
	}
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			bytes,
		);
	} catch {
		fail("INVALID_UTF8", path);
	}
}

async function entries(root: string, path: string) {
	const absolute = await covered(root, path, true);
	try {
		return (await readdir(absolute, { withFileTypes: true })).sort((a, b) =>
			compare(a.name, b.name),
		);
	} catch {
		fail("READ_FAILURE", path);
	}
}

// Resolved only when collecting, so help and argument errors need no Pi.
async function installedSdk(): Promise<Sdk> {
	try {
		const binary = Bun.which("pi");
		if (!binary) fail("SDK_UNAVAILABLE");
		const entry = Bun.resolveSync(
			"@earendil-works/pi-coding-agent",
			dirname(await realpath(binary)),
		);
		return await import(entry);
	} catch {
		fail("SDK_UNAVAILABLE");
	}
}

// Native YAML parsing reports some problems via process.emitWarning, which
// would print source text to stderr. Intercept only around a synchronous
// native call, restore before returning, and treat any warning as an error.
function native<T>(path: string, action: () => T): T {
	const original = process.emitWarning;
	let warnings = 0;
	process.emitWarning = (() => {
		warnings++;
	}) as typeof process.emitWarning;
	let result: T;
	try {
		result = action();
	} catch {
		fail("INVALID_RESOURCE", path);
	} finally {
		process.emitWarning = original;
	}
	if (warnings) fail("INVALID_RESOURCE", path);
	return result;
}

function body(sdk: Sdk, raw: string, path: string, skill: boolean): string {
	return native(path, () =>
		skill ? sdk.stripFrontmatter(raw).trim() : sdk.parseFrontmatter(raw).body,
	);
}

export async function collectFootprint(repoRoot: string): Promise<Report> {
	try {
		let root: string;
		try {
			root = await realpath(repoRoot);
		} catch {
			fail("READ_FAILURE");
		}
		const sdk = await installedSdk();
		const report = emptyReport();
		const instruction = await text(root, `${AGENT}/AGENTS.md`);

		// Direct nonhidden skill directories each require a regular SKILL.md.
		const files: { path: string; absolute: string; raw: string }[] = [];
		for (const entry of await entries(root, SKILLS)) {
			if (entry.name.startsWith(".")) continue;
			const path = `${SKILLS}/${entry.name}`;
			if (entry.isSymbolicLink()) fail("PATH_BOUNDARY", path);
			if (entry.isDirectory()) {
				const file = `${path}/SKILL.md`;
				files.push({
					path: file,
					absolute: join(root, file),
					raw: await text(root, file),
				});
			} else if (entry.name.endsWith(".md")) {
				fail("INVALID_RESOURCE", path);
			}
		}
		const loaded = native(SKILLS, () =>
			sdk.loadSkills({
				cwd: root,
				agentDir: join(root, AGENT),
				skillPaths: files.map((file) => file.absolute),
				includeDefaults: false,
			}),
		);
		if (loaded.diagnostics.length) {
			fail("CATALOG_DIAGNOSTIC", SKILLS, loaded.diagnostics.length);
		}
		if (loaded.skills.length !== files.length) {
			fail("CATALOG_MISMATCH", SKILLS);
		}
		const catalog = sdk.formatSkillsForPrompt(loaded.skills, "read");
		const cataloged = loaded.skills.filter(
			(skill) => !skill.disableModelInvocation,
		).length;
		for (const file of files) {
			report.lazyBodies.push({
				kind: "skill-body",
				path: file.path,
				...measure(body(sdk, file.raw, file.path, true)),
			});
		}

		let promptTemplates = 0;
		for (const entry of await entries(root, PROMPTS)) {
			if (!entry.name.endsWith(".md")) continue;
			const path = `${PROMPTS}/${entry.name}`;
			report.lazyBodies.push({
				kind: "prompt-template-body",
				path,
				...measure(body(sdk, await text(root, path), path, false)),
			});
			promptTemplates++;
		}

		const identity = normalizeRemoteIdentity(
			"https://github.com/ramirez-justin/dotfiles.git",
		);
		if (!identity) fail("UNEXPECTED_FAILURE");
		const sources = [
			{ path: `${MEMORY}/USER.md`, spec: USER_MEMORY_SPEC },
			{ path: `${MEMORY}/WORKFLOWS.md`, spec: WORKFLOW_MEMORY_SPEC },
			{
				path: `${MEMORY}/projects/${identity.filename}`,
				spec: SCOPED_PROJECT_SPEC,
			},
		];
		// Validate first so blocked sources are errors, not render warnings.
		// The reader rejects invalid UTF-8; the delimiter check mirrors the
		// renderer's private rejection rule for classification only.
		for (const source of sources) {
			await covered(root, source.path);
			const validated = await readValidatedMemory({
				root: join(root, MEMORY),
				path: join(root, source.path),
				spec: source.spec,
			});
			if (
				validated.text === undefined ||
				/<\/?durable_memory>/i.test(validated.text)
			) {
				fail("INVALID_MEMORY", source.path);
			}
		}
		const memory = await buildPromptMemory({
			memoryRoot: join(root, MEMORY),
			identity,
		});

		report.components = {
			"agent-instructions-source": measure(instruction),
			"native-skill-catalog": measure(catalog),
			"durable-memory-rendering": measure(memory.text),
		};
		report.resources = {
			skills: loaded.skills.length,
			catalogedSkills: cataloged,
			disabledSkills: loaded.skills.length - cataloged,
			promptTemplates,
		};
		report.memoryWarningCount = memory.warnings.length;
		if (memory.warnings.length) {
			report.status = "warning";
			report.issues.push({
				code: "MEMORY_RENDER_WARNING",
				count: memory.warnings.length,
			});
		}
		report.selectedRepositoryPayloadTotal = sum(
			Object.values(report.components),
		);
		report.lazyBodyInventoryTotal = sum(report.lazyBodies);
		return report;
	} catch (error) {
		return errorReport(error);
	}
}

export async function run(repoRoot?: string): Promise<0 | 1> {
	let report: Report;
	try {
		const root =
			repoRoot ??
			resolve(dirname(await realpath(import.meta.path)), "../../../..");
		report = await collectFootprint(root);
	} catch {
		report = errorReport(new Failure({ code: "READ_FAILURE" }));
	}
	console.log(JSON.stringify(report, null, 2));
	return report.status === "error" ? 1 : 0;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	if (args.length === 1 && args[0] === "--help") {
		console.log(
			"Usage: bun pi/.pi/agent/bin/context-footprint.ts\n" +
				"Offline inventory for the script-owning dotfiles repository.\n" +
				"Units: UTF-8 bytes and Unicode code points, not tokens.\n" +
				"Selected total: AGENTS source + native catalog + rendered memory.\n" +
				"Lazy bodies are separate; exclusions appear in JSON.\n" +
				"This is not a complete live system-prompt measurement.",
		);
	} else if (args.length) {
		console.log(
			JSON.stringify(
				errorReport(new Failure({ code: "INVALID_ARGUMENT" })),
				null,
				2,
			),
		);
		process.exitCode = 1;
	} else {
		process.exitCode = await run();
	}
}
