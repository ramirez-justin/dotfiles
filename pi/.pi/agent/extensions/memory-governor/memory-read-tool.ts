import { basename, join, relative, sep } from "node:path";
import {
	PROJECT_INDEX_SPEC,
	readValidatedMemory,
	SCOPED_PROJECT_SPEC,
	USER_MEMORY_SPEC,
	WORKFLOW_MEMORY_SPEC,
	type MemoryFileSpec,
} from "./memory-store.ts";
import {
	isSafeRepositoryMemoryFilename,
	repositoryCoordinateToFilename,
	type RepositoryIdentity,
} from "./project-identity.ts";
import { resolveIndexedProjectMemory } from "./project-memory.ts";

export const MEMORY_READ_MAX_CHARS = 5_000;

const scopes = [
	"user",
	"workflow",
	"current_project",
	"project",
	"index",
] as const;

export type MemoryReadScope = (typeof scopes)[number];

export interface MemoryReadParameters {
	scope: MemoryReadScope;
	coordinate?: string;
}

export interface MemoryReaderDependencies {
	memoryRoot: string;
	resolveCurrentIdentity(cwd?: string): Promise<RepositoryIdentity | undefined>;
}

export const memoryReadParameters = {
	type: "object",
	properties: {
		scope: { type: "string", enum: scopes },
		coordinate: { type: "string" },
	},
	required: ["scope"],
	additionalProperties: false,
} as const;

const TRUNCATION_MARKER =
	"\n\n[truncated: memory_read output exceeded 5000 characters]";

function validateParameters(value: MemoryReadParameters): void {
	if (!value || typeof value !== "object") {
		throw new Error("memory_read parameters must be an object");
	}
	const parameters = value as unknown as Record<string, unknown>;
	for (const key of Object.keys(parameters)) {
		if (key !== "scope" && key !== "coordinate") {
			throw new Error(`Unexpected parameter for memory_read: ${key}`);
		}
	}
	if (!scopes.includes(parameters.scope as MemoryReadScope)) {
		throw new Error("memory_read scope is invalid");
	}
	if (parameters.scope === "project") {
		if (typeof parameters.coordinate !== "string" || !parameters.coordinate) {
			throw new Error("A coordinate is required for project memory reads");
		}
		validateCoordinate(parameters.coordinate);
	} else if (parameters.coordinate !== undefined) {
		throw new Error("coordinate is only valid for project memory reads");
	}
}

function validateCoordinate(coordinate: string): void {
	if (!repositoryCoordinateToFilename(coordinate)) {
		throw new Error("Project coordinate is malformed");
	}
}

function safeCurrentProjectSource(identity: RepositoryIdentity): string {
	if (
		identity.filename.length > 240 ||
		basename(identity.filename) !== identity.filename ||
		!isSafeRepositoryMemoryFilename(identity.filename) ||
		identity.filename === ".md"
	) {
		throw new Error("Current project memory identity is unsafe");
	}
	return `projects/${identity.filename}`;
}

function safeRelativeProjectSource(root: string, path: string): string {
	const source = relative(root, path).split(sep).join("/");
	const prefix = "projects/";
	if (
		!source.startsWith(prefix) ||
		!isSafeRepositoryMemoryFilename(source.slice(prefix.length))
	) {
		throw new Error("Named project memory path failed containment validation");
	}
	return source;
}

async function readSafeMemory(input: {
	absolutePath: string;
	source: string;
	spec: MemoryFileSpec;
	description: string;
}): Promise<string> {
	const result = await readValidatedMemory({
		path: input.absolutePath,
		spec: input.spec,
	});
	if (result.text === undefined) {
		const reason = result.blockedReasons.join("; ") || "validation failed";
		throw new Error(`${input.description} is unavailable: ${reason}`);
	}
	return boundedOutput(`Source: ${input.source}\n\n${result.text}`);
}

function boundedOutput(output: string): string {
	if (output.length <= MEMORY_READ_MAX_CHARS) return output;
	return `${output.slice(
		0,
		MEMORY_READ_MAX_CHARS - TRUNCATION_MARKER.length,
	)}${TRUNCATION_MARKER}`;
}

async function readMemory(
	deps: MemoryReaderDependencies,
	parameters: MemoryReadParameters,
	cwd?: string,
): Promise<string> {
	validateParameters(parameters);

	if (parameters.scope === "user") {
		return readSafeMemory({
			absolutePath: join(deps.memoryRoot, "USER.md"),
			source: "USER.md",
			spec: USER_MEMORY_SPEC,
			description: "User memory",
		});
	}
	if (parameters.scope === "workflow") {
		return readSafeMemory({
			absolutePath: join(deps.memoryRoot, "WORKFLOWS.md"),
			source: "WORKFLOWS.md",
			spec: WORKFLOW_MEMORY_SPEC,
			description: "Workflow memory",
		});
	}
	if (parameters.scope === "index") {
		return readSafeMemory({
			absolutePath: join(deps.memoryRoot, "PROJECTS.md"),
			source: "PROJECTS.md",
			spec: PROJECT_INDEX_SPEC,
			description: "Project index memory",
		});
	}
	if (parameters.scope === "current_project") {
		const identity = await deps.resolveCurrentIdentity(cwd);
		if (!identity) throw new Error("Current project memory identity is unavailable");
		const source = safeCurrentProjectSource(identity);
		return readSafeMemory({
			absolutePath: join(deps.memoryRoot, source),
			source,
			spec: SCOPED_PROJECT_SPEC,
			description: "Current project memory",
		});
	}

	const path = await resolveIndexedProjectMemory({
		root: deps.memoryRoot,
		coordinate: parameters.coordinate!,
	});
	if (!path) {
		throw new Error(`Unknown project coordinate: ${parameters.coordinate}`);
	}
	const source = safeRelativeProjectSource(deps.memoryRoot, path);
	return readSafeMemory({
		absolutePath: path,
		source,
		spec: SCOPED_PROJECT_SPEC,
		description: "Named project memory",
	});
}

export function createMemoryReader(deps: MemoryReaderDependencies) {
	return (parameters: MemoryReadParameters): Promise<string> =>
		readMemory(deps, parameters);
}

export function createMemoryReadTool(deps: MemoryReaderDependencies) {
	return {
		name: "memory_read",
		label: "Read Memory",
		description:
			"Read validated user, workflow, current-project, named-project, or project-index durable memory.",
		parameters: memoryReadParameters,
		async execute(
			_toolCallId: string,
			parameters: MemoryReadParameters,
			_signal: AbortSignal,
			_onUpdate: unknown,
			ctx: { cwd: string },
		) {
			const text = await readMemory(deps, parameters, ctx.cwd);
			return { content: [{ type: "text" as const, text }] };
		},
	};
}
