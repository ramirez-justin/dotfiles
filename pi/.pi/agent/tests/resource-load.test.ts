import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Parse only explicit repository resources with the installed native loader.
// This does not test Stow, package installation, or a complete live session.
const AGENT_ROOT = join(import.meta.dir, "..");
const SKILLS = join(AGENT_ROOT, "skills");
const PROMPTS = join(AGENT_ROOT, "prompts");
const piBin = Bun.which("pi");
if (!piBin) throw new Error("pi is not on PATH; install it with mise");
const PI_ENTRY = realpathSync(
	Bun.resolveSync("@earendil-works/pi-coding-agent", dirname(realpathSync(piBin))),
);

type Sdk = typeof import("@earendil-works/pi-coding-agent");
type Pair = [string, string];
let sdk: Sdk;
const root = mkdtempSync(join(tmpdir(), "resource-load-"));
const byName = (a: Pair, b: Pair) => a[0].localeCompare(b[0]);
const expectedSkills = readdirSync(SKILLS)
	.filter((name) => existsSync(join(SKILLS, name, "SKILL.md")))
	.map((name): Pair => [name, join(SKILLS, name, "SKILL.md")])
	.sort(byName);
const expectedPrompts = readdirSync(PROMPTS)
	.filter((name) => name.endsWith(".md"))
	.map((name): Pair => [name.slice(0, -3), join(PROMPTS, name)])
	.sort(byName);

beforeAll(async () => {
	sdk = await import(PI_ENTRY);
});
afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

function write(path: string, text: string): string {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
	return path;
}

async function load(skillPaths: string[], promptPaths: string[] = []) {
	const loader = new sdk.DefaultResourceLoader({
		cwd: root,
		agentDir: root,
		settingsManager: sdk.SettingsManager.inMemory(),
		additionalSkillPaths: skillPaths,
		additionalPromptTemplatePaths: promptPaths,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	return { skills: loader.getSkills(), prompts: loader.getPrompts() };
}

describe("Pi resource parsing", () => {
	test("loads repository skills and prompts from expected paths", async () => {
		const { skills, prompts } = await load([SKILLS], [PROMPTS]);
		expect(skills.diagnostics).toEqual([]);
		expect(prompts.diagnostics).toEqual([]);
		expect(
			skills.skills.map((s): Pair => [s.name, s.filePath]).sort(byName),
		).toEqual(expectedSkills);
		expect(
			prompts.prompts.map((p): Pair => [p.name, p.filePath]).sort(byName),
		).toEqual(expectedPrompts);
	});

	test("reports a skill collision on the losing path", async () => {
		const first = write(
			join(root, "a/dup-probe/SKILL.md"),
			"---\nname: dup-probe\ndescription: First.\n---\n",
		);
		const second = write(
			join(root, "b/dup-probe/SKILL.md"),
			"---\nname: dup-probe\ndescription: Second.\n---\n",
		);
		const { skills } = await load([dirname(first), dirname(second)]);
		expect(skills.skills.map((s) => s.filePath)).toEqual([first]);
		expect(skills.diagnostics).toEqual([
			{
				type: "collision",
				message: 'name "dup-probe" collision',
				path: second,
				collision: {
					resourceType: "skill",
					name: "dup-probe",
					winnerPath: first,
					loserPath: second,
				},
			},
		]);
	});

	test("rejects a skill without a description", async () => {
		const file = write(
			join(root, "no-description/SKILL.md"),
			"---\nname: no-description\n---\n",
		);
		const { skills } = await load([dirname(file)]);
		expect(skills.skills).toEqual([]);
		expect(skills.diagnostics).toEqual([
			{ type: "warning", message: "description is required", path: file },
		]);
	});

	test("reports a prompt collision on the losing path", async () => {
		const first = write(
			join(root, "prompts-a/same.md"),
			"---\ndescription: First.\n---\nA\n",
		);
		const second = write(
			join(root, "prompts-b/same.md"),
			"---\ndescription: Second.\n---\nB\n",
		);
		const { prompts } = await load([], [dirname(first), dirname(second)]);
		expect(prompts.prompts.map((p) => p.filePath)).toEqual([first]);
		expect(prompts.diagnostics).toEqual([
			{
				type: "collision",
				message: 'name "/same" collision',
				path: second,
				collision: {
					resourceType: "prompt",
					name: "same",
					winnerPath: first,
					loserPath: second,
				},
			},
		]);
	});

	test("catalogs metadata, not bodies or hidden skills", async () => {
		const shown = write(
			join(root, "catalog-probe/SKILL.md"),
			"---\nname: catalog-probe\ndescription: Catalog fixture.\n---\n" +
				"BODY_SENTINEL_7d41\n",
		);
		const hidden = write(
			join(root, "hidden-probe/SKILL.md"),
			"---\nname: hidden-probe\ndescription: Hidden fixture.\n" +
				"disable-model-invocation: true\n---\n",
		);
		const { skills } = await load([dirname(shown), dirname(hidden)]);
		expect(skills.diagnostics).toEqual([]);
		const catalog = sdk.formatSkillsForPrompt(skills.skills);
		expect(catalog).toContain("<name>catalog-probe</name>");
		expect(catalog).toContain(`<location>${shown}</location>`);
		expect(catalog).not.toContain("BODY_SENTINEL_7d41");
		expect(catalog).not.toContain("hidden-probe");
	});
});
