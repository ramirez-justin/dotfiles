export type MemoryScope = "user" | "workflow" | "project" | "unscoped";

export interface MemoryCandidate {
	content: string;
	reason: "explicit-memory" | "workflow-rule" | "behavioral-correction";
	scope: MemoryScope;
	autoWrite: boolean;
	/** Visible reason an explicit Remember command cannot be persisted. */
	rejection?: string;
}

export const MAX_MEMORY_INPUT_CHARS = 4_000;

export interface MemoryRejectionOptions {
	/** Explicit Remember intent may persist content that looks task-specific. */
	explicit?: boolean;
}

export interface MemoryAdditionInput {
	content: string;
	existingText: string;
	section: string;
	maxChars: number;
	explicit?: boolean;
}

export interface MemoryAdditionResult {
	changed: boolean;
	text: string;
	summary: string;
}

export interface MemoryAuditResult {
	text: string;
	removedDuplicates: number;
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

function isLowQualityMemoryContent(text: string): boolean {
	const cleaned = text.replace(/\s+/g, " ").trim();
	return (
		/\?/.test(cleaned) ||
		/^\s*(?:i|we)\s+(?:don'?t|do not)\s+(?:know|think|understand|see|believe)\b/i.test(
			cleaned,
		) ||
		/^\s*(?:do we|can we|could we|why|how|what)\b/i.test(cleaned) ||
		/\b(?:the question you asked|as far as|i think we should|i don'?t know|i don'?t think|i do not know|i do not think|i do not understand)\b/i.test(
			cleaned,
		)
	);
}

function isEphemeralInstruction(text: string): boolean {
	return (
		/\b(this|that|these|those)\s+(plan|branch|change|changes|file|diff|session)\b/i.test(
			text,
		) || /\b(when done|for now|just this|throw it away|trash it)\b/i.test(text)
	);
}

function hasExplicitRememberCommand(text: string): boolean {
	return /^\s*remember:?\s+\S/i.test(text);
}

function classifyMemoryScope(text: string): MemoryScope {
	const lower = text.toLowerCase();
	if (
		/\b(pr review|pull request|workflow|process|when .*review|for .*reviews)\b/.test(
			lower,
		)
	) {
		return "workflow";
	}
	if (
		/\b(this repo|repository|project|dotfiles|mise|stow|in this repo|gametime|pi memory|memory governor|markdown files|database)\b/.test(
			lower,
		) ||
		// Relative paths may follow whitespace or common Markdown delimiters.
		/(?:^|[\s"'`(\[])[\w-]+(?:\/[\w.-]+)+\.[a-z0-9]+\b/.test(lower)
	) {
		return "project";
	}
	return "user";
}

function detectExplicitMemory(text: string): MemoryCandidate {
	const scope = classifyMemoryScope(text);
	const candidate = (content: string, rejection?: string): MemoryCandidate => ({
		content,
		reason: "explicit-memory",
		scope,
		autoWrite: true,
		...(rejection ? { rejection } : {}),
	});
	if (text.length > MAX_MEMORY_INPUT_CHARS) {
		return candidate(
			"",
			`input exceeds the ${MAX_MEMORY_INPUT_CHARS}-character memory input limit`,
		);
	}
	if (isEphemeralInstruction(text)) return candidate("", "ephemeral instruction");

	const remembered = text
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^remember:?\s+/i, "");
	if (remembered.length < 3) return candidate("", "content is too short");
	if (isLowQualityMemoryContent(remembered)) {
		return candidate("", "raw question or conversational fragment");
	}
	return candidate(sentence(remembered));
}

function extractStrongInference(text: string): string | undefined {
	const cleaned = text.replace(/\s+/g, " ").trim();
	if (isLowQualityMemoryContent(cleaned)) return undefined;

	const preference = cleaned.match(/^i prefer\s+(.{3,220})/i);
	if (preference) return sentence(`Prefer ${preference[1]}`);

	if (!/^you\s+(?:keep|always|forgot|missed|do not|don'?t)\b/i.test(cleaned)) {
		return undefined;
	}
	if (cleaned.toLowerCase().includes("when to update memory")) {
		return "Proactively consider when to update memory after behavioral corrections, workflow preferences, repeated-frustration feedback, or stable project caveats.";
	}
	const dont = cleaned.match(/^you\s+(?:don'?t|do not)\s+(.{3,220})/i);
	if (dont) return sentence(`Do not ${dont[1]}`);
	const always = cleaned.match(/^you\s+always\s+(.{3,220})/i);
	if (always) return sentence(`Always ${always[1]}`);
	return sentence(truncate(cleaned));
}

export function detectMemoryCandidate(
	text: string,
): MemoryCandidate | undefined {
	if (!text) return undefined;
	if (hasExplicitRememberCommand(text)) return detectExplicitMemory(text);
	if (text.length > MAX_MEMORY_INPUT_CHARS || isEphemeralInstruction(text)) {
		return undefined;
	}
	if (/\?/.test(text) || isTaskContext(text)) return undefined;

	const content = extractStrongInference(text);
	if (!content) return undefined;

	const scope = classifyMemoryScope(text);
	const behavioralCorrection =
		/^\s*you\s+(?:keep|always|forgot|missed|do not|don'?t)\b/i.test(text);

	return {
		content,
		reason: behavioralCorrection
			? "behavioral-correction"
			: scope === "workflow"
				? "workflow-rule"
				: "explicit-memory",
		scope,
		autoWrite: false,
	};
}

export function shouldRejectMemory(
	content: string,
	existingText: string,
	options: MemoryRejectionOptions = {},
): string | undefined {
	if (/begin (rsa |openssh |ec |)?private key/i.test(content)) {
		return "secret-like content";
	}
	if (/\b(api[_-]?key|token|secret|password)\s*[:=]/i.test(content)) {
		return "secret-like content";
	}
	if (/op:\/\//i.test(content)) return "secret-like content";
	if (
		/[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:[^\s/@]+@/i.test(content) ||
		/\b(?:gh[pousr]_[a-z0-9]{36}|github_pat_[a-z0-9]{22}_[a-z0-9]{59})\b/i.test(content) ||
		/\bauthorization\s*:?\s*bearer\s+[a-z0-9._~+/-]{16,}={0,2}\b/i.test(content) ||
		/\beyJ[a-z0-9_-]{8,}\.eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{16,}\b/i.test(content)
	) {
		return "secret-like content";
	}
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
	if (isEphemeralInstruction(content)) return "ephemeral instruction";
	if (isLowQualityMemoryContent(content)) {
		return "raw question or conversational fragment";
	}
	if (isTaskContext(content) && !options.explicit) {
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

/**
 * Remove exact duplicate logical bullets within each section. A logical bullet
 * is its bullet line plus following lines indented deeper than its marker, so
 * wrapping differences are ignored but every other character must match.
 */
export function auditMemoryText(text: string): MemoryAuditResult {
	const lines = text.split("\n");
	const audited: string[] = [];
	let seenBullets = new Set<string>();
	let removedDuplicates = 0;
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		const marker = line.match(/^(\s*)-\s+\S/);
		if (!marker) {
			if (/^#{1,6}\s/.test(line)) seenBullets = new Set();
			audited.push(line);
			index += 1;
			continue;
		}

		let end = index + 1;
		while (
			end < lines.length &&
			lines[end].trim() !== "" &&
			(lines[end].match(/^\s*/)?.[0].length ?? 0) > marker[1].length
		) {
			end += 1;
		}
		const bullet = lines.slice(index, end);
		const key = bullet.join(" ").replace(/\s+/g, " ").trim();
		if (seenBullets.has(key)) {
			removedDuplicates += 1;
		} else {
			seenBullets.add(key);
			audited.push(...bullet);
		}
		index = end;
	}
	return { text: audited.join("\n"), removedDuplicates };
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
	for (let index = start + 1; index < lines.length; index += 1) {
		if (/^##\s+/.test(lines[index])) {
			end = index;
			break;
		}
	}

	let insertAt = end;
	while (insertAt > start + 1 && lines[insertAt - 1].trim() === "") {
		insertAt -= 1;
	}
	lines.splice(insertAt, 0, `- ${content}`);
	return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export function applyMemoryAddition(
	input: MemoryAdditionInput,
): MemoryAdditionResult {
	const rejection = shouldRejectMemory(input.content, input.existingText, {
		explicit: input.explicit,
	});
	if (rejection) {
		return {
			changed: false,
			text: input.existingText,
			summary: `skipped memory: ${rejection}`,
		};
	}

	const audited = auditMemoryText(input.existingText);
	const content = sentence(stripBullet(input.content));
	const nextText = insertBullet(audited.text, input.section, content);
	if (nextText.length > input.maxChars) {
		return {
			changed: false,
			text: input.existingText,
			summary: "skipped memory: file needs cleanup before growing",
		};
	}

	return {
		changed: nextText !== input.existingText,
		text: nextText,
		summary:
			audited.removedDuplicates > 0
				? `added memory after removing ${audited.removedDuplicates} duplicate(s)`
				: "added memory",
	};
}
