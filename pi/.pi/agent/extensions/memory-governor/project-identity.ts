import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";

export interface RepositoryIdentity {
	kind: "remote" | "local";
	canonicalKey: string;
	coordinate?: string;
	displayName: string;
	filename: string;
	diagnostic?: string;
}

export interface GitQuery {
	origin(cwd: string): Promise<string | undefined>;
	commonDir(cwd: string): Promise<string | undefined>;
}

export interface GitExecutor {
	exec(
		command: string,
		args: string[],
		options: { timeout: number },
	): Promise<{ stdout: string; code?: number }>;
}

interface ParsedRemote {
	host: string;
	port?: string;
	segments: string[];
}

const SAFE_SEGMENT = /^[a-z0-9._-]+$/;

function safeSegment(raw: string): string | undefined {
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return undefined;
	}
	const segment = decoded.toLowerCase();
	if (
		!segment ||
		segment === "." ||
		segment === ".." ||
		/[\u0000-\u001f\u007f]/.test(segment) ||
		segment.includes("/") ||
		segment.includes("\\") ||
		/^[a-z][a-z0-9+.-]*:/i.test(segment) ||
		!SAFE_SEGMENT.test(segment)
	) {
		return undefined;
	}
	return segment;
}

function validPort(port: string): boolean {
	if (!/^\d+$/.test(port)) return false;
	const numeric = Number(port);
	return numeric >= 1 && numeric <= 65_535;
}

function parseUrlRemote(remote: string): ParsedRemote | undefined {
	const schemeMatch = remote.match(/^(https|ssh):\/\//i);
	if (!schemeMatch) return undefined;
	const scheme = schemeMatch[1].toLowerCase();
	const withoutQuery = remote.split(/[?#]/, 1)[0];
	const authorityStart = withoutQuery.indexOf("//") + 2;
	const pathStart = withoutQuery.indexOf("/", authorityStart);
	if (pathStart < 0) return undefined;

	let parsed: URL;
	try {
		parsed = new URL(remote);
	} catch {
		return undefined;
	}
	if (parsed.protocol !== `${scheme}:` || !parsed.hostname) return undefined;

	const host = safeSegment(parsed.hostname);
	if (!host) return undefined;
	let port = parsed.port || undefined;
	if (port && !validPort(port)) return undefined;
	if ((scheme === "https" && port === "443") || (scheme === "ssh" && port === "22")) {
		port = undefined;
	}

	const rawSegments = withoutQuery.slice(pathStart + 1).split("/");
	const segments = normalizePathSegments(rawSegments);
	return segments ? { host, port, segments } : undefined;
}

function parseScpRemote(remote: string): ParsedRemote | undefined {
	const withoutQuery = remote.split(/[?#]/, 1)[0];
	const match = withoutQuery.match(/^(?:[^@/:\s]+@)?([^/:\s]+):(.+)$/);
	if (!match) return undefined;
	const host = safeSegment(match[1]);
	const segments = normalizePathSegments(match[2].split("/"));
	return host && segments ? { host, segments } : undefined;
}

function normalizePathSegments(rawSegments: string[]): string[] | undefined {
	if (rawSegments.length < 2 || rawSegments.some((segment) => segment === "")) {
		return undefined;
	}
	const repository = rawSegments.at(-1)?.replace(/\.git$/i, "");
	if (!repository) return undefined;
	const normalized = [...rawSegments.slice(0, -1), repository].map(safeSegment);
	if (normalized.some((segment) => segment === undefined)) return undefined;
	return normalized as string[];
}

export function normalizeRemoteIdentity(
	remote: string,
): RepositoryIdentity | undefined {
	const trimmed = remote.trim();
	if (!trimmed) return undefined;
	const parsed = parseUrlRemote(trimmed) ?? parseScpRemote(trimmed);
	if (!parsed) return undefined;

	const hostCoordinate = parsed.port
		? `${parsed.host}:${parsed.port}`
		: parsed.host;
	const coordinate = [hostCoordinate, ...parsed.segments].join("/");
	const hostFilenameSegments = parsed.port
		? [parsed.host, `port-${parsed.port}`]
		: [parsed.host];

	return {
		kind: "remote",
		canonicalKey: `remote:${coordinate}`,
		coordinate,
		displayName: parsed.segments.join("/"),
		filename: `${[...hostFilenameSegments, ...parsed.segments].join("--")}.md`,
	};
}

function sanitizeLocalName(path: string): string {
	const leaf = basename(path) === ".git" ? basename(dirname(path)) : basename(path);
	const withoutGitSuffix = leaf.replace(/\.git$/i, "");
	return (
		withoutGitSuffix
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "repository"
	);
}

function localIdentity(canonicalPath: string, diagnostic: string): RepositoryIdentity {
	const displayName = sanitizeLocalName(canonicalPath);
	const hash = createHash("sha256")
		.update(canonicalPath)
		.digest("hex")
		.slice(0, 12);
	return {
		kind: "local",
		canonicalKey: `local:${canonicalPath}`,
		displayName,
		filename: `local--${displayName}--${hash}.md`,
		diagnostic,
	};
}

export function createGitQuery(pi: GitExecutor): GitQuery {
	async function query(args: string[]): Promise<string | undefined> {
		const result = await pi.exec("git", args, { timeout: 2_000 });
		if (result.code !== undefined && result.code !== 0) return undefined;
		return result.stdout.trim() || undefined;
	}
	return {
		origin: (cwd) =>
			query(["-C", cwd, "config", "--get", "remote.origin.url"]),
		commonDir: (cwd) =>
			query([
				"-C",
				cwd,
				"rev-parse",
				"--path-format=absolute",
				"--git-common-dir",
			]),
	};
}

export async function resolveRepositoryIdentity(input: {
	cwd: string;
	memoryProjectsDir: string;
	git: GitQuery;
	realpath(path: string): Promise<string>;
}): Promise<RepositoryIdentity> {
	void input.memoryProjectsDir;
	let diagnostic: string;
	try {
		const origin = await input.git.origin(input.cwd);
		if (origin) {
			const remoteIdentity = normalizeRemoteIdentity(origin);
			if (remoteIdentity) return remoteIdentity;
			diagnostic = "Origin remote could not be normalized; using local repository identity.";
		} else {
			diagnostic = "Origin remote is unavailable; using local repository identity.";
		}
	} catch {
		diagnostic = "Origin remote lookup failed; using local repository identity.";
	}

	try {
		const commonDir = await input.git.commonDir(input.cwd);
		if (commonDir) {
			try {
				return localIdentity(await input.realpath(commonDir), diagnostic);
			} catch {
				diagnostic = `${diagnostic} Git common directory could not be canonicalized; using the current directory.`;
			}
		} else {
			diagnostic = `${diagnostic} Git common directory is unavailable; using the current directory.`;
		}
	} catch {
		diagnostic = `${diagnostic} Git common directory is unavailable; using the current directory.`;
	}

	return localIdentity(await input.realpath(input.cwd), diagnostic);
}
