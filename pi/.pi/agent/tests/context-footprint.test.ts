import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { collectFootprint, measure } from "../bin/context-footprint.ts";

// Fixture expectations come from literal arithmetic, not the script helpers.
const SCRIPT = join(import.meta.dir, "../bin/context-footprint.ts");
const REPO = join(import.meta.dir, "../../../..");
const AGENT = "pi/.pi/agent";
const PROJECT = "projects/github.com--ramirez-justin--dotfiles.md";
const AGENTS_TEXT = "Aé中😀\n"; // 11 bytes, 5 code points.
const MEMORY_RENDER = 438; // Opening/closing wrapper plus three sources.
const CATALOG_BASE = 467; // Native catalog text for one skill "a", "D".
// Unresolved tag: YAML emits a process warning containing the source.
const WARNING_TAG = "description: !unknown FAKE_WARNING_SENTINEL";
const temp = realpathSync(mkdtempSync(join(tmpdir(), "context-footprint-")));
let count = 0;
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function put(root: string, path: string, data: string | Uint8Array) {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), data);
}

function fixture(): string {
	const root = join(temp, `r${count++}`);
	put(root, `${AGENT}/AGENTS.md`, AGENTS_TEXT);
	mkdirSync(join(root, AGENT, "skills"), { recursive: true });
	mkdirSync(join(root, AGENT, "prompts"), { recursive: true });
	put(root, `${AGENT}/memory/USER.md`, "## Rules\n## Preferences\n");
	put(root, `${AGENT}/memory/WORKFLOWS.md`, "## Rules\n## Conventions\n");
	put(root, `${AGENT}/memory/${PROJECT}`, "## Rules\n## Facts\n");
	return root;
}

function skill(root: string, dir: string, frontmatter: string, body = "") {
	put(
		root,
		`${AGENT}/skills/${dir}/SKILL.md`,
		`---\n${frontmatter}\n---\n${body}`,
	);
}

function snapshot(root: string): string {
	const walk = (dir: string): string[] =>
		readdirSync(dir, { withFileTypes: true })
			.sort((a, b) => (a.name < b.name ? -1 : 1))
			.flatMap((e) => {
				const path = join(dir, e.name);
				if (e.isDirectory())
					return [`d ${relative(root, path)}`, ...walk(path)];
				const data = e.isFile() ? readFileSync(path).toString("hex") : "";
				return [`f ${relative(root, path)} ${data}`];
			});
	return walk(root).join("\n");
}

const c = (utf8Bytes: number, unicodeCodePoints: number) => ({
	utf8Bytes,
	unicodeCodePoints,
});
const sym = (n: number) => c(n, n);

async function errorCode(root: string) {
	const report = await collectFootprint(root);
	expect(report.status).toBe("error");
	expect(report.selectedRepositoryPayloadTotal).toBeNull();
	expect(report.lazyBodyInventoryTotal).toBeNull();
	expect(report.resources).toBeNull();
	expect(report.memoryWarningCount).toBeNull();
	expect(report.components).toEqual({});
	expect(report.lazyBodies).toEqual([]);
	expect(report.issues).toHaveLength(1);
	return report.issues[0];
}

describe("measure", () => {
	test("counts UTF-8 bytes and code points, not UTF-16 units", () => {
		expect(AGENTS_TEXT.length).toBe(6);
		expect(measure(AGENTS_TEXT)).toEqual(c(11, 5));
	});
});

describe("collectFootprint", () => {
	test("measures an empty catalog with known valid memory", async () => {
		const report = await collectFootprint(fixture());
		expect(report).toEqual({
			scope: "repository-payload-inventory",
			context: "github.com/ramirez-justin/dotfiles",
			status: "ok",
			components: {
				"agent-instructions-source": c(11, 5),
				"native-skill-catalog": c(0, 0),
				"durable-memory-rendering": sym(MEMORY_RENDER),
			},
			lazyBodies: [],
			resources: {
				skills: 0,
				catalogedSkills: 0,
				disabledSkills: 0,
				promptTemplates: 0,
			},
			memoryWarningCount: 0,
			selectedRepositoryPayloadTotal: c(449, 443),
			lazyBodyInventoryTotal: c(0, 0),
			issues: [],
			exclusions: expect.any(Array),
		});
		expect(report.exclusions.length).toBeGreaterThan(0);
	});

	test("accepts a symlinked fixture root after canonicalization", async () => {
		const root = fixture();
		const link = join(temp, `link${count++}`);
		symlinkSync(root, link);
		expect((await collectFootprint(link)).status).toBe("ok");
	});

	test("native catalog grows with the absolute location and description", async () => {
		const root = fixture();
		skill(root, "a", "name: a\ndescription: D");
		const location = join(root, AGENT, "skills/a/SKILL.md");
		const first = await collectFootprint(root);
		expect(first.status).toBe("ok");
		expect(first.components["native-skill-catalog"]).toEqual(
			sym(CATALOG_BASE + location.length),
		);
		expect(first.resources?.catalogedSkills).toBe(1);

		skill(root, "a", "name: a\ndescription: Dé");
		const second = await collectFootprint(root);
		expect(second.components["native-skill-catalog"]).toEqual(
			c(CATALOG_BASE + location.length + 2, CATALOG_BASE + location.length + 1),
		);
		expect(second.selectedRepositoryPayloadTotal).toEqual(
			c(
				first.selectedRepositoryPayloadTotal!.utf8Bytes + 2,
				first.selectedRepositoryPayloadTotal!.unicodeCodePoints + 1,
			),
		);
		expect(second.lazyBodyInventoryTotal).toEqual(first.lazyBodyInventoryTotal);
	});

	test("lazy bodies stay separate from the selected total", async () => {
		const root = fixture();
		skill(root, "a", "name: a\ndescription: D", "\n😀\n");
		put(root, `${AGENT}/prompts/t.md`, "---\ndescription: T\n---\né\n");
		const first = await collectFootprint(root);
		expect(first.lazyBodies).toEqual([
			{ kind: "skill-body", path: `${AGENT}/skills/a/SKILL.md`, ...c(4, 1) },
			{
				kind: "prompt-template-body",
				path: `${AGENT}/prompts/t.md`,
				...c(2, 1),
			},
		]);
		expect(first.lazyBodyInventoryTotal).toEqual(c(6, 2));
		expect(first.resources?.promptTemplates).toBe(1);

		skill(root, "a", "name: a\ndescription: D", "😀😀");
		put(root, `${AGENT}/prompts/t.md`, "---\ndescription: Tée\n---\néé");
		const second = await collectFootprint(root);
		expect(second.lazyBodyInventoryTotal).toEqual(c(12, 4));
		expect(second.selectedRepositoryPayloadTotal).toEqual(
			first.selectedRepositoryPayloadTotal,
		);

		skill(root, "a", "name: a\ndescription: Dé", "😀😀");
		const third = await collectFootprint(root);
		expect(third.lazyBodyInventoryTotal).toEqual(second.lazyBodyInventoryTotal);
	});

	test("keeps BOM and line endings in AGENTS but uses native body parsing", async () => {
		const root = fixture();
		put(root, `${AGENT}/AGENTS.md`, "\uFEFFa\r\nb\r");
		put(
			root,
			`${AGENT}/prompts/t.md`,
			"\uFEFF---\r\ndescription: T\r\n---\r\nx\r\ny\r\n",
		);
		const report = await collectFootprint(root);
		expect(report.components["agent-instructions-source"]).toEqual(c(8, 6));
		expect(report.lazyBodies[0]).toMatchObject(sym(3));
	});

	test("disabled invocation keeps the body but leaves the catalog", async () => {
		const root = fixture();
		skill(
			root,
			"a",
			"name: a\ndescription: D\ndisable-model-invocation: true",
			"xy",
		);
		const report = await collectFootprint(root);
		expect(report.components["native-skill-catalog"]).toEqual(c(0, 0));
		expect(report.lazyBodyInventoryTotal).toEqual(sym(2));
		expect(report.resources).toEqual({
			skills: 1,
			catalogedSkills: 0,
			disabledSkills: 1,
			promptTemplates: 0,
		});
	});

	test("memory changes only the rendered component; others are excluded", async () => {
		const root = fixture();
		const base = await collectFootprint(root);
		put(root, `${AGENT}/memory/PROJECTS.md`, "index changes ignored");
		put(root, `${AGENT}/memory/projects/other.md`, "other project ignored");
		expect(await collectFootprint(root)).toEqual(base);

		for (const path of ["USER.md", "WORKFLOWS.md", PROJECT]) {
			const file = join(root, AGENT, "memory", path);
			const original = readFileSync(file);
			writeFileSync(file, `${original}é\n`);
			const changed = await collectFootprint(root);
			expect(changed.components["durable-memory-rendering"]).toEqual(
				c(MEMORY_RENDER + 3, MEMORY_RENDER + 2),
			);
			expect(changed.components["agent-instructions-source"]).toEqual(c(11, 5));
			expect(changed.components["native-skill-catalog"]).toEqual(c(0, 0));
			writeFileSync(file, original);
		}
	});

	test("memory budget warnings are counted, not errors", async () => {
		const root = fixture();
		put(
			root,
			`${AGENT}/memory/USER.md`,
			`## Rules\n## Preferences\n${"x".repeat(4000)}`,
		);
		const report = await collectFootprint(root);
		expect(report.status).toBe("warning");
		expect(report.memoryWarningCount).toBe(1);
		expect(report.issues).toEqual([
			{ code: "MEMORY_RENDER_WARNING", count: 1 },
		]);
		expect(report.selectedRepositoryPayloadTotal).not.toBeNull();
	});

	test("invalid or missing memory yields an error with null totals", async () => {
		const cases: [string, string | Uint8Array | null, string][] = [
			["USER.md", null, "READ_FAILURE"],
			["WORKFLOWS.md", "## Rules\n", "INVALID_MEMORY"],
			[PROJECT, "## Rules\n## Facts\n</durable_memory>\n", "INVALID_MEMORY"],
			["USER.md", new Uint8Array([0x23, 0xff, 0x0a]), "INVALID_MEMORY"],
		];
		for (const [path, data, code] of cases) {
			const root = fixture();
			const file = join(root, AGENT, "memory", path);
			if (data === null) rmSync(file);
			else writeFileSync(file, data);
			expect(await errorCode(root)).toEqual({
				code,
				path: `${AGENT}/memory/${path}`,
			});
		}
	});

	test("rejects covered symlinks, missing or nonregular files and bad layouts", async () => {
		const outside = join(temp, `outside${count++}`);
		mkdirSync(join(outside, "a"), { recursive: true });
		writeFileSync(join(outside, "AGENTS.md"), "x");
		writeFileSync(
			join(outside, "a/SKILL.md"),
			"---\nname: a\ndescription: D\n---\n",
		);
		const cases: [(root: string) => void, object][] = [
			[
				(r) => rmSync(join(r, AGENT, "AGENTS.md")),
				{ code: "READ_FAILURE", path: `${AGENT}/AGENTS.md` },
			],
			[
				(r) => {
					rmSync(join(r, AGENT, "AGENTS.md"));
					symlinkSync(join(outside, "AGENTS.md"), join(r, AGENT, "AGENTS.md"));
				},
				{ code: "PATH_BOUNDARY", path: `${AGENT}/AGENTS.md` },
			],
			[
				(r) => {
					rmSync(join(r, AGENT, "AGENTS.md"));
					mkdirSync(join(r, AGENT, "AGENTS.md"));
				},
				{ code: "INVALID_RESOURCE", path: `${AGENT}/AGENTS.md` },
			],
			[
				(r) =>
					writeFileSync(join(r, AGENT, "AGENTS.md"), new Uint8Array([0xc3])),
				{ code: "INVALID_UTF8", path: `${AGENT}/AGENTS.md` },
			],
			[
				(r) => {
					rmSync(join(r, AGENT, "skills"), { recursive: true });
					symlinkSync(outside, join(r, AGENT, "skills"));
				},
				{ code: "PATH_BOUNDARY", path: `${AGENT}/skills` },
			],
			[
				(r) => symlinkSync(join(outside, "a"), join(r, AGENT, "skills/a")),
				{ code: "PATH_BOUNDARY", path: `${AGENT}/skills/a` },
			],
			[
				(r) => {
					mkdirSync(join(r, AGENT, "skills/a"));
					symlinkSync(
						join(outside, "a/SKILL.md"),
						join(r, AGENT, "skills/a/SKILL.md"),
					);
				},
				{ code: "PATH_BOUNDARY", path: `${AGENT}/skills/a/SKILL.md` },
			],
			[
				(r) => mkdirSync(join(r, AGENT, "skills/a")),
				{ code: "READ_FAILURE", path: `${AGENT}/skills/a/SKILL.md` },
			],
			[
				(r) =>
					put(r, `${AGENT}/skills/a.md`, "---\nname: a\ndescription: D\n---\n"),
				{ code: "INVALID_RESOURCE", path: `${AGENT}/skills/a.md` },
			],
			[
				(r) => {
					skill(r, "a", "name: same\ndescription: D");
					skill(r, "b", "name: same\ndescription: D");
				},
				{ code: "CATALOG_DIAGNOSTIC", path: `${AGENT}/skills`, count: 1 },
			],
			[
				(r) => put(r, `${AGENT}/prompts/t.md`, new Uint8Array([0xff])),
				{ code: "INVALID_UTF8", path: `${AGENT}/prompts/t.md` },
			],
			[
				(r) => rmSync(join(r, AGENT, "prompts"), { recursive: true }),
				{ code: "READ_FAILURE", path: `${AGENT}/prompts` },
			],
			[
				(r) => {
					rmSync(join(r, AGENT, "memory/USER.md"));
					symlinkSync(
						join(r, AGENT, "memory/WORKFLOWS.md"),
						join(r, AGENT, "memory/USER.md"),
					);
				},
				{ code: "PATH_BOUNDARY", path: `${AGENT}/memory/USER.md` },
			],
		];
		for (const [mutate, issue] of cases) {
			const root = fixture();
			mutate(root);
			expect(await errorCode(root)).toEqual(issue);
		}
	});

	test("never serializes content, descriptions or native diagnostics", async () => {
		const s = (n: number) => `FAKE_SENTINEL_${n}_Z`;
		const valid = fixture();
		put(valid, `${AGENT}/AGENTS.md`, s(1));
		skill(valid, "a", `name: a\ndescription: ${s(2)}`, s(3));
		put(
			valid,
			`${AGENT}/prompts/t.md`,
			`---\ndescription: ${s(4)}\n---\n${s(5)}`,
		);
		put(
			valid,
			`${AGENT}/memory/USER.md`,
			`## Rules\n## Preferences\n${s(6)}\n`,
		);
		const malformedSkill = fixture();
		skill(malformedSkill, "a", `name: a\ndescription: [${s(7)}`);
		const malformedPrompt = fixture();
		put(
			malformedPrompt,
			`${AGENT}/prompts/t.md`,
			`---\ndescription: [${s(8)}\n---\nx`,
		);
		const badMemory = fixture();
		put(badMemory, `${AGENT}/memory/USER.md`, `${s(9)} password: x\n`);

		const reports = await Promise.all(
			[valid, malformedSkill, malformedPrompt, badMemory].map(collectFootprint),
		);
		expect(reports.map((r) => r.status)).toEqual([
			"ok",
			"error",
			"error",
			"error",
		]);
		expect(reports[1].issues[0].code).toBe("CATALOG_DIAGNOSTIC");
		expect(reports[2].issues[0]).toEqual({
			code: "INVALID_RESOURCE",
			path: `${AGENT}/prompts/t.md`,
		});
		expect(reports[3].issues[0].code).toBe("INVALID_MEMORY");
		const json = JSON.stringify(reports);
		expect(json).not.toContain("FAKE_SENTINEL");
		expect(json).not.toContain(temp);
	});

	test("native YAML warnings fail closed and restore emitWarning", async () => {
		const valid = fixture();
		skill(valid, "a", "name: a\ndescription: D", "x");
		const skillWarning = fixture();
		skill(skillWarning, "a", `name: a\n${WARNING_TAG}`);
		const promptWarning = fixture();
		put(promptWarning, `${AGENT}/prompts/t.md`, `---\n${WARNING_TAG}\n---\nx`);
		const promptThrow = fixture();
		put(promptThrow, `${AGENT}/prompts/t.md`, "---\ndescription: [\n---\nx");

		const original = process.emitWarning;
		let calls = 0;
		const spy = (() => {
			calls++;
		}) as typeof process.emitWarning;
		const reports = [];
		const restored = [];
		process.emitWarning = spy;
		try {
			for (const root of [valid, skillWarning, promptWarning, promptThrow]) {
				reports.push(await collectFootprint(root));
				restored.push(process.emitWarning === spy);
			}
		} finally {
			process.emitWarning = original;
		}
		expect(calls).toBe(0);
		expect(restored).toEqual([true, true, true, true]);
		expect(reports.map((r) => r.status)).toEqual([
			"ok",
			"error",
			"error",
			"error",
		]);
		expect(reports.slice(1).map((r) => r.issues)).toEqual([
			[{ code: "INVALID_RESOURCE", path: `${AGENT}/skills` }],
			[{ code: "INVALID_RESOURCE", path: `${AGENT}/prompts/t.md` }],
			[{ code: "INVALID_RESOURCE", path: `${AGENT}/prompts/t.md` }],
		]);
		for (const report of reports.slice(1)) {
			expect(report.selectedRepositoryPayloadTotal).toBeNull();
			expect(report.lazyBodyInventoryTotal).toBeNull();
		}
		expect(JSON.stringify(reports)).not.toContain("FAKE_WARNING");
	});

	test("is repeatable, read-only and does not fetch", async () => {
		const root = fixture();
		skill(root, "a", "name: a\ndescription: D", "body");
		put(root, `${AGENT}/prompts/t.md`, "---\ndescription: T\n---\nx");
		const before = snapshot(root);
		const original = globalThis.fetch;
		let fetches = 0;
		globalThis.fetch = (() => {
			fetches++;
			throw new Error("unexpected fetch");
		}) as unknown as typeof fetch;
		try {
			const first = JSON.stringify(await collectFootprint(root), null, 2);
			const second = JSON.stringify(await collectFootprint(root), null, 2);
			expect(second).toBe(first);
		} finally {
			globalThis.fetch = original;
		}
		expect(fetches).toBe(0);
		expect(snapshot(root)).toBe(before);
	});
});

describe("run and CLI", () => {
	const bun = process.execPath;
	const noPi = { ...process.env, PATH: dirname(bun) };

	function spawn(args: string[], cwd = REPO, env = process.env) {
		const result = Bun.spawnSync([bun, ...args], { cwd, env });
		return {
			code: result.exitCode,
			stdout: result.stdout.toString(),
			stderr: result.stderr.toString(),
		};
	}

	const runIn = (root: string) =>
		spawn([
			"-e",
			`import { run } from ${JSON.stringify(SCRIPT)};` +
				`process.exitCode = await run(${JSON.stringify(root)});`,
		]);

	test("run prints only JSON with exit status", () => {
		const ok = fixture();
		const warning = fixture();
		put(
			warning,
			`${AGENT}/memory/USER.md`,
			`## Rules\n## Preferences\n${"x".repeat(4000)}`,
		);
		const bad = fixture();
		rmSync(join(bad, AGENT, "AGENTS.md"));
		for (const [root, code, status] of [
			[ok, 0, "ok"],
			[warning, 0, "warning"],
			[bad, 1, "error"],
		] as const) {
			const result = runIn(root);
			expect(result.stderr).toBe("");
			expect(result.code).toBe(code);
			const report = JSON.parse(result.stdout);
			expect(report.status).toBe(status);
			const measured = status !== "error";
			expect(report.selectedRepositoryPayloadTotal !== null).toBe(measured);
			expect(report.lazyBodyInventoryTotal !== null).toBe(measured);
		}
	});

	test("native YAML warnings never reach stderr", () => {
		const cases: [(root: string) => void, string][] = [
			[(r) => skill(r, "a", `name: a\n${WARNING_TAG}`), `${AGENT}/skills`],
			[
				(r) => put(r, `${AGENT}/prompts/t.md`, `---\n${WARNING_TAG}\n---\nx`),
				`${AGENT}/prompts/t.md`,
			],
		];
		for (const [write, path] of cases) {
			const root = fixture();
			write(root);
			const result = runIn(root);
			expect(result.stderr).toBe("");
			expect(result.code).toBe(1);
			const report = JSON.parse(result.stdout);
			expect(report.status).toBe("error");
			expect(report.issues).toEqual([{ code: "INVALID_RESOURCE", path }]);
			expect(report.selectedRepositoryPayloadTotal).toBeNull();
			expect(report.lazyBodyInventoryTotal).toBeNull();
			expect(result.stdout).not.toContain("FAKE_WARNING");
			expect(result.stdout).not.toContain(temp);
		}
	});

	test("help and argument rejection work without Pi", () => {
		const help = spawn([SCRIPT, "--help"], temp, noPi);
		expect(help.code).toBe(0);
		expect(help.stderr).toBe("");
		expect(help.stdout).toContain("Usage:");
		expect(help.stdout).toContain("not tokens");

		for (const args of [["--root", temp], ["--help", "x"], [temp]]) {
			const rejected = spawn([SCRIPT, ...args], temp, noPi);
			expect(rejected.code).toBe(1);
			expect(rejected.stderr).toBe("");
			const report = JSON.parse(rejected.stdout);
			expect(report.status).toBe("error");
			expect(report.issues).toEqual([{ code: "INVALID_ARGUMENT" }]);
			expect(rejected.stdout).not.toContain(temp);
		}
	});

	test("measures the script-owning repository regardless of CWD", () => {
		const fromRepo = spawn([SCRIPT]);
		const fromTemp = spawn([SCRIPT], temp);
		expect([fromRepo.code, fromTemp.code]).toEqual([0, 0]);
		expect(fromRepo.stderr + fromTemp.stderr).toBe("");
		// Native budget warnings are permitted; errors must not compare equal.
		const report = JSON.parse(fromRepo.stdout);
		expect(["ok", "warning"]).toContain(report.status);
		expect(report.selectedRepositoryPayloadTotal).not.toBeNull();
		expect(report.resources).not.toBeNull();
		expect(fromTemp.stdout).toBe(fromRepo.stdout);
		expect(JSON.parse(fromTemp.stdout).context).toBe(
			"github.com/ramirez-justin/dotfiles",
		);
	});
});
