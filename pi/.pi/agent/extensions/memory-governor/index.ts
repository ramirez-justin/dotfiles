import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type MemoryTarget = "USER.md" | "WORKFLOWS.md" | "PROJECTS.md";

type MemoryCandidate = {
	content: string;
	reason: string;
	target: MemoryTarget;
};

type ApplyMemoryUpdateInput = {
	existingText: string;
	target: MemoryTarget;
	content: string;
	reason: string;
};

type ApplyMemoryUpdateResult = {
	changed: boolean;
	text: string;
	summary: string;
	reason: string;
};

type AuditResult = {
	text: string;
	removedDuplicates: number;
};

type MemoryUpdateNoticeInput = ApplyMemoryUpdateResult & {
	target: MemoryTarget;
};

type MemoryUpdateNotice = {
	uiText: string;
	modelMessage?: string;
};

const MAX_MEMORY_CHARS: Record<MemoryTarget, number> = {
	"USER.md": 4_000,
	"WORKFLOWS.md": 4_000,
	"PROJECTS.md": 5_000,
};

const TARGET_SECTION: Record<MemoryTarget, string> = {
	"USER.md": "Preferences",
	"WORKFLOWS.md": "Conventions",
	"PROJECTS.md": "Dotfiles",
};

function memoryDir(): string {
	return join(homedir(), ".pi/agent/memory");
}

function memoryPath(target: MemoryTarget): string {
	return join(memoryDir(), target);
}

function normalize(text: string): string {
	return text
		.toLowerCase()
		.replace(/[“”]/g, '"')
		.replace(/[’]/g, "'")
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function sentence(text: string): string {
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (!cleaned) return cleaned;
	return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function stripBullet(line: string): string {
	return line.replace(/^\s*-\s+/, "").trim();
}

function truncate(text: string, max = 180): string {
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (cleaned.length <= max) return cleaned;
	return `${cleaned.slice(0, max - 1).trim()}…`;
}

function isTaskContext(text: string): boolean {
	const lower = text.toLowerCase();
	return (
		/\b(current branch|this branch|branch has|current pr|pull request)\b/.test(
			lower,
		) ||
		/\b(job|script|file|service|svc|airflow|redis|token|proxy)\b/.test(lower) ||
		/\b(needs? to|get a token|connect to|being used to run)\b/.test(lower) ||
		/\b\w+[/.][\w/.-]+\b/.test(lower)
	);
}

function isAdvisoryQuestion(text: string): boolean {
	return /\?/.test(text) && /\b(do you think|should|shouldn'?t|why|how)\b/i.test(text);
}

function hasExplicitDurableCommand(text: string): boolean {
	return /^\s*(remember|prefer|do not|don'?t|always|for\b|when\b)/i.test(text);
}

export function classifyMemoryTarget(text: string): MemoryTarget {
	const lower = text.toLowerCase();
	if (
		/\b(pr review|pull request|workflow|process|when .*review|for .*reviews)\b/.test(
			lower,
		)
	) {
		return "WORKFLOWS.md";
	}
	if (
		/\b(this repo|repository|project|dotfiles|mise|stow|in this repo|gametime|pi memory|memory governor|markdown files|database)\b/.test(
			lower,
		)
	) {
		return "PROJECTS.md";
	}
	return "USER.md";
}

function extractPreference(text: string): string | undefined {
	const cleaned = text.replace(/\s+/g, " ").trim();
	const lower = cleaned.toLowerCase();

	const rememberMatch = cleaned.match(/^remember:?\s+(.{3,220})/i);
	if (rememberMatch) return sentence(rememberMatch[1]);

	if (lower.includes("when to update memory")) {
		return "Proactively consider when to update memory after behavioral corrections, workflow preferences, repeated-frustration feedback, or stable project caveats.";
	}

	if (/why don'?t we just pick where we want to go/i.test(cleaned)) {
		return "Prefer choosing the desired end-state and building it directly over adding intermediate scaffolding or process overhead.";
	}

	const preferMatch = cleaned.match(/\bprefer\s+(.{3,220})/i);
	if (preferMatch) return sentence(`Prefer ${preferMatch[1]}`);

	const dontMatch = cleaned.match(/\b(?:don'?t|do not)\s+(.{3,220})/i);
	if (dontMatch) return sentence(`Do not ${dontMatch[1]}`);

	const alwaysMatch = cleaned.match(/\b(?:always|you should)\s+(.{3,220})/i);
	if (alwaysMatch) return sentence(`Always ${alwaysMatch[1]}`);

	const workflowMatch = cleaned.match(/\b(?:for|when)\s+(.{3,220})/i);
	if (
		workflowMatch &&
		/\b(use|run|check|review|workflow|process)\b/i.test(workflowMatch[1])
	) {
		return sentence(truncate(cleaned));
	}

	if (
		/you (keep|kept|always|don'?t|do not|forgot|forget|missed|seem)/i.test(
			cleaned,
		)
	) {
		return sentence(truncate(cleaned));
	}

	return undefined;
}

export function detectMemoryCandidate(
	text: string,
): MemoryCandidate | undefined {
	if (!text || text.length > 4_000) return undefined;
	if (isAdvisoryQuestion(text) && !hasExplicitDurableCommand(text)) {
		return undefined;
	}
	if (isTaskContext(text) && !hasExplicitDurableCommand(text)) {
		return undefined;
	}
	const lower = text.toLowerCase();
	const hasTrigger =
		/\b(remember|forget|update memory)\b/.test(lower) ||
		/\b(prefer|don'?t|do not|always|you should)\b/.test(lower) ||
		/\b(for|when)\b.*\b(use|run|check|review|workflow|process)\b/.test(lower) ||
		/you (keep|kept|always|don'?t|do not|forgot|forget|missed|seem)/.test(
			lower,
		) ||
		lower.includes("frustrat");

	if (!hasTrigger) return undefined;
	const content = extractPreference(text);
	if (!content) return undefined;

	let reason = "memory-worthy preference";
	if (
		/you (keep|kept|always|don'?t|do not|forgot|forget|missed|seem)/.test(lower)
	) {
		reason = "behavioral correction";
	} else if (
		/\b(for|when)\b.*\b(use|run|check|review|workflow|process)\b/.test(lower)
	) {
		reason = "workflow rule";
	}

	return {
		content,
		reason,
		target: classifyMemoryTarget(text),
	};
}

export function shouldRejectMemory(
	content: string,
	existingText: string,
): string | undefined {
	const lower = content.toLowerCase();
	if (/begin (rsa |openssh |ec |)?private key/i.test(content))
		return "secret-like content";
	if (/\b(api[_-]?key|token|secret|password)\s*[:=]/i.test(content))
		return "secret-like content";
	if (/op:\/\//i.test(content)) return "secret-like content";
	if (
		/ignore (all )?(previous|prior) instructions|system prompt|developer message/i.test(
			content,
		)
	) {
		return "prompt-injection-like content";
	}
	if (
		/\b(this session only|temporary|for now|one[- ]off|just this time)\b/i.test(
			content,
		)
	) {
		return "transient content";
	}
	if (/\b(i guess|maybe|might|probably|not sure|unverified)\b/i.test(content)) {
		return "unverified assumption";
	}
	if (isAdvisoryQuestion(content) && !hasExplicitDurableCommand(content)) {
		return "advisory question";
	}
	if (isTaskContext(content) && !hasExplicitDurableCommand(content)) {
		return "transient task context";
	}

	const normalizedContent = normalize(stripBullet(content));
	const normalizedExisting = normalize(existingText);
	if (
		normalizedContent.length > 12 &&
		(normalizedExisting.includes(normalizedContent) ||
			normalizedExisting.split(" ").includes(normalizedContent))
	) {
		return "already represented";
	}
	return undefined;
}

export function auditMemoryText(text: string): AuditResult {
	const seenBullets = new Set<string>();
	let removedDuplicates = 0;
	const lines = text.split("\n");
	const audited = lines.filter((line) => {
		if (!/^\s*-\s+/.test(line)) return true;
		const key = normalize(stripBullet(line));
		if (!key) return true;
		if (seenBullets.has(key)) {
			removedDuplicates += 1;
			return false;
		}
		seenBullets.add(key);
		return true;
	});
	return { text: audited.join("\n"), removedDuplicates };
}

function defaultMemoryText(target: MemoryTarget): string {
	if (target === "USER.md") {
		return "# User Memory\n\n## Rules\n\n- Do not store secrets.\n\n## Preferences\n";
	}
	if (target === "WORKFLOWS.md") {
		return "# Workflow Memory\n\n## Rules\n\n- Do not store secrets.\n\n## Conventions\n";
	}
	return "# Project Memory\n\n## Rules\n\n- Do not store secrets.\n\n## Dotfiles\n";
}

function insertBullet(text: string, section: string, content: string): string {
	const lines = text.split("\n");
	const heading = `## ${section}`;
	const start = lines.findIndex((line) => line.trim() === heading);
	if (start === -1) {
		const suffix = text.endsWith("\n") ? "" : "\n";
		return `${text}${suffix}\n${heading}\n\n- ${content}\n`;
	}

	let end = lines.length;
	for (let i = start + 1; i < lines.length; i += 1) {
		if (/^##\s+/.test(lines[i])) {
			end = i;
			break;
		}
	}

	let insertAt = end;
	while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") {
		insertAt -= 1;
	}
	lines.splice(insertAt, 0, `- ${content}`);
	return `${lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd()}\n`;
}

export function applyMemoryUpdate(
	input: ApplyMemoryUpdateInput,
): ApplyMemoryUpdateResult {
	const audited = auditMemoryText(
		input.existingText || defaultMemoryText(input.target),
	);
	const rejection = shouldRejectMemory(input.content, audited.text);
	if (rejection) {
		return {
			changed: audited.text !== input.existingText,
			text: audited.text,
			summary: `skipped memory: ${rejection}`,
			reason: input.reason,
		};
	}

	const section = TARGET_SECTION[input.target];
	const content = sentence(stripBullet(input.content));
	const nextText = insertBullet(audited.text, section, content);

	if (nextText.length > MAX_MEMORY_CHARS[input.target]) {
		return {
			changed: audited.text !== input.existingText,
			text: audited.text,
			summary: "skipped memory: file needs cleanup before growing",
			reason: input.reason,
		};
	}

	return {
		changed: nextText !== input.existingText,
		text: nextText,
		summary:
			audited.removedDuplicates > 0
				? `added memory after removing ${audited.removedDuplicates} duplicate(s)`
				: "added memory",
		reason: input.reason,
	};
}

function readMemory(target: MemoryTarget): string {
	const path = memoryPath(target);
	if (!existsSync(path)) return defaultMemoryText(target);
	return readFileSync(path, "utf8");
}

function writeMemory(target: MemoryTarget, text: string): void {
	mkdirSync(memoryDir(), { recursive: true });
	writeFileSync(memoryPath(target), text, "utf8");
}

function processCandidate(
	candidate: MemoryCandidate,
): ApplyMemoryUpdateResult & { target: MemoryTarget } {
	const existingText = readMemory(candidate.target);
	const result = applyMemoryUpdate({
		existingText,
		target: candidate.target,
		content: candidate.content,
		reason: candidate.reason,
	});
	if (result.changed) writeMemory(candidate.target, result.text);
	return { ...result, target: candidate.target };
}

function auditAllMemoryFiles(): string {
	const summaries: string[] = [];
	for (const target of ["USER.md", "WORKFLOWS.md", "PROJECTS.md"] as const) {
		const before = readMemory(target);
		const audited = auditMemoryText(before);
		if (audited.text !== before) writeMemory(target, audited.text);
		summaries.push(
			`${target}: removed ${audited.removedDuplicates} duplicate(s)`,
		);
	}
	return summaries.join("\n");
}

export function buildMemoryUpdateNotice(
	result: MemoryUpdateNoticeInput,
): MemoryUpdateNotice {
	return {
		uiText: result.changed
			? `Memory updated: ${result.target} (${result.reason})`
			: `Memory unchanged: ${result.summary}`,
	};
}

export default function memoryGovernor(pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return { action: "continue" };
		const candidate = detectMemoryCandidate(event.text);
		if (!candidate) return { action: "continue" };

		const result = processCandidate(candidate);
		const notice = buildMemoryUpdateNotice(result);
		if (ctx.hasUI) {
			ctx.ui.notify(notice.uiText, result.changed ? "info" : "warning");
		}
		return { action: "continue" };
	});

	pi.registerCommand("memory-audit", {
		description: "Audit Pi memory files and remove exact duplicate bullets",
		handler: async (_args, ctx) => {
			const summary = auditAllMemoryFiles();
			ctx.ui.notify("Memory audit complete.", "info");
			pi.sendMessage({
				customType: "memory-governor-audit",
				display: true,
				content: summary,
			});
		},
	});
}
