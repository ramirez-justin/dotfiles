// @ts-nocheck
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const STATUS_ID = "session-status";

function updateSessionStatus(pi: ExtensionAPI, ctx: ExtensionContext) {
	const name = pi.getSessionName();
	ctx.ui.setStatus(
		STATUS_ID,
		name ? ctx.ui.theme.fg("dim", `session: ${name}`) : undefined,
	);
}

export default function sessionStatusExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		updateSessionStatus(pi, ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		updateSessionStatus(pi, ctx);
	});
}
