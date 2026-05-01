export function textResponse(text: string, isError = false) {
	return {
		content: [{ type: "text" as const, text }],
		isError,
	};
}

export function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export function sanitizeRowsForMcp<T extends Record<string, unknown>>(
	rows: T[],
): Omit<T, "embedding">[] {
	return rows.map(({ embedding: _embedding, ...row }) => row);
}
