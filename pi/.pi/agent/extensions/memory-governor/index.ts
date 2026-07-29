// @ts-nocheck -- Pi runtime types are installed outside this repository.
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	applyMemoryAddition,
	auditMemoryText,
	detectMemoryCandidate,
	type MemoryCandidate,
} from "./candidate.ts";
import { createMemoryReadTool } from "./memory-read-tool.ts";
import {
	mutateMemoryFile,
	PROJECT_INDEX_SPEC,
	SCOPED_PROJECT_SPEC,
	USER_MEMORY_SPEC,
	WORKFLOW_MEMORY_SPEC,
	type MemoryFileSpec,
	type MutationResult,
} from "./memory-store.ts";
import {
	createGitQuery,
	resolveRepositoryIdentity,
	type RepositoryIdentity,
} from "./project-identity.ts";
import {
	ensureScopedProjectMemory,
	listAuditTargets,
} from "./project-memory.ts";
import {
	appendDurableMemory,
	buildPromptMemory,
} from "./prompt-memory.ts";

interface MutationInput {
	path: string;
	spec: MemoryFileSpec;
	mutate: Parameters<typeof mutateMemoryFile>[0]["mutate"];
}

interface PromptInput {
	memoryRoot: string;
	identity: RepositoryIdentity;
	advisoryCandidate?: MemoryCandidate;
}

export interface MemoryGovernorDependencies {
	memoryRoot: string;
	detectCandidate(text: string): MemoryCandidate | undefined;
	resolveIdentity(cwd: string): Promise<RepositoryIdentity>;
	buildPrompt(input: PromptInput): Promise<{
		text: string;
		warnings: string[];
	}>;
	ensureScopedProject(input: {
		root: string;
		identity: RepositoryIdentity;
	}): Promise<{ path: string; created: boolean }>;
	mutateFile(input: MutationInput): Promise<MutationResult>;
	auditTargets(root: string): Promise<string[]>;
	createReadTool: typeof createMemoryReadTool;
}

interface WriteTarget {
	path: string;
	spec: MemoryFileSpec;
	section: string;
	label: string;
}

function defaultMemoryRoot(): string {
	return join(homedir(), ".pi/agent/memory");
}

function relativeLabel(root: string, path: string): string {
	return relative(root, path).split("\\").join("/") || basename(path);
}

function specForPath(path: string): MemoryFileSpec {
	switch (basename(path)) {
		case "USER.md":
			return USER_MEMORY_SPEC;
		case "WORKFLOWS.md":
			return WORKFLOW_MEMORY_SPEC;
		case "PROJECTS.md":
			return PROJECT_INDEX_SPEC;
		default:
			return SCOPED_PROJECT_SPEC;
	}
}

function mutationNotice(
	result: MutationResult,
	label: string,
): { text: string; level: "info" | "warning" | "error" } {
	switch (result.status) {
		case "written":
			return { text: `Memory updated: ${label}`, level: "info" };
		case "unchanged":
			return {
				text: result.summary.startsWith("skipped memory:")
					? `Memory rejected: ${result.summary.slice("skipped memory: ".length)}`
					: `Memory unchanged: ${result.summary}`,
				level: "warning",
			};
		case "rejected":
			return {
				text: `Memory rejected: ${label} (${result.reason})`,
				level: "warning",
			};
		case "conflict":
			return {
				text: `Memory conflict: ${label} changed before commit`,
				level: "warning",
			};
		case "lock-timeout":
			return {
				text: `Memory update timed out waiting for ${label}`,
				level: "warning",
			};
		case "lock-uncertain":
			return {
				text: `Memory update stopped because the lock for ${label} is uncertain`,
				level: "warning",
			};
		default:
			throw new Error("Unknown memory mutation result");
	}
}

function auditSummary(result: MutationResult, label: string): string {
	switch (result.status) {
		case "written":
		case "unchanged":
			return `${label}: ${result.summary}`;
		case "rejected":
			return `${label}: rejected (${result.reason})`;
		case "conflict":
			return `${label}: conflict`;
		case "lock-timeout":
			return `${label}: lock timeout`;
		case "lock-uncertain":
			return `${label}: lock uncertain`;
		default:
			throw new Error("Unknown memory mutation result");
	}
}

export function createMemoryGovernor(
	pi: ExtensionAPI,
	overrides: Partial<MemoryGovernorDependencies> = {},
): void {
	const memoryRoot = overrides.memoryRoot ?? defaultMemoryRoot();
	const resolveIdentity =
		overrides.resolveIdentity ??
		((cwd: string) =>
			resolveRepositoryIdentity({
				cwd,
				memoryProjectsDir: join(memoryRoot, "projects"),
				git: createGitQuery(pi),
				realpath,
			}));
	const deps: MemoryGovernorDependencies = {
		memoryRoot,
		detectCandidate: detectMemoryCandidate,
		resolveIdentity,
		buildPrompt: buildPromptMemory,
		ensureScopedProject: ensureScopedProjectMemory,
		mutateFile: mutateMemoryFile,
		auditTargets: listAuditTargets,
		createReadTool: createMemoryReadTool,
		...overrides,
		memoryRoot,
		resolveIdentity,
	};
	let pendingAdvisory: MemoryCandidate | undefined;

	async function targetFor(
		candidate: MemoryCandidate,
		cwd: string,
	): Promise<WriteTarget> {
		if (candidate.scope === "user") {
			return {
				path: join(deps.memoryRoot, "USER.md"),
				spec: USER_MEMORY_SPEC,
				section: "Preferences",
				label: "USER.md",
			};
		}
		if (candidate.scope === "workflow") {
			return {
				path: join(deps.memoryRoot, "WORKFLOWS.md"),
				spec: WORKFLOW_MEMORY_SPEC,
				section: "Conventions",
				label: "WORKFLOWS.md",
			};
		}
		if (candidate.scope === "unscoped") {
			return {
				path: join(deps.memoryRoot, "PROJECTS.md"),
				spec: PROJECT_INDEX_SPEC,
				section: "Unscoped Facts",
				label: "PROJECTS.md",
			};
		}

		const identity = await deps.resolveIdentity(cwd);
		const scoped = await deps.ensureScopedProject({
			root: deps.memoryRoot,
			identity,
		});
		return {
			path: scoped.path,
			spec: SCOPED_PROJECT_SPEC,
			section: "Facts",
			label: relativeLabel(deps.memoryRoot, scoped.path),
		};
	}

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };
		const candidate = deps.detectCandidate(event.text);
		if (!candidate) return { action: "continue" };

		if (!candidate.autoWrite) {
			pendingAdvisory = candidate;
			return { action: "continue" };
		}

		const target = await targetFor(candidate, ctx.cwd);
		const result = await deps.mutateFile({
			path: target.path,
			spec: target.spec,
			mutate: (existingText) =>
				applyMemoryAddition({
					content: candidate.content,
					existingText,
					section: target.section,
					maxChars: target.spec.normalMaxChars,
				}),
		});
		if (ctx.hasUI) {
			const notice = mutationNotice(result, target.label);
			ctx.ui.notify(notice.text, notice.level);
		}
		return { action: "continue" };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const advisoryCandidate = pendingAdvisory;
		pendingAdvisory = undefined;
		const identity = await deps.resolveIdentity(ctx.cwd);
		const memory = await deps.buildPrompt({
			memoryRoot: deps.memoryRoot,
			identity,
			advisoryCandidate,
		});
		return {
			systemPrompt: appendDurableMemory(event.systemPrompt, memory.text),
		};
	});

	pi.registerTool(
		deps.createReadTool({
			memoryRoot: deps.memoryRoot,
			resolveCurrentIdentity: (cwd?: string) =>
				cwd ? deps.resolveIdentity(cwd) : Promise.resolve(undefined),
		}),
	);

	pi.registerCommand("memory-audit", {
		description: "Audit Pi memory files and remove exact duplicate bullets",
		handler: async (_args, ctx) => {
			const summaries: string[] = [];
			const targets = await deps.auditTargets(deps.memoryRoot);
			for (const path of targets) {
				const label = relativeLabel(deps.memoryRoot, path);
				const result = await deps.mutateFile({
					path,
					spec: specForPath(path),
					mutate: (text) => {
						const audited = auditMemoryText(text);
						return {
							changed: audited.removedDuplicates > 0,
							text: audited.text,
							summary: `removed ${audited.removedDuplicates} duplicate(s)`,
						};
					},
				});
				summaries.push(auditSummary(result, label));
			}

			if (ctx.hasUI) ctx.ui.notify("Memory audit complete.", "info");
			pi.sendMessage({
				customType: "memory-governor-audit",
				display: true,
				content: summaries.join("\n"),
			});
		},
	});
}

export default function memoryGovernor(pi: ExtensionAPI): void {
	createMemoryGovernor(pi);
}
