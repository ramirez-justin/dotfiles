// @ts-nocheck
import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const BOOP_SOUND =
	"/System/Library/PrivateFrameworks/CallIntelligence.framework/Versions/A/Resources/boop.caf";
const AUTH_SOUND = "/System/Library/Sounds/Tink.aiff";
const AUTH_COMMAND = /(?:^|[;&|\n]|\$\()\s*(?:op\s+(?:read|run|signin|inject)\b|aws-vault\s+(?:exec|login|export)\b|aws-me\b)/;
const AUTH_IN_SHELL = /(?:^|[;&|\n])\s*(?:zsh|bash)\s+-ic\s+['"]\s*(?:aws-me\b|aws-vault\s+(?:exec|login|export)\b|op\s+(?:read|run|signin|inject)\b)/;

export function startsAuthCommand(command: string): boolean {
	return AUTH_COMMAND.test(command) || AUTH_IN_SHELL.test(command);
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_execution_start", (event) => {
		if (event.toolName !== "bash" ||
			typeof event.args?.command !== "string" ||
			!startsAuthCommand(event.args.command)) return;
		execFile("afplay", ["-v", "0.2", AUTH_SOUND], () => {});
	});

	pi.on("agent_end", async () => {
		execFile("afplay", [BOOP_SOUND], { windowsHide: true }, () => {});
		execFile(
			"osascript",
			[
				"-e",
				'display notification "Pi has stopped and is ready." with title "Pi"',
			],
			{ windowsHide: true },
			() => {},
		);
	});
}
