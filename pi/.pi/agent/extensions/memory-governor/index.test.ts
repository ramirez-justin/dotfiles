import { describe, expect, test } from "bun:test";
import {
	applyMemoryUpdate,
	auditMemoryText,
	buildMemoryUpdateNotice,
	classifyMemoryTarget,
	detectMemoryCandidate,
	shouldAutoWriteMemoryCandidate,
	shouldRejectMemory,
} from "./index.ts";

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

	test("does not capture task descriptions as memory", () => {
		const candidate = detectMemoryCandidate(
			"The current branch has several changes. When staging runs jobs/example.py, it needs a token from another service before connecting to an internal service location.",
		);

		expect(candidate).toBeUndefined();
	});

	test("does not auto-write advisory questions as raw memory", () => {
		const candidate = detectMemoryCandidate(
			"Should this one-off regression become a broader rule? I want file-backed memory for this project, not a database.",
		);

		expect(candidate).toBeUndefined();
	});

	test("does not capture deictic task instructions as durable memory", () => {
		const candidate = detectMemoryCandidate(
			"Do not commit that plan. We are going to throw it away when done.",
		);

		expect(candidate).toBeUndefined();
	});

	test("captures explicit durable rules without copying task prompts", () => {
		const candidate = detectMemoryCandidate(
			"Remember: For gametime Pi memory, use markdown files instead of a database.",
		);

		expect(candidate?.target).toBe("PROJECTS.md");
		expect(candidate?.content).toBe(
			"For gametime Pi memory, use markdown files instead of a database.",
		);
	});

	test("does not turn first-person uncertainty into imperative memory", () => {
		expect(detectMemoryCandidate("I do not know why.")).toBeUndefined();
		expect(
			detectMemoryCandidate("I don't think the data is correct."),
		).toBeUndefined();
		expect(
			detectMemoryCandidate(
				"I do not understand the customer discovery extension.",
			),
		).toBeUndefined();
	});

	test("does not store raw questions as durable memory", () => {
		expect(
			detectMemoryCandidate(
				"Do we have examples in this project of macros used for incremental models?",
			),
		).toBeUndefined();
		expect(
			detectMemoryCandidate(
				"For the question you asked I think we should use a global sample.",
			),
		).toBeUndefined();
	});
});

describe("memory-governor candidate gate", () => {
	test("auto-writes only explicit remember commands", () => {
		const explicit = detectMemoryCandidate(
			"Remember: Prefer concise responses unless the task requires detail.",
		);
		const correction = detectMemoryCandidate(
			"It seems like you don't know when to update memory.",
		);

		if (!explicit) throw new Error("expected explicit memory candidate");
		if (!correction) throw new Error("expected correction memory candidate");
		expect(shouldAutoWriteMemoryCandidate(explicit)).toBe(true);
		expect(shouldAutoWriteMemoryCandidate(correction)).toBe(false);
	});

	test("does not auto-write inferred workflow rules", () => {
		const candidate = detectMemoryCandidate(
			"For PR reviews, use line-specific comments.",
		);

		if (!candidate) throw new Error("expected workflow memory candidate");
		expect(candidate.reason).toBe("workflow rule");
		expect(shouldAutoWriteMemoryCandidate(candidate)).toBe(false);
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
