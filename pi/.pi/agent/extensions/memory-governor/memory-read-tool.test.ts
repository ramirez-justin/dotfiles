import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepositoryIdentity } from "./project-identity.ts";
import {
	createMemoryReader,
	createMemoryReadTool,
	MEMORY_READ_MAX_CHARS,
	memoryReadParameters,
} from "./memory-read-tool.ts";

const roots: string[] = [];

const identity: RepositoryIdentity = {
	kind: "remote",
	canonicalKey: "remote:github.com/acme/service",
	coordinate: "github.com/acme/service",
	displayName: "acme/service",
	filename: "github.com--acme--service.md",
};

const userMemory = `# User Memory

## Rules

- Keep user memory safe.

## Preferences

- Prefer concise responses.
`;

const workflowMemory = `# Workflow Memory

## Rules

- Keep workflow memory safe.

## Conventions

- Verify the diff.
`;

const projectMemory = `# Project Memory: github.com/acme/service

## Rules

- Keep project memory safe.

## Facts

- The service uses Bun.
`;

const projectIndex = `# Project Memory

## Rules

- Keep the index safe.

## Scoped Projects

- \`github.com/acme/service\` →
  \`projects/github.com--acme--service.md\`

## Unscoped Facts
`;

async function fixture(options: {
	includeCurrentProject?: boolean;
} = {}) {
	const memoryRoot = await mkdtemp(join(tmpdir(), "memory-read-tool-"));
	roots.push(memoryRoot);
	await mkdir(join(memoryRoot, "projects"));
	await Promise.all([
		writeFile(join(memoryRoot, "USER.md"), userMemory),
		writeFile(join(memoryRoot, "WORKFLOWS.md"), workflowMemory),
		writeFile(join(memoryRoot, "PROJECTS.md"), projectIndex),
	]);
	if (options.includeCurrentProject !== false) {
		await writeFile(
			join(memoryRoot, "projects", identity.filename),
			projectMemory,
		);
	}
	return {
		memoryRoot,
		resolveCurrentIdentity: async (_cwd?: string) => identity,
	};
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("memory reader scopes", () => {
	test("reads validated user, workflow, current-project, and index memory", async () => {
		const reader = createMemoryReader(await fixture());

		expect(await reader({ scope: "user" })).toContain(
			"Source: USER.md\n\n# User Memory",
		);
		expect(await reader({ scope: "workflow" })).toContain(
			"Source: WORKFLOWS.md\n\n# Workflow Memory",
		);
		expect(await reader({ scope: "current_project" })).toContain(
			`Source: projects/${identity.filename}\n\n# Project Memory`,
		);
		expect(await reader({ scope: "index" })).toContain(
			"Source: PROJECTS.md\n\n# Project Memory",
		);
	});

	test("resolves named project memory only through the validated index", async () => {
		const deps = await fixture();
		const reader = createMemoryReader(deps);

		expect(
			await reader({ scope: "project", coordinate: identity.coordinate }),
		).toContain(`Source: projects/${identity.filename}`);
		await expect(
			reader({ scope: "project", coordinate: "github.com/acme/unknown" }),
		).rejects.toThrow(/unknown project coordinate/i);

		await writeFile(
			join(deps.memoryRoot, "PROJECTS.md"),
			projectIndex.replace("## Unscoped Facts", "## Scoped Projects"),
		);
		await expect(
			reader({ scope: "project", coordinate: identity.coordinate }),
		).rejects.toThrow(/index|duplicate required section/i);
	});

	test("reports missing current-project memory", async () => {
		const reader = createMemoryReader(
			await fixture({ includeCurrentProject: false }),
		);

		await expect(reader({ scope: "current_project" })).rejects.toThrow(
			/current project memory.*does not exist/i,
		);
	});
});

describe("memory reader validation", () => {
	test("requires coordinate only for named project reads", async () => {
		const reader = createMemoryReader(await fixture());
		await expect(reader({ scope: "project" })).rejects.toThrow(/coordinate/i);
		await expect(
			reader({ scope: "user", coordinate: "github.com/acme/repo" }),
		).rejects.toThrow(/only valid for project/i);
	});

	test("rejects traversal, absolute paths, URLs, and malformed coordinates", async () => {
		const reader = createMemoryReader(await fixture());
		for (const coordinate of [
			"../USER.md",
			"/tmp/x",
			"file:///tmp/x",
			"github.com/acme",
			"github.com/acme/../USER.md",
			"github.com/acme/%2e%2e",
			"GitHub.com/acme/service",
		]) {
			await expect(reader({ scope: "project", coordinate })).rejects.toThrow(
				/coordinate/i,
			);
		}
	});

	test("rejects unknown parameters instead of accepting filesystem paths", async () => {
		const reader = createMemoryReader(await fixture());
		await expect(
			reader({ scope: "user", path: "/tmp/USER.md" } as never),
		).rejects.toThrow(/unexpected parameter/i);
	});

	test("never returns unsafe memory content", async () => {
		const deps = await fixture();
		const unsafeValue = "API_KEY=do-not-return-this";
		await writeFile(
			join(deps.memoryRoot, "USER.md"),
			`${userMemory}\n- ${unsafeValue}\n`,
		);
		const reader = createMemoryReader(deps);

		try {
			await reader({ scope: "user" });
			throw new Error("expected unsafe memory to be rejected");
		} catch (error) {
			expect(String(error)).toMatch(/unsafe/i);
			expect(String(error)).not.toContain(unsafeValue);
		}
	});

	test("caps output at 5,000 characters with an explicit marker", async () => {
		const deps = await fixture();
		await writeFile(
			join(deps.memoryRoot, "USER.md"),
			userMemory.replace(
				"- Prefer concise responses.",
				`- ${"x".repeat(MEMORY_READ_MAX_CHARS + 100)}.`,
			),
		);
		const output = await createMemoryReader(deps)({ scope: "user" });

		expect(output).toHaveLength(MEMORY_READ_MAX_CHARS);
		expect(output).toMatch(/\[truncated: memory_read output exceeded 5000 characters\]$/);
	});
});

test("defines a strict Google-compatible parameter schema", () => {
	expect(memoryReadParameters.type).toBe("object");
	expect(memoryReadParameters.required).toEqual(["scope"]);
	expect(memoryReadParameters.properties.scope.enum).toEqual([
		"user",
		"workflow",
		"current_project",
		"project",
		"index",
	]);
	expect(memoryReadParameters.properties.coordinate).toEqual({ type: "string" });
	expect(memoryReadParameters.additionalProperties).toBe(false);
});

test("defines an agent tool that resolves current identity from execution cwd", async () => {
	const deps = await fixture();
	let resolvedCwd: string | undefined;
	const tool = createMemoryReadTool({
		...deps,
		resolveCurrentIdentity: async (cwd?: string) => {
			resolvedCwd = cwd;
			return identity;
		},
	});

	expect(tool.name).toBe("memory_read");
	expect(tool.parameters).toBe(memoryReadParameters);
	const result = await tool.execute(
		"call-1",
		{ scope: "current_project" },
		new AbortController().signal,
		undefined,
		{ cwd: "/work/service" } as never,
	);
	expect(resolvedCwd).toBe("/work/service");
	expect(result.content).toEqual([
		{ type: "text", text: expect.stringContaining("The service uses Bun.") },
	]);
});
