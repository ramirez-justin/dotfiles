import { afterEach, describe, expect, test } from "bun:test";
import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RepositoryIdentity } from "./project-identity.ts";
import {
	createScopedMemoryText,
	ensureScopedProjectMemory,
	listAuditTargets,
	parseProjectIndex,
	renderProjectIndex,
	resolveIndexedProjectMemory,
} from "./project-memory.ts";

const roots: string[] = [];

const indexBase = `# Project Memory

Repository-scoped memory index and unscoped fallback.

## Rules

- Keep memory safe.

## Scoped Projects

## Unscoped Facts

- Keep this fallback.
`;

function remoteIdentity(
	coordinate = "github.com/acme/service",
	filename = "github.com--acme--service.md",
): RepositoryIdentity {
	return {
		kind: "remote",
		canonicalKey: `remote:${coordinate}`,
		coordinate,
		displayName: "acme/service",
		filename,
	};
}

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "project-memory-"));
	roots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

const trackedMemoryRoot = resolve(import.meta.dir, "../../memory");

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

test("tracked index resolves every scoped project file", async () => {
	const index = await readFile(join(trackedMemoryRoot, "PROJECTS.md"), "utf8");
	const entries = parseProjectIndex(index);
	for (const entry of entries) {
		expect(await fileExists(resolve(trackedMemoryRoot, entry.relativePath)))
			.toBe(true);
	}
});

describe("scoped project template", () => {
	test("is stable and has the required sections", () => {
		const coordinate = "github.com/acme/service";
		const first = createScopedMemoryText(coordinate);
		const second = createScopedMemoryText(coordinate);

		expect(first).toBe(second);
		expect(first).toContain("## Rules");
		expect(first).toContain("## Facts");
		expect(first).toContain(`\`${coordinate}\``);
	});
});

describe("project index Markdown", () => {
	test("parses single-line and wrapped entries and renders them stably", () => {
		const text = indexBase.replace(
			"## Scoped Projects\n",
			`## Scoped Projects

- \`github.com/acme/zeta\` → \`projects/github.com--acme--zeta.md\`
- \`github.com/acme/alpha\` →
  \`projects/github.com--acme--alpha.md\`
`,
		);
		const entries = parseProjectIndex(text);

		expect(entries).toHaveLength(2);
		const rendered = renderProjectIndex(indexBase, entries);
		expect(rendered).toContain("- Keep memory safe.");
		expect(rendered).toContain("- Keep this fallback.");
		expect(parseProjectIndex(rendered)).toEqual([
			{
				coordinate: "github.com/acme/alpha",
				relativePath: "projects/github.com--acme--alpha.md",
			},
			{
				coordinate: "github.com/acme/zeta",
				relativePath: "projects/github.com--acme--zeta.md",
			},
		]);
		expect(renderProjectIndex(indexBase, entries)).toBe(rendered);
	});

	test("rejects duplicate coordinates before incidental path errors", () => {
		const text = `## Scoped Projects

- \`github.com/acme/a\` → \`projects/a.md\`
- \`github.com/acme/a\` → \`projects/b.md\`
`;
		expect(() => parseProjectIndex(text)).toThrow(/duplicate coordinate/i);
	});

	test("rejects duplicate paths", () => {
		const text = `## Scoped Projects

- \`github.com/acme/a\` → \`projects/shared.md\`
- \`github.com/acme/b\` → \`projects/shared.md\`
`;
		expect(() => parseProjectIndex(text)).toThrow(/duplicate path/i);
	});

	test("rejects traversal and paths that do not match the coordinate", () => {
		for (const relativePath of [
			"projects/../USER.md",
			"/tmp/service.md",
			"projects/other.md",
		]) {
			const text = `## Scoped Projects

- \`github.com/acme/service\` → \`${relativePath}\`
`;
			expect(() => parseProjectIndex(text)).toThrow(/path/i);
		}
	});
});

describe("scoped project storage", () => {
	test("creates the scoped file safely before updating the locked index", async () => {
		const root = await temporaryRoot();
		await writeFile(join(root, "PROJECTS.md"), indexBase);
		const identity = remoteIdentity();

		const result = await ensureScopedProjectMemory({ root, identity });
		const expectedPath = join(root, "projects", identity.filename);
		expect(result).toEqual({ path: expectedPath, created: true });
		expect(await readFile(expectedPath, "utf8")).toBe(
			createScopedMemoryText(identity.coordinate!),
		);
		expect((await stat(expectedPath)).mode & 0o777).toBe(0o600);
		expect(parseProjectIndex(await readFile(join(root, "PROJECTS.md"), "utf8")))
			.toEqual([
				{
					coordinate: identity.coordinate,
					relativePath: `projects/${identity.filename}`,
				},
			]);
	});

	test("derives current local project memory directly without an index", async () => {
		const root = await temporaryRoot();
		const identity: RepositoryIdentity = {
			kind: "local",
			canonicalKey: "local:/source/service/.git",
			displayName: "service",
			filename: "local--service--0123456789ab.md",
		};

		const result = await ensureScopedProjectMemory({ root, identity });
		expect(result.path).toBe(join(root, "projects", identity.filename));
		expect(result.created).toBe(true);
		await expect(access(join(root, "PROJECTS.md"))).rejects.toThrow();
	});

	test("rejects an identity filename that can escape projects", async () => {
		const root = await temporaryRoot();
		await expect(
			ensureScopedProjectMemory({
				root,
				identity: remoteIdentity("github.com/acme/service", "../outside.md"),
			}),
		).rejects.toThrow(/filename|containment/i);
		await expect(access(join(root, "outside.md"))).rejects.toThrow();
	});

	test("resolves only indexed project memory", async () => {
		const root = await temporaryRoot();
		await writeFile(join(root, "PROJECTS.md"), indexBase);
		const identity = remoteIdentity();
		const created = await ensureScopedProjectMemory({ root, identity });

		expect(
			await resolveIndexedProjectMemory({
				root,
				coordinate: identity.coordinate!,
			}),
		).toBe(created.path);
		expect(
			await resolveIndexedProjectMemory({
				root,
				coordinate: "github.com/acme/unknown",
			}),
		).toBeUndefined();
	});

	test("enumerates top-level and indexed audit targets sequentially", async () => {
		const root = await temporaryRoot();
		const projects = join(root, "projects");
		await mkdir(projects);
		const entries = [
			{
				coordinate: "github.com/acme/alpha",
				relativePath: "projects/github.com--acme--alpha.md",
			},
			{
				coordinate: "github.com/acme/zeta",
				relativePath: "projects/github.com--acme--zeta.md",
			},
		];
		await writeFile(join(root, "PROJECTS.md"), renderProjectIndex(indexBase, entries));

		expect(await listAuditTargets(root)).toEqual([
			join(root, "USER.md"),
			join(root, "WORKFLOWS.md"),
			join(root, "PROJECTS.md"),
			join(projects, "github.com--acme--alpha.md"),
			join(projects, "github.com--acme--zeta.md"),
		]);
	});
});
