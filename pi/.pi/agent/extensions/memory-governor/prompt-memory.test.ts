import { afterEach, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryCandidate } from "./candidate.ts";
import type { RepositoryIdentity } from "./project-identity.ts";
import {
	appendDurableMemory,
	buildPromptMemory,
	HARD_PROMPT_MEMORY_CHARS,
} from "./prompt-memory.ts";

const roots: string[] = [];

const userMemory = `# User Memory

## Rules

- Keep user rules.

## Preferences

- Prefer concise responses.
`;

const workflowMemory = `# Workflow Memory

## Rules

- Keep workflow rules.

## Conventions

- Verify the diff.
`;

const projectMemory = `# Project Memory: github.com/acme/service

## Rules

- Keep project rules.

## Facts

- The service uses Bun.
`;

const identity: RepositoryIdentity = {
	kind: "remote",
	canonicalKey: "remote:github.com/acme/service",
	coordinate: "github.com/acme/service",
	displayName: "acme/service",
	filename: "github.com--acme--service.md",
};

async function fixture(): Promise<{
	memoryRoot: string;
	identity: RepositoryIdentity;
	writeUser(text: string): Promise<void>;
}> {
	const memoryRoot = await mkdtemp(join(tmpdir(), "prompt-memory-"));
	roots.push(memoryRoot);
	await mkdir(join(memoryRoot, "projects"));
	await Promise.all([
		writeFile(join(memoryRoot, "USER.md"), userMemory),
		writeFile(join(memoryRoot, "WORKFLOWS.md"), workflowMemory),
		writeFile(join(memoryRoot, "PROJECTS.md"), "do not inject this index"),
		writeFile(join(memoryRoot, "projects", identity.filename), projectMemory),
	]);
	return {
		memoryRoot,
		identity,
		writeUser: (text) => writeFile(join(memoryRoot, "USER.md"), text),
	};
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("deterministic prompt memory", () => {
	test("injects validated sources in fixed order with explicit precedence", async () => {
		const input = await fixture();
		const result = await buildPromptMemory(input);

		expect(result.text.indexOf('source="USER.md"')).toBeLessThan(
			result.text.indexOf('source="WORKFLOWS.md"'),
		);
		expect(result.text.indexOf('source="WORKFLOWS.md"')).toBeLessThan(
			result.text.indexOf(`source="projects/${identity.filename}"`),
		);
		expect(result.text).toContain(
			"current user instruction, current repository instructions, verified repository and tool evidence, then durable memory",
		);
		expect(result.text).toContain("<durable_memory>");
		expect(result.text).toContain("</durable_memory>");
		expect(result.text).not.toContain("do not inject this index");
		expect(result.warnings).toEqual([]);
	});

	test("rereads changes on every build", async () => {
		const input = await fixture();
		const before = await buildPromptMemory(input);
		await input.writeUser(
			userMemory.replace(
				"- Prefer concise responses.",
				"- Prefer newly written behavior.",
			),
		);

		const after = await buildPromptMemory(input);
		expect(after.text).not.toBe(before.text);
		expect(after.text).toContain("Prefer newly written behavior.");
	});

	test("produces byte-identical output when sources are unchanged", async () => {
		const input = await fixture();
		const first = await buildPromptMemory(input);
		const second = await buildPromptMemory(input);

		expect(second).toEqual(first);
	});

	test("diagnoses missing current project memory without blocking other sources", async () => {
		const input = await fixture();
		await rm(join(input.memoryRoot, "projects", identity.filename));

		const result = await buildPromptMemory(input);
		expect(result.text).toContain("Prefer concise responses.");
		expect(result.text).toContain("Verify the diff.");
		expect(result.text).toContain(`source="projects/${identity.filename}"`);
		expect(result.text).toMatch(/project memory[^\n]*does not exist/i);
		expect(result.warnings.join("\n")).toMatch(/does not exist/i);
	});

	test("injects a project filename with a controlled encoded segment", async () => {
		const input = await fixture();
		const encodedIdentity: RepositoryIdentity = {
			kind: "remote",
			canonicalKey: "remote:github.com/team--blue/service",
			coordinate: "github.com/team--blue/service",
			displayName: "team--blue/service",
			filename: "github.com--~x7465616d2d2d626c7565--service.md",
		};
		await writeFile(
			join(input.memoryRoot, "projects", encodedIdentity.filename),
			projectMemory,
		);

		const result = await buildPromptMemory({
			memoryRoot: input.memoryRoot,
			identity: encodedIdentity,
		});
		expect(result.text).toContain(
			`source="projects/${encodedIdentity.filename}"`,
		);
		expect(result.text).toContain("The service uses Bun.");
	});

	test("omits malformed and unsafe source content without leaking it", async () => {
		const input = await fixture();
		const blockedValue = "API_KEY=blocked-raw-value";
		await Promise.all([
			writeFile(
				join(input.memoryRoot, "USER.md"),
				`${userMemory}\n- ${blockedValue}\n`,
			),
			writeFile(
				join(input.memoryRoot, "WORKFLOWS.md"),
				"# Workflow Memory\n\n## Rules\n\n- Missing conventions.\n",
			),
		]);

		const result = await buildPromptMemory(input);
		expect(result.text).not.toContain(blockedValue);
		expect(result.warnings.join("\n")).not.toContain(blockedValue);
		expect(result.text).toMatch(/USER\.md[^\n]*unsafe/i);
		expect(result.text).toMatch(/WORKFLOWS\.md[^\n]*missing required section/i);
		expect(result.text).toContain("The service uses Bun.");
	});

	test("blocks a final scoped-memory symlink without leaking external content", async () => {
		const input = await fixture();
		const outside = await mkdtemp(join(tmpdir(), "prompt-memory-outside-"));
		roots.push(outside);
		const externalContent = projectMemory.replace(
			"The service uses Bun.",
			"Raw external prompt content must stay absent.",
		);
		const externalPath = join(outside, identity.filename);
		await writeFile(externalPath, externalContent);
		const scopedPath = join(input.memoryRoot, "projects", identity.filename);
		await rm(scopedPath);
		await symlink(externalPath, scopedPath);

		const result = await buildPromptMemory(input);
		expect(result.text).not.toContain(externalContent);
		expect(result.text).not.toContain("Raw external prompt content must stay absent.");
		expect(result.warnings.join("\n")).not.toContain(externalContent);
		expect(result.text).toMatch(/projects\/[^"]+[^\n]*(?:symbolic link|containment)/i);
	});

	test("includes source-specific normal-budget warnings", async () => {
		const input = await fixture();
		await input.writeUser(
			userMemory.replace(
				"- Prefer concise responses.",
				`- ${"x".repeat(4_100)}.`,
			),
		);

		const result = await buildPromptMemory(input);
		expect(result.text).toMatch(/USER\.md[^\n]*normal 4000-character budget/i);
		expect(result.warnings.join("\n")).toMatch(
			/USER\.md[^\n]*normal 4000-character budget/i,
		);
	});

	test("enforces the hard total with explicit source-specific diagnostics", async () => {
		const input = await fixture();
		await Promise.all([
			input.writeUser(
				userMemory.replace("- Prefer concise responses.", `- ${"u".repeat(12_000)}.`),
			),
			writeFile(
				join(input.memoryRoot, "WORKFLOWS.md"),
				workflowMemory.replace("- Verify the diff.", `- ${"w".repeat(12_000)}.`),
			),
			writeFile(
				join(input.memoryRoot, "projects", identity.filename),
				projectMemory.replace("- The service uses Bun.", `- ${"p".repeat(12_000)}.`),
			),
		]);

		const result = await buildPromptMemory(input);
		expect(result.text.length).toBeLessThanOrEqual(HARD_PROMPT_MEMORY_CHARS);
		expect(result.text).toContain("</durable_memory>");
		expect(result.text).toMatch(/WORKFLOWS\.md[^\n]*(?:truncated|omitted)/i);
		expect(result.text).toMatch(
			new RegExp(`projects/${identity.filename}[^\\n]*(?:truncated|omitted)`, "i"),
		);
		expect(result.warnings.join("\n")).toMatch(/hard 20000-character limit/i);
	});

	test("adds one transient strong advisory without persisting it", async () => {
		const input = await fixture();
		const advisoryCandidate: MemoryCandidate = {
			content: "Do not skip the final diff review.",
			reason: "behavioral-correction",
			scope: "workflow",
			autoWrite: false,
		};
		const before = await readFile(join(input.memoryRoot, "WORKFLOWS.md"), "utf8");

		const withAdvisory = await buildPromptMemory({ ...input, advisoryCandidate });
		const withoutAdvisory = await buildPromptMemory(input);
		expect(withAdvisory.text).toContain("Transient strong advisory candidate");
		expect(withAdvisory.text).toContain(advisoryCandidate.content);
		expect(withoutAdvisory.text).not.toContain(advisoryCandidate.content);
		expect(await readFile(join(input.memoryRoot, "WORKFLOWS.md"), "utf8")).toBe(
			before,
		);
	});

	test("rejects unsafe and malformed-tilde project filenames", async () => {
		const input = await fixture();
		for (const filename of [
			"../USER.md",
			"github.com--~xzz--service.md",
			"github.com--team~blue--service.md",
			"github.com--team--~p2222--service.md",
			"github.com--~l--team--service.md",
		]) {
			const result = await buildPromptMemory({
				memoryRoot: input.memoryRoot,
				identity: { ...identity, filename },
			});
			expect(result.text).toContain('source="projects/[invalid-identity].md"');
			expect(result.text).toMatch(/unsafe repository identity/i);
			expect(result.text.match(/Prefer concise responses\./g)).toHaveLength(1);
		}
	});
});

test("appendDurableMemory leaves exactly one durable memory block", () => {
	const old = "<durable_memory>\nold\n</durable_memory>";
	const next = "<durable_memory>\nnew\n</durable_memory>";
	const appended = appendDurableMemory(`base\n\n${old}`, next);

	expect(appended).toBe(`base\n\n${next}`);
	expect(appended.match(/<durable_memory>/g)).toHaveLength(1);
	expect(appended.match(/<\/durable_memory>/g)).toHaveLength(1);
});
