#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const sentinelPath = process.argv[2];

try {
	const input = readFileSync(0, "utf8");
	const event = input.trim() ? JSON.parse(input) : {};
	writeFileSync(
		sentinelPath,
		JSON.stringify(
			{
				timestamp: new Date().toISOString(),
				session_id: event.session_id,
				transcript_path: event.transcript_path,
				cwd: event.cwd,
				hook_event_name: event.hook_event_name,
			},
			null,
			2,
		),
		"utf8",
	);
	process.stdout.write(
		JSON.stringify({
			decision: "approve",
			suppressOutput: true,
			systemMessage: "Pi observed Claude Code stop.",
		}),
	);
} catch (error) {
	process.stderr.write(String(error instanceof Error ? error.stack : error));
	process.exit(1);
}
