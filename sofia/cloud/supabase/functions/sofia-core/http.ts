import type { BootContextRequest, SofiaContext } from "./types.ts";

const BOOT_CONTEXTS = new Set<SofiaContext>(["personal", "work", "shared"]);

export function shouldPatchMcpAcceptHeader(
	method: string,
	acceptHeader: string | undefined,
): boolean {
	return (
		method.toUpperCase() === "POST" &&
		!acceptHeader?.includes("text/event-stream")
	);
}

export function isBootContextRequest(method: string, url: string): boolean {
	return (
		method.toUpperCase() === "GET" &&
		new URL(url).pathname.endsWith("/boot-context")
	);
}

export function parseBootContextParams(url: string): BootContextRequest {
	const parsed = new URL(url);
	const context = parsed.searchParams.get("context") ?? "personal";
	if (!BOOT_CONTEXTS.has(context as SofiaContext)) {
		throw new Error(`invalid boot context: ${context}`);
	}
	return {
		context: context as SofiaContext,
		force_refresh: parsed.searchParams.get("force_refresh") === "true",
	};
}
