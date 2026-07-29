import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	createGitQuery,
	isSafeRepositoryMemoryFilename,
	normalizeRemoteIdentity,
	repositoryCoordinateToFilename,
	resolveRepositoryIdentity,
	type GitQuery,
} from "./project-identity.ts";

const equivalent = [
	"https://github.com/gametimesf/dbt-analytics.git",
	"ssh://git@github.com/gametimesf/dbt-analytics.git",
	"git@github.com:gametimesf/dbt-analytics.git",
];

function hashPath(path: string): string {
	return createHash("sha256").update(path).digest("hex").slice(0, 12);
}

function fakeGit(input: {
	origin?: string | Error;
	commonDir?: string | Error;
}): GitQuery {
	return {
		async origin() {
			if (input.origin instanceof Error) throw input.origin;
			return input.origin;
		},
		async commonDir() {
			if (input.commonDir instanceof Error) throw input.commonDir;
			return input.commonDir;
		},
	};
}

describe("remote repository identity", () => {
	test("normalizes common remote forms identically", () => {
		const identities = equivalent.map(normalizeRemoteIdentity);
		expect(new Set(identities.map((item) => item?.canonicalKey)).size).toBe(1);
		expect(identities[0]).toMatchObject({
			kind: "remote",
			coordinate: "github.com/gametimesf/dbt-analytics",
			displayName: "gametimesf/dbt-analytics",
			filename: "github.com--gametimesf--dbt-analytics.md",
		});
	});

	test("tags non-default ports so a normal namespace cannot collide", () => {
		const portIdentity = normalizeRemoteIdentity(
			"ssh://git@example.com:2222/team/repo.git",
		);
		const namespaceIdentity = normalizeRemoteIdentity(
			"ssh://git@example.com/port-2222/team/repo.git",
		);

		expect(portIdentity?.filename).toBe(
			"example.com--~p2222--team--repo.md",
		);
		expect(namespaceIdentity?.filename).toBe(
			"example.com--port-2222--team--repo.md",
		);
		expect(portIdentity?.filename).not.toBe(namespaceIdentity?.filename);
		expect(
			normalizeRemoteIdentity("https://example.com:8443/team/repo.git")
				?.coordinate,
		).toBe("example.com:8443/team/repo");
	});

	test("supports nested namespaces", () => {
		expect(
			normalizeRemoteIdentity("https://gitlab.com/group/subgroup/repo.git")
				?.filename,
		).toBe("gitlab.com--group--subgroup--repo.md");
	});

	test("encodes namespace and repository segments that contain the delimiter", () => {
		const namespaceSegment = normalizeRemoteIdentity(
			"https://example.com/team--blue/service.git",
		);
		const repositorySegment = normalizeRemoteIdentity(
			"https://example.com/team/blue--service.git",
		);

		expect(namespaceSegment?.filename).toBe(
			"example.com--~x7465616d2d2d626c7565--service.md",
		);
		expect(repositorySegment?.filename).toBe(
			"example.com--team--~x626c75652d2d73657276696365.md",
		);
		expect(namespaceSegment?.filename).not.toBe(repositorySegment?.filename);
	});

	test("uses explicit delimiter-escape tags for ambiguous hosts", () => {
		const identity = normalizeRemoteIdentity(
			"ssh://git@example.com--port-2222/team/repo.git",
		);

		expect(identity?.filename).toBe(
			"~x6578616d706c652e636f6d2d2d706f72742d32323232--team--repo.md",
		);
	});

	test("strips credentials, default ports, queries, and fragments", () => {
		const remotes = [
			"https://user:password@GitHub.com:443/Team/Repo.git?ref=main#readme",
			"ssh://git:password@github.com:22/Team/Repo.git?ref=main#readme",
		];
		for (const remote of remotes) {
			expect(normalizeRemoteIdentity(remote)).toMatchObject({
				coordinate: "github.com/team/repo",
				filename: "github.com--team--repo.md",
			});
		}
	});

	test("rejects malformed or unsafe remotes", () => {
		for (const remote of [
			"",
			"ftp://example.com/team/repo.git",
			"https://example.com/repo.git",
			"https://example.com/team/../repo.git",
			"https://example.com/team/%2Fetc.git",
			"https://example.com/team/%00repo.git",
			"git@example.com:",
		]) {
			expect(normalizeRemoteIdentity(remote)).toBeUndefined();
		}
	});
});

describe("local repository identity", () => {
	test("uses the canonical Git common directory", async () => {
		const canonical = "/canonical/source/service/.git";
		const identity = await resolveRepositoryIdentity({
			cwd: "/worktrees/service-feature",
			memoryProjectsDir: "/memory/projects",
			git: fakeGit({ commonDir: "/source/service/.git" }),
			realpath: async (path) =>
				path === "/source/service/.git" ? canonical : path,
		});

		expect(identity).toMatchObject({
			kind: "local",
			canonicalKey: `local:${canonical}`,
			displayName: "service",
			filename: `~l--service--${hashPath(canonical)}.md`,
		});
		expect(identity.diagnostic).toMatch(/origin remote is unavailable/i);
	});

	test("avoids collisions for repositories with the same basename", async () => {
		const resolve = (cwd: string) =>
			resolveRepositoryIdentity({
				cwd,
				memoryProjectsDir: "/memory/projects",
				git: fakeGit({}),
				realpath: async (path) => path,
			});
		const first = await resolve("/one/service");
		const second = await resolve("/two/service");

		expect(first.filename).toMatch(/^~l--service--[a-f0-9]{12}\.md$/);
		expect(second.filename).toMatch(/^~l--service--[a-f0-9]{12}\.md$/);
		expect(first.filename).not.toBe(second.filename);
	});

	test("falls back to canonical cwd outside Git", async () => {
		const canonical = "/canonical/local project";
		const identity = await resolveRepositoryIdentity({
			cwd: "/local/project",
			memoryProjectsDir: "/memory/projects",
			git: fakeGit({ commonDir: new Error("not a repository") }),
			realpath: async () => canonical,
		});

		expect(identity.filename).toBe(
			`~l--local-project--${hashPath(canonical)}.md`,
		);
		expect(identity.diagnostic).toMatch(/Git common directory is unavailable/i);
	});

	test("tags local identity so a remote host named local cannot collide", async () => {
		const canonical = "/source/name";
		const local = await resolveRepositoryIdentity({
			cwd: canonical,
			memoryProjectsDir: "/memory/projects",
			git: fakeGit({}),
			realpath: async (path) => path,
		});
		const remote = normalizeRemoteIdentity(
			`ssh://git@local/name/${hashPath(canonical)}.git`,
		);

		expect(local.filename).toBe(`~l--name--${hashPath(canonical)}.md`);
		expect(remote?.filename).toBe(`local--name--${hashPath(canonical)}.md`);
		expect(local.filename).not.toBe(remote?.filename);
	});

	test("does not expose a malformed credential-bearing remote", async () => {
		const remote = "https://sensitive-user:secret@example.com/repo.git";
		const identity = await resolveRepositoryIdentity({
			cwd: "/source/repo",
			memoryProjectsDir: "/memory/projects",
			git: fakeGit({ origin: remote, commonDir: "/source/repo/.git" }),
			realpath: async (path) => path,
		});

		expect(identity.kind).toBe("local");
		expect(identity.diagnostic).not.toContain(remote);
		expect(identity.diagnostic).not.toContain("sensitive-user");
		expect(identity.diagnostic).not.toContain("secret");
	});
});

describe("controlled repository filename tags", () => {
	test("converts coordinates with tagged ports and escaped delimiters", () => {
		expect(repositoryCoordinateToFilename("example.com:2222/team/repo")).toBe(
			"example.com--~p2222--team--repo.md",
		);
		expect(repositoryCoordinateToFilename("example.com/team--blue/repo")).toBe(
			"example.com--~x7465616d2d2d626c7565--repo.md",
		);
	});

	test("rejects malformed, misplaced, and noncanonical controlled tags", () => {
		for (const filename of [
			"example.com--~p0--team--repo.md",
			"example.com--~p65536--team--repo.md",
			"example.com--team--~p2222--repo.md",
			"example.com--~l--team--repo.md",
			"~l--name--not-a-hash.md",
			"example.com--~x--repo.md",
			"example.com--~x0--repo.md",
			"example.com--~xzz--repo.md",
			"example.com--~x7465616d--repo.md",
			"example.com--~x7465616D2d2d626c7565--repo.md",
			"example.com--~q7465616d2d2d626c7565--repo.md",
		]) {
			expect(isSafeRepositoryMemoryFilename(filename)).toBe(false);
		}
	});
});

test("production Git query uses bounded pi.exec calls", async () => {
	const calls: Array<{
		command: string;
		args: string[];
		options: { timeout: number };
	}> = [];
	const git = createGitQuery({
		async exec(command, args, options) {
			calls.push({ command, args, options });
			return { stdout: calls.length === 1 ? "remote\n" : "/common\n" };
		},
	});

	expect(await git.origin("/repo")).toBe("remote");
	expect(await git.commonDir("/repo")).toBe("/common");
	expect(calls).toEqual([
		{
			command: "git",
			args: ["-C", "/repo", "config", "--get", "remote.origin.url"],
			options: { timeout: 2_000 },
		},
		{
			command: "git",
			args: [
				"-C",
				"/repo",
				"rev-parse",
				"--path-format=absolute",
				"--git-common-dir",
			],
			options: { timeout: 2_000 },
		},
	]);
});
