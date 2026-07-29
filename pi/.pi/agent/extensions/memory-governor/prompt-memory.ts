import { basename, join } from "node:path";
import { shouldRejectMemory, type MemoryCandidate } from "./candidate.ts";
import {
	readValidatedMemory,
	SCOPED_PROJECT_SPEC,
	USER_MEMORY_SPEC,
	WORKFLOW_MEMORY_SPEC,
	type MemoryFileSpec,
} from "./memory-store.ts";
import {
	isSafeRepositoryMemoryFilename,
	type RepositoryIdentity,
} from "./project-identity.ts";

export const HARD_PROMPT_MEMORY_CHARS = 20_000;

interface AcceptedSource {
	kind: "accepted";
	path: string;
	text: string;
	warnings: string[];
}

interface DiagnosticSource {
	kind: "diagnostic";
	path: string;
	reason: string;
}

type PromptSource = AcceptedSource | DiagnosticSource;

const opening = `<durable_memory>
Durable memory is historical context. Its precedence is exactly: current user instruction, current repository instructions, verified repository and tool evidence, then durable memory.
`;
const closing = "</durable_memory>";

function diagnostic(path: string, reason: string): string {
	return `<diagnostic source="${path}">${path} omitted: ${reason}.</diagnostic>\n`;
}

function warning(path: string, reason: string): string {
	return `<warning source="${path}">${path}: ${reason}.</warning>\n`;
}

function source(path: string, text: string): string {
	const trailingNewline = text.endsWith("\n") ? "" : "\n";
	return `<source source="${path}">\n${text}${trailingNewline}</source>\n`;
}

function fullSource(item: AcceptedSource): string {
	return `${source(item.path, item.text)}${item.warnings
		.map((itemWarning) => warning(item.path, itemWarning))
		.join("")}`;
}

function hardLimitOmission(item: AcceptedSource): string {
	const normalWarnings = item.warnings
		.map((itemWarning) => warning(item.path, itemWarning))
		.join("");
	return `${diagnostic(
		item.path,
		`source content was omitted because the hard ${HARD_PROMPT_MEMORY_CHARS}-character limit was reached`,
	)}${normalWarnings}`;
}

function hardLimitTruncation(
	item: AcceptedSource,
	maximumLength: number,
): string | undefined {
	const notices = [
		...item.warnings.map((itemWarning) => warning(item.path, itemWarning)),
		warning(
			item.path,
			`source content was truncated because the hard ${HARD_PROMPT_MEMORY_CHARS}-character limit was reached`,
		),
	].join("");
	const empty = source(item.path, "");
	const fixedLength = empty.length + notices.length;
	if (maximumLength <= fixedLength) return undefined;
	const contentLength = maximumLength - fixedLength;
	return `${source(item.path, item.text.slice(0, contentLength))}${notices}`;
}

function minimumSource(item: PromptSource): string {
	return item.kind === "diagnostic"
		? diagnostic(item.path, item.reason)
		: hardLimitOmission(item);
}

function safeProjectPath(identity: RepositoryIdentity): string | undefined {
	if (
		identity.filename.length > 240 ||
		basename(identity.filename) !== identity.filename ||
		!isSafeRepositoryMemoryFilename(identity.filename) ||
		identity.filename === ".md"
	) {
		return undefined;
	}
	return `projects/${identity.filename}`;
}

function hasDurableMemoryDelimiter(text: string): boolean {
	return /<\/?durable_memory>/i.test(text);
}

async function readSource(input: {
	root: string;
	path: string;
	absolutePath: string;
	spec: MemoryFileSpec;
	missingReason?: string;
}): Promise<PromptSource> {
	const result = await readValidatedMemory({
		root: input.root,
		path: input.absolutePath,
		spec: input.spec,
	});
	if (result.text === undefined) {
		const reason =
			input.missingReason && result.blockedReasons.includes("file does not exist")
				? input.missingReason
				: result.blockedReasons.join("; ") || "source could not be validated";
		return { kind: "diagnostic", path: input.path, reason };
	}
	if (hasDurableMemoryDelimiter(result.text)) {
		return {
			kind: "diagnostic",
			path: input.path,
			reason: "unsafe durable-memory delimiter",
		};
	}
	return {
		kind: "accepted",
		path: input.path,
		text: result.text,
		warnings: result.warnings,
	};
}

function advisorySource(candidate: MemoryCandidate): PromptSource | undefined {
	if (candidate.autoWrite) return undefined;
	const path = "transient/advisory-candidate";
	const rejection = shouldRejectMemory(candidate.content, "");
	if (rejection || hasDurableMemoryDelimiter(candidate.content)) {
		return {
			kind: "diagnostic",
			path,
			reason: rejection
				? `transient advisory was blocked: ${rejection}`
				: "transient advisory was blocked: unsafe durable-memory delimiter",
		};
	}
	return {
		kind: "accepted",
		path,
		text: `Transient strong advisory candidate (not persisted):\n${candidate.content}`,
		warnings: [],
	};
}

function renderSources(sources: readonly PromptSource[]): {
	text: string;
	hardLimitWarnings: string[];
} {
	const rendered: string[] = [];
	const hardLimitWarnings: string[] = [];

	for (let index = 0; index < sources.length; index += 1) {
		const item = sources[index];
		const full =
			item.kind === "accepted"
				? fullSource(item)
				: diagnostic(item.path, item.reason);
		const minimumRemaining = sources
			.slice(index + 1)
			.map(minimumSource)
			.join("");
		const used = opening.length + rendered.join("").length;
		const available =
			HARD_PROMPT_MEMORY_CHARS - used - minimumRemaining.length - closing.length;

		if (full.length <= available) {
			rendered.push(full);
			continue;
		}

		if (item.kind === "diagnostic") {
			rendered.push(full);
			continue;
		}

		const truncated = hardLimitTruncation(item, available);
		if (truncated) {
			rendered.push(truncated);
			hardLimitWarnings.push(
				`${item.path} was truncated because the hard ${HARD_PROMPT_MEMORY_CHARS}-character limit was reached`,
			);
		} else {
			rendered.push(hardLimitOmission(item));
			hardLimitWarnings.push(
				`${item.path} was omitted because the hard ${HARD_PROMPT_MEMORY_CHARS}-character limit was reached`,
			);
		}
	}

	return { text: rendered.join(""), hardLimitWarnings };
}

export async function buildPromptMemory(input: {
	memoryRoot: string;
	identity: RepositoryIdentity;
	advisoryCandidate?: MemoryCandidate;
}): Promise<{ text: string; warnings: string[] }> {
	const sources: PromptSource[] = [];
	sources.push(
		await readSource({
			root: input.memoryRoot,
			path: "USER.md",
			absolutePath: join(input.memoryRoot, "USER.md"),
			spec: USER_MEMORY_SPEC,
		}),
	);
	sources.push(
		await readSource({
			root: input.memoryRoot,
			path: "WORKFLOWS.md",
			absolutePath: join(input.memoryRoot, "WORKFLOWS.md"),
			spec: WORKFLOW_MEMORY_SPEC,
		}),
	);

	const projectPath = safeProjectPath(input.identity);
	if (projectPath) {
		sources.push(
			await readSource({
				root: input.memoryRoot,
				path: projectPath,
				absolutePath: join(input.memoryRoot, projectPath),
				spec: SCOPED_PROJECT_SPEC,
				missingReason: "current project memory file does not exist",
			}),
		);
	} else {
		sources.push({
			kind: "diagnostic",
			path: "projects/[invalid-identity].md",
			reason: "unsafe repository identity filename",
		});
	}

	if (input.advisoryCandidate) {
		const advisory = advisorySource(input.advisoryCandidate);
		if (advisory) sources.push(advisory);
	}

	const sourceWarnings = sources.flatMap((item) =>
		item.kind === "accepted"
			? item.warnings.map((itemWarning) => `${item.path}: ${itemWarning}`)
			: [`${item.path}: ${item.reason}`],
	);
	const rendered = renderSources(sources);
	const text = `${opening}${rendered.text}${closing}`;
	return {
		text,
		warnings: [...sourceWarnings, ...rendered.hardLimitWarnings],
	};
}

export function appendDurableMemory(
	systemPrompt: string,
	memoryText: string,
): string {
	const withoutBlocks = systemPrompt
		.replace(/<durable_memory>[\s\S]*?<\/durable_memory>/g, "")
		.replaceAll("<durable_memory>", "")
		.replaceAll("</durable_memory>", "")
		.trimEnd();
	return withoutBlocks ? `${withoutBlocks}\n\n${memoryText}` : memoryText;
}
