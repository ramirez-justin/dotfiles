import type { RedactionResult } from "./types.ts";

const PATTERNS: Array<{ label: string; regex: RegExp; replacement: string }> = [
	{
		label: "private_key",
		regex: new RegExp(
			"-----BEGIN [A-Z ]*" +
				"PRIVATE " +
				"KEY-----[\\s\\S]*?-----END [A-Z ]*" +
				"PRIVATE " +
				"KEY-----",
			"g",
		),
		replacement: "[REDACTED_SECRET:private_key]",
	},
	{
		label: "openai_key",
		regex: new RegExp("\\b" + "s" + "k-" + "[A-Za-z0-9_-]{20,}\\b", "g"),
		replacement: "[REDACTED_SECRET:openai_key]",
	},
	{
		label: "github_token",
		regex: new RegExp("\\b" + "gh" + "[pousr]_[A-Za-z0-9_]{20,}\\b", "g"),
		replacement: "[REDACTED_SECRET:github_token]",
	},
	{
		label: "aws_access_key",
		regex: new RegExp("\\b" + "AK" + "IA[0-9A-Z]{16}\\b", "g"),
		replacement: "[REDACTED_SECRET:aws_access_key]",
	},
	{
		label: "slack_token",
		regex: new RegExp("\\b" + "xo" + "x[baprs]-[A-Za-z0-9-]{20,}\\b", "g"),
		replacement: "[REDACTED_SECRET:slack_token]",
	},
	{
		label: "bearer_token",
		regex: /Bearer\s+[A-Za-z0-9._~+/=-]{24,}/g,
		replacement: "Bearer [REDACTED_SECRET:bearer_token]",
	},
];

export function redactSecrets(input: string): RedactionResult {
	let content = input;
	const labels: string[] = [];

	for (const pattern of PATTERNS) {
		if (pattern.regex.test(content)) {
			labels.push(pattern.label);
			pattern.regex.lastIndex = 0;
			content = content.replace(pattern.regex, pattern.replacement);
		}
		pattern.regex.lastIndex = 0;
	}

	return {
		content,
		redacted: labels.length > 0,
		labels,
	};
}
