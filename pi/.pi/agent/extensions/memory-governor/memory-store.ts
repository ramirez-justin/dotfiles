import { createHash, randomUUID } from "node:crypto";
import {
	mkdir,
	open,
	readFile,
	rename,
	rmdir,
	stat,
	unlink,
} from "node:fs/promises";
import { hostname as systemHostname } from "node:os";
import { basename, dirname, join } from "node:path";

export type MemoryFileKind =
	| "user"
	| "workflow"
	| "project-index"
	| "scoped-project";

export interface MemoryFileSpec {
	kind: MemoryFileKind;
	requiredSections: readonly string[];
	normalMaxChars: number;
}

export const USER_MEMORY_SPEC: MemoryFileSpec = {
	kind: "user",
	requiredSections: ["Rules", "Preferences"],
	normalMaxChars: 4_000,
};

export const WORKFLOW_MEMORY_SPEC: MemoryFileSpec = {
	kind: "workflow",
	requiredSections: ["Rules", "Conventions"],
	normalMaxChars: 4_000,
};

export const PROJECT_INDEX_SPEC: MemoryFileSpec = {
	kind: "project-index",
	requiredSections: ["Rules", "Scoped Projects", "Unscoped Facts"],
	normalMaxChars: 5_000,
};

export const SCOPED_PROJECT_SPEC: MemoryFileSpec = {
	kind: "scoped-project",
	requiredSections: ["Rules", "Facts"],
	normalMaxChars: 5_000,
};

export interface ValidatedMemory {
	text?: string;
	warnings: string[];
	blockedReasons: string[];
}

export type MutationResult =
	| { status: "written"; text: string; summary: string }
	| { status: "unchanged"; text: string; summary: string }
	| { status: "rejected"; text: string; reason: string }
	| { status: "conflict"; path: string }
	| { status: "lock-timeout"; path: string }
	| { status: "lock-uncertain"; path: string };

export interface MemoryMutation {
	changed: boolean;
	text: string;
	summary: string;
}

interface LockOwner {
	token: string;
	pid: number;
	hostname: string;
	targetPath: string;
	acquiredAt: string;
}

export interface LockOptions {
	timeoutMs?: number;
	staleMs?: number;
	retryDelayMs?: () => number;
	processKill?: (pid: number, signal: 0) => void;
	now?: () => number;
	hostname?: string;
}

interface ResolvedLockOptions {
	timeoutMs: number;
	staleMs: number;
	retryDelayMs: () => number;
	processKill: (pid: number, signal: 0) => void;
	now: () => number;
	hostname: string;
}

interface AcquiredLock {
	lockPath: string;
	ownerPath: string;
	owner: LockOwner;
}

interface FileSnapshot {
	exists: boolean;
	bytes: Uint8Array;
	hash: string;
	mode: number;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function errorCode(error: unknown): string | undefined {
	return (error as NodeJS.ErrnoException).code;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unsafeReason(text: string): string | undefined {
	if (
		/begin (?:rsa |openssh |ec )?private key/i.test(text) ||
		/\b(?:api[_-]?key|token|secret|password)\s*[:=]/i.test(text) ||
		/op:\/\//i.test(text)
	) {
		return "unsafe secret-like content";
	}
	if (
		/ignore (?:all )?(?:previous|prior) instructions|system prompt|developer message/i.test(
			text,
		)
	) {
		return "unsafe prompt-injection-like content";
	}
	return undefined;
}

function validateText(text: string, spec: MemoryFileSpec): ValidatedMemory {
	const blockedReasons: string[] = [];
	const unsafe = unsafeReason(text);
	if (unsafe) blockedReasons.push(unsafe);

	for (const section of spec.requiredSections) {
		const matches = text.match(
			new RegExp(`^## ${escapeRegExp(section)}\\s*$`, "gm"),
		);
		if (!matches) {
			blockedReasons.push(`missing required section "${section}"`);
		} else if (matches.length > 1) {
			blockedReasons.push(`duplicate required section "${section}"`);
		}
	}

	const warnings =
		text.length > spec.normalMaxChars
			? [
					`${spec.kind} memory exceeds its normal ${spec.normalMaxChars}-character budget`,
				]
			: [];
	return {
		text: blockedReasons.length === 0 ? text : undefined,
		warnings,
		blockedReasons,
	};
}

async function snapshot(path: string): Promise<FileSnapshot> {
	try {
		const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
		return {
			exists: true,
			bytes,
			hash: createHash("sha256").update(bytes).digest("hex"),
			mode: metadata.mode & 0o777,
		};
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
		const bytes = new Uint8Array();
		return {
			exists: false,
			bytes,
			hash: createHash("sha256").update(bytes).digest("hex"),
			mode: 0o600,
		};
	}
}

function decodeSnapshot(file: FileSnapshot): ValidatedMemory {
	try {
		return { text: decoder.decode(file.bytes), warnings: [], blockedReasons: [] };
	} catch {
		return {
			warnings: [],
			blockedReasons: ["file is not valid UTF-8"],
		};
	}
}

export async function readValidatedMemory(input: {
	path: string;
	spec: MemoryFileSpec;
}): Promise<ValidatedMemory> {
	let file: FileSnapshot;
	try {
		file = await snapshot(input.path);
	} catch {
		return {
			warnings: [],
			blockedReasons: ["file could not be read"],
		};
	}
	if (!file.exists) {
		return {
			warnings: [],
			blockedReasons: ["file does not exist"],
		};
	}
	const decoded = decodeSnapshot(file);
	if (decoded.text === undefined) return decoded;
	return validateText(decoded.text, input.spec);
}

function resolveLockOptions(options: LockOptions = {}): ResolvedLockOptions {
	return {
		timeoutMs: options.timeoutMs ?? 2_000,
		staleMs: options.staleMs ?? 30_000,
		retryDelayMs:
			options.retryDelayMs ?? (() => 25 + Math.floor(Math.random() * 51)),
		processKill: options.processKill ?? ((pid, signal) => process.kill(pid, signal)),
		now: options.now ?? Date.now,
		hostname: options.hostname ?? systemHostname(),
	};
}

function validOwner(value: unknown): value is LockOwner {
	if (!value || typeof value !== "object") return false;
	const owner = value as Partial<LockOwner>;
	return (
		typeof owner.token === "string" &&
		owner.token.length > 0 &&
		Number.isInteger(owner.pid) &&
		(owner.pid ?? 0) > 0 &&
		typeof owner.hostname === "string" &&
		owner.hostname.length > 0 &&
		typeof owner.targetPath === "string" &&
		owner.targetPath.length > 0 &&
		typeof owner.acquiredAt === "string" &&
		owner.acquiredAt.length > 0
	);
}

async function inspectExistingLock(
	lockPath: string,
	targetPath: string,
	options: ResolvedLockOptions,
): Promise<"busy" | "reclaimed" | "uncertain"> {
	const ownerPath = join(lockPath, "owner.json");
	let raw: string;
	let owner: LockOwner;
	try {
		raw = await readFile(ownerPath, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!validOwner(parsed)) return "uncertain";
		owner = parsed;
	} catch (error) {
		if (errorCode(error) !== "ENOENT") return "uncertain";
		try {
			const age = options.now() - (await stat(lockPath)).mtimeMs;
			return age >= -1_000 && age <= options.staleMs ? "busy" : "uncertain";
		} catch {
			return "busy";
		}
	}

	if (owner.targetPath !== targetPath || owner.hostname !== options.hostname) {
		return "uncertain";
	}
	const acquiredAt = Date.parse(owner.acquiredAt);
	const age = options.now() - acquiredAt;
	if (!Number.isFinite(acquiredAt) || age < 0) return "uncertain";
	if (age <= options.staleMs) return "busy";

	try {
		options.processKill(owner.pid, 0);
		return "busy";
	} catch (error) {
		if (errorCode(error) !== "ESRCH") return "uncertain";
	}

	try {
		if ((await readFile(ownerPath, "utf8")) !== raw) return "uncertain";
		await unlink(ownerPath);
		await rmdir(lockPath);
		return "reclaimed";
	} catch (error) {
		return errorCode(error) === "ENOENT" ? "reclaimed" : "uncertain";
	}
}

function pause(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock(
	path: string,
	lockOptions: LockOptions,
): Promise<AcquiredLock | "timeout" | "uncertain"> {
	const options = resolveLockOptions(lockOptions);
	const lockPath = `${path}.lock`;
	const ownerPath = join(lockPath, "owner.json");
	const deadline = options.now() + options.timeoutMs;

	while (true) {
		const owner: LockOwner = {
			token: randomUUID(),
			pid: process.pid,
			hostname: options.hostname,
			targetPath: path,
			acquiredAt: new Date(options.now()).toISOString(),
		};
		try {
			await mkdir(lockPath);
			const pendingOwnerPath = join(lockPath, `.owner-${owner.token}.tmp`);
			const handle = await open(pendingOwnerPath, "wx", 0o600);
			try {
				await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
				await handle.sync();
			} finally {
				await handle.close();
			}
			await rename(pendingOwnerPath, ownerPath);
			return { lockPath, ownerPath, owner };
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
			const state = await inspectExistingLock(lockPath, path, options);
			if (state === "uncertain") return "uncertain";
			if (state === "reclaimed") continue;
			if (options.now() >= deadline) return "timeout";
			await pause(options.retryDelayMs());
		}
	}
}

async function releaseOwnedLock(lock: AcquiredLock): Promise<void> {
	try {
		const parsed: unknown = JSON.parse(await readFile(lock.ownerPath, "utf8"));
		if (!validOwner(parsed) || parsed.token !== lock.owner.token) return;
		await unlink(lock.ownerPath);
		await rmdir(lock.lockPath);
	} catch {
		// Cleanup is best effort. Never remove a lock whose token cannot be verified.
	}
}

function snapshotsMatch(first: FileSnapshot, second: FileSnapshot): boolean {
	return first.exists === second.exists && first.hash === second.hash;
}

export async function mutateMemoryFile(input: {
	path: string;
	spec: MemoryFileSpec;
	mutate: (text: string) => MemoryMutation | Promise<MemoryMutation>;
	lock?: LockOptions;
}): Promise<MutationResult> {
	const acquired = await acquireLock(input.path, input.lock ?? {});
	if (acquired === "timeout") {
		return { status: "lock-timeout", path: input.path };
	}
	if (acquired === "uncertain") {
		return { status: "lock-uncertain", path: input.path };
	}

	let temporaryPath: string | undefined;
	try {
		const initial = await snapshot(input.path);
		let existingText = "";
		if (initial.exists) {
			const decoded = decodeSnapshot(initial);
			if (decoded.text === undefined) {
				return {
					status: "rejected",
					text: "",
					reason: decoded.blockedReasons.join("; "),
				};
			}
			existingText = decoded.text;
			const validation = validateText(existingText, input.spec);
			if (validation.blockedReasons.length > 0) {
				return {
					status: "rejected",
					text: existingText,
					reason: validation.blockedReasons.join("; "),
				};
			}
		}

		const mutation = await input.mutate(existingText);
		if (!mutation.changed) {
			return {
				status: "unchanged",
				text: mutation.text,
				summary: mutation.summary,
			};
		}
		const nextValidation = validateText(mutation.text, input.spec);
		if (nextValidation.blockedReasons.length > 0) {
			return {
				status: "rejected",
				text: existingText,
				reason: nextValidation.blockedReasons.join("; "),
			};
		}
		if (
			mutation.text.length > input.spec.normalMaxChars &&
			mutation.text.length > existingText.length
		) {
			return {
				status: "rejected",
				text: existingText,
				reason: "file exceeds its normal budget and cannot grow automatically",
			};
		}

		const latest = await snapshot(input.path);
		if (!snapshotsMatch(initial, latest)) {
			return { status: "conflict", path: input.path };
		}

		// POSIX rename has no portable compare-and-swap. A noncooperating manual
		// editor can still race in the narrow window after this final hash check.
		const token = acquired.owner.token;
		temporaryPath = join(
			dirname(input.path),
			`.${basename(input.path)}.memory-${token}.tmp`,
		);
		const handle = await open(temporaryPath, "wx", initial.mode);
		try {
			await handle.chmod(initial.mode);
			await handle.writeFile(mutation.text, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporaryPath, input.path);
		temporaryPath = undefined;
		return {
			status: "written",
			text: mutation.text,
			summary: mutation.summary,
		};
	} finally {
		if (temporaryPath?.includes(`memory-${acquired.owner.token}.tmp`)) {
			try {
				await unlink(temporaryPath);
			} catch (error) {
				if (errorCode(error) !== "ENOENT") throw error;
			}
		}
		await releaseOwnedLock(acquired);
	}
}
