import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BOOP_SOUND =
	"/System/Library/PrivateFrameworks/CallIntelligence.framework/Versions/A/Resources/boop.caf";

export default function stopNotification(pi: ExtensionAPI): void {
	pi.on("agent_settled", () => {
		if (process.platform !== "darwin" || !existsSync(BOOP_SOUND)) return;
		execFile("afplay", [BOOP_SOUND], { windowsHide: true }, () => {});
	});
}
