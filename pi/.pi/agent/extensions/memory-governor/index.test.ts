import { describe, expect, test } from "bun:test";
import {
	applyMemoryUpdate,
	auditMemoryText,
	buildMemoryUpdateNotice,
	classifyMemoryTarget,
	detectMemoryCandidate,
	shouldRejectMemory,
} from "./index";

const baseUserMemory = `# User Memory

## Rules

- Do not store secrets.

## Preferences

- Prefer concise responses unless the task requires detail.
`;

const baseWorkflowMemory = `# Workflow Memory

## Rules

- Do not store secrets.

## Conventions

- Use /finish before claiming work is complete.
`;

describe("memory-governor detection", () => {
	test("detects behavioral corrections without requiring remember wording", () => {
		const candidate = detectMemoryCandidate(
			"It seems like you don't know when to update memory.",
		);

		expect(candidate?.reason).toContain("behavioral correction");
		expect(candidate?.content).toContain("when to update memory");
	});

	test("classifies workflow rules separately from user preferences", () => {
		expect(
			classifyMemoryTarget("For PR reviews, use line-specific comments."),
		).toBe("WORKFLOWS.md");
		expect(classifyMemoryTarget("Prefer direct implementation.")).toBe(
			"USER.md",
		);
		expect(classifyMemoryTarget("In this repo, run mise run link.")).toBe(
			"PROJECTS.md",
		);
	});

	test("does not capture branch-specific task prompts as memory", () => {
		const candidate = detectMemoryCandidate(
			"The current branch has a bunch of changes and it seems like Joseph is struggling a bit. Basically when staging airflow is being used to run the jobs/logitix-event-catalog-redis.py job, it needs to get a token from the proxy service in order to connect to the .svc. redis location.",
		);

		expect(candidate).toBeUndefined();
	});
});

describe("memory-governor safety", () => {
	test("rejects secrets, transient notes, duplicates, and unverified guesses", () => {
		expect(shouldRejectMemory("API_KEY=abcdef1234567890", baseUserMemory)).toBe(
			"secret-like content",
		);
		expect(
			shouldRejectMemory(
				"For this session only, use verbose output.",
				baseUserMemory,
			),
		).toBe("transient content");
		expect(shouldRejectMemory("Prefer concise responses", baseUserMemory)).toBe(
			"already represented",
		);
		expect(
			shouldRejectMemory(
				"I guess Justin might prefer GraphQL.",
				baseUserMemory,
			),
		).toBe("unverified assumption");
	});

	test("audit removes duplicate bullets before appending", () => {
		const audited = auditMemoryText(`${baseWorkflowMemory}
- Use /finish before claiming work is complete.
`);

		expect(audited.removedDuplicates).toBe(1);
		expect(
			audited.text.match(/Use \/finish before claiming work is complete\./g),
		)?.toHaveLength(1);
	});
});

describe("memory-governor notifications", () => {
	test("memory updates notify the UI without injecting next-turn model context", () => {
		const notice = buildMemoryUpdateNotice({
			changed: true,
			reason: "behavioral correction",
			summary: "added memory",
			target: "USER.md",
			text: baseUserMemory,
		});

		expect(notice.uiText).toContain("Memory updated: USER.md");
		expect(notice.modelMessage).toBeUndefined();
	});
});

describe("memory-governor writes", () => {
	test("updates an existing scoped section instead of adding new scaffolding", () => {
		const result = applyMemoryUpdate({
			existingText: baseUserMemory,
			target: "USER.md",
			content:
				"Prefer choosing the desired end-state and building it directly.",
			reason: "behavioral correction",
		});

		expect(result.changed).toBe(true);
		expect(result.summary).toContain("added memory");
		expect(result.text).toContain("## Preferences");
		expect(result.text).toContain(
			"- Prefer choosing the desired end-state and building it directly.",
		);
	});

	test("does not append already represented memory", () => {
		const result = applyMemoryUpdate({
			existingText: baseUserMemory,
			target: "USER.md",
			content: "Prefer concise responses unless the task requires detail.",
			reason: "duplicate correction",
		});

		expect(result.changed).toBe(false);
		expect(result.summary).toContain("already represented");
	});
});
