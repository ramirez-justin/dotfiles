export function shouldPatchMcpAcceptHeader(
	method: string,
	acceptHeader: string | undefined,
): boolean {
	return (
		method.toUpperCase() === "POST" &&
		!acceptHeader?.includes("text/event-stream")
	);
}
