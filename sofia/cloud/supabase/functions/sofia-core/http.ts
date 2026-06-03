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

export function isDailyDigestRequest(method: string, url: string): boolean {
	return (
		method.toUpperCase() === "POST" &&
		new URL(url).pathname.endsWith("/daily-digest")
	);
}

export function parseBootContextParams(url: string): BootContextRequest {
	const parsed = new URL(url);
	const context = parsed.searchParams.get("context") ?? "personal";
	if (!BOOT_CONTEXTS.has(context as SofiaContext)) {
		throw new Error(`invalid boot context: ${context}`);
	}
	const request: BootContextRequest = {
		context: context as SofiaContext,
		force_refresh: parsed.searchParams.get("force_refresh") === "true",
	};
	const entityId = parsed.searchParams.get("entity_id");
	const entity = parsed.searchParams.get("entity");
	if (entityId) request.entity_id = entityId;
	if (entity) request.entity = entity;
	return request;
}
