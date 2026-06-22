// @ts-nocheck
import { describe, expect, test } from "bun:test";
import {
	buildClaudePlanPrompt,
	extractLatestAssistantText,
	makeClaudeSettings,
} from "./index";

describe("claude-code-planner prompt", () => {
	test("asks Claude Code for planning only and includes the user request", () => {
		const prompt = buildClaudePlanPrompt("Add a notification bridge");

		expect(prompt).toContain("planning agent");
		expect(prompt).toContain("Do not modify repository files");
		expect(prompt).toContain("Add a notification bridge");
	});
});

describe("claude-code-planner settings", () => {
	test("configures a Stop hook that writes a sentinel through the hook script", () => {
		const settings = makeClaudeSettings({
			hookScriptPath: "/tmp/hook.mjs",
			sentinelPath: "/tmp/sentinel.json",
		});

		expect(settings.hooks.Stop[0].matcher).toBe("*");
		expect(settings.hooks.Stop[0].hooks[0].command).toContain("/tmp/hook.mjs");
		expect(settings.hooks.Stop[0].hooks[0].command).toContain(
			"/tmp/sentinel.json",
		);
	});
});

describe("claude-code-planner transcript extraction", () => {
	test("extracts the latest assistant text from Claude Code JSONL transcript", () => {
		const transcript = [
			JSON.stringify({
				type: "assistant",
				message: { content: [{ type: "text", text: "first answer" }] },
			}),
			JSON.stringify({ type: "user", message: { content: "thanks" } }),
			JSON.stringify({
				type: "assistant",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "final " },
						{ type: "text", text: "plan" },
					],
				},
			}),
		].join("\n");

		expect(extractLatestAssistantText(transcript)).toBe("final \n\nplan");
	});

	test("falls back to top-level text fields", () => {
		const transcript = JSON.stringify({
			role: "assistant",
			text: "plain plan",
		});

		expect(extractLatestAssistantText(transcript)).toBe("plain plan");
	});
});
