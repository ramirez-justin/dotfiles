import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
	mutateMemoryFile,
	PROJECT_INDEX_SPEC,
	readValidatedMemory,
	SCOPED_PROJECT_SPEC,
	type MutationResult,
} from "./memory-store.ts";
import {
	isSafeRepositoryMemoryFilename,
	repositoryCoordinateToFilename,
	type RepositoryIdentity,
} from "./project-identity.ts";

export interface ProjectIndexEntry {
	coordinate: string;
	relativePath: string;
}

const INDEX_ENTRY =
	/-\s+`([^`]+)`\s+→\s*(?:\r?\n\s*)?`([^`]+)`/g;

const scopedRules = `- Do not store secrets, credentials, transient state, or unverified
  guesses.
- Keep facts stable, actionable, and specific to this repository.
- Audit existing facts before adding or changing entries.`;

const emptyIndexText = `# Project Memory

Repository-scoped memory index and unscoped fallback.

## Rules

- Do not store secrets, credentials, transient state, or unverified guesses.
- Keep repository coordinates and scoped paths deterministic.
- Audit existing entries before adding or changing them.

## Scoped Projects

## Unscoped Facts
`;

export function createScopedMemoryText(coordinate: string): string {
	return `# Project Memory: ${coordinate}

Stable facts for \`${coordinate}\`.

## Rules

${scopedRules}

## Facts
`;
}

function validateEntries(entries: readonly ProjectIndexEntry[]): void {
	const coordinates = new Set<string>();
	const paths = new Set<string>();
	for (const entry of entries) {
		if (coordinates.has(entry.coordinate)) {
			throw new Error(`Duplicate coordinate: ${entry.coordinate}`);
		}
		coordinates.add(entry.coordinate);
		if (paths.has(entry.relativePath)) {
			throw new Error(`Duplicate path: ${entry.relativePath}`);
		}
		paths.add(entry.relativePath);
	}

	for (const entry of entries) {
		const filename = repositoryCoordinateToFilename(entry.coordinate);
		if (!filename || entry.relativePath !== `projects/${filename}`) {
			throw new Error("Project index path does not match its repository coordinate");
		}
	}
}

function scopedSection(text: string): {
	bodyStart: number;
	bodyEnd: number;
} {
	const heading = /^## Scoped Projects\s*$/m.exec(text);
	if (!heading || heading.index === undefined) {
		throw new Error('Project index is missing the "Scoped Projects" section');
	}
	const bodyStart = heading.index + heading[0].length;
	const following = /^## .+$/m.exec(text.slice(bodyStart));
	return {
		bodyStart,
		bodyEnd: following ? bodyStart + following.index : text.length,
	};
}

export function parseProjectIndex(text: string): ProjectIndexEntry[] {
	const section = scopedSection(text);
	const body = text.slice(section.bodyStart, section.bodyEnd);
	const entries: ProjectIndexEntry[] = [];
	let consumed = 0;
	for (const match of body.matchAll(INDEX_ENTRY)) {
		if (body.slice(consumed, match.index).trim()) {
			throw new Error("Malformed project index entry");
		}
		entries.push({ coordinate: match[1], relativePath: match[2] });
		consumed = match.index + match[0].length;
	}
	if (body.slice(consumed).trim()) {
		throw new Error("Malformed project index entry");
	}
	validateEntries(entries);
	return entries;
}

export function renderProjectIndex(
	baseText: string,
	entries: readonly ProjectIndexEntry[],
): string {
	validateEntries(entries);
	const base = baseText || emptyIndexText;
	const section = scopedSection(base);
	const sorted = [...entries].sort((left, right) =>
		left.coordinate.localeCompare(right.coordinate),
	);
	const body = sorted
		.map(
			(entry) =>
				`- \`${entry.coordinate}\` →\n  \`${entry.relativePath}\``,
		)
		.join("\n");
	const before = base.slice(0, section.bodyStart).trimEnd();
	const after = base.slice(section.bodyEnd).trimStart();
	return `${before}\n\n${body}${body ? "\n\n" : "\n"}${after}`.trimEnd() + "\n";
}

function assertSafeIdentityFilename(identity: RepositoryIdentity): void {
	if (
		basename(identity.filename) !== identity.filename ||
		!isSafeRepositoryMemoryFilename(identity.filename) ||
		!identity.filename.endsWith(".md") ||
		identity.filename === ".md"
	) {
		throw new Error("Repository identity filename is not safe for project memory");
	}
	if (
		identity.coordinate &&
		repositoryCoordinateToFilename(identity.coordinate) !== identity.filename
	) {
		throw new Error("Repository identity filename does not match its coordinate");
	}
}

async function canonicalProjectsDirectory(
	root: string,
	create: boolean,
): Promise<string> {
	const projects = join(root, "projects");
	if (create) await mkdir(projects, { recursive: true, mode: 0o700 });
	const [canonicalRoot, canonicalProjects] = await Promise.all([
		realpath(root),
		realpath(projects),
	]);
	if (
		dirname(canonicalProjects) !== canonicalRoot ||
		basename(canonicalProjects) !== "projects"
	) {
		throw new Error("Projects directory failed containment validation");
	}
	return canonicalProjects;
}

function containedProjectPath(projects: string, filename: string): string {
	const path = resolve(projects, filename);
	if (dirname(path) !== projects || !path.startsWith(`${projects}${sep}`)) {
		throw new Error("Project memory path failed containment validation");
	}
	return path;
}

async function rejectSymlink(path: string): Promise<void> {
	try {
		if ((await lstat(path)).isSymbolicLink()) {
			throw new Error("Project memory path cannot be a symbolic link");
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

function requireSuccessfulMutation(
	result: MutationResult,
	operation: string,
): void {
	if (result.status === "written" || result.status === "unchanged") return;
	if (result.status === "rejected") {
		throw new Error(`${operation} was rejected: ${result.reason}`);
	}
	throw new Error(`${operation} failed with ${result.status}`);
}

export async function ensureScopedProjectMemory(input: {
	root: string;
	identity: RepositoryIdentity;
}): Promise<{ path: string; created: boolean }> {
	assertSafeIdentityFilename(input.identity);
	const projects = await canonicalProjectsDirectory(input.root, true);
	const path = containedProjectPath(projects, input.identity.filename);
	await rejectSymlink(path);
	const coordinate = input.identity.coordinate ?? input.identity.displayName;
	const scopedResult = await mutateMemoryFile({
		path,
		spec: SCOPED_PROJECT_SPEC,
		mutate: (text) =>
			text
				? { changed: false, text, summary: "scoped project memory already exists" }
				: {
						changed: true,
						text: createScopedMemoryText(coordinate),
						summary: "created scoped project memory",
					},
	});
	requireSuccessfulMutation(scopedResult, "Scoped project memory creation");

	if (input.identity.coordinate) {
		const indexPath = join(await realpath(input.root), "PROJECTS.md");
		const entry = {
			coordinate: input.identity.coordinate,
			relativePath: `projects/${input.identity.filename}`,
		};
		const indexResult = await mutateMemoryFile({
			path: indexPath,
			spec: PROJECT_INDEX_SPEC,
			mutate: (text) => {
				const entries = text ? parseProjectIndex(text) : [];
				if (
					entries.some(
						(existing) =>
							existing.coordinate === entry.coordinate &&
							existing.relativePath === entry.relativePath,
					)
				) {
					return { changed: false, text, summary: "project index already contains entry" };
				}
				return {
					changed: true,
					text: renderProjectIndex(text, [...entries, entry]),
					summary: "added scoped project index entry",
				};
			},
		});
		requireSuccessfulMutation(indexResult, "Project index update");
	}

	return {
		path: join(input.root, "projects", input.identity.filename),
		created: scopedResult.status === "written",
	};
}

async function safeIndexedPath(root: string, entry: ProjectIndexEntry): Promise<string> {
	const projects = await canonicalProjectsDirectory(root, false);
	const filename = entry.relativePath.slice("projects/".length);
	const path = containedProjectPath(projects, filename);
	await rejectSymlink(path);
	return path;
}

async function requireRegularIndexedAuditTarget(
	path: string,
	relativePath: string,
): Promise<void> {
	try {
		const target = await lstat(path);
		if (target.isFile()) return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	throw new Error(
		`Project index drift: indexed audit target is missing or not a regular file: ${relativePath}`,
	);
}

async function readIndex(root: string): Promise<ProjectIndexEntry[]> {
	const indexPath = join(await realpath(root), "PROJECTS.md");
	const validated = await readValidatedMemory({
		path: indexPath,
		spec: PROJECT_INDEX_SPEC,
	});
	if (validated.text === undefined) {
		throw new Error(
			`Project index is unavailable: ${validated.blockedReasons.join("; ")}`,
		);
	}
	return parseProjectIndex(validated.text);
}

export async function resolveIndexedProjectMemory(input: {
	root: string;
	coordinate: string;
}): Promise<string | undefined> {
	const entry = (await readIndex(input.root)).find(
		(item) => item.coordinate === input.coordinate,
	);
	if (!entry) return undefined;
	await safeIndexedPath(input.root, entry);
	return join(input.root, entry.relativePath);
}

export async function listAuditTargets(root: string): Promise<string[]> {
	const targets = [
		join(root, "USER.md"),
		join(root, "WORKFLOWS.md"),
		join(root, "PROJECTS.md"),
	];
	for (const entry of await readIndex(root)) {
		const path = await safeIndexedPath(root, entry);
		await requireRegularIndexedAuditTarget(path, entry.relativePath);
		targets.push(join(root, entry.relativePath));
	}
	return targets;
}
