// @ts-nocheck
import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const BOOP_SOUND =
	"/System/Library/PrivateFrameworks/CallIntelligence.framework/Versions/A/Resources/boop.caf";

export default function (pi: ExtensionAPI) {
	pi.on("agent_end", async () => {
		execFile("afplay", [BOOP_SOUND], { windowsHide: true }, () => {});
	});
}
