export function textResponse(text: string, isError = false) {
	return {
		content: [{ type: "text" as const, text }],
		isError,
	};
}

export function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}
