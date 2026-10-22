import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FailureLoopDetector } from "./detector.ts";

// Advisory only: after three consecutive identical all-failed tool batches,
// persist one visible note before the next ordinary model request. It never
// rewrites errors, blocks tools, or requests another run.
const NOTICE =
	"Repeated identical tool failures detected. Change the " +
	"approach or report the blocker instead of retrying unchanged " +
	"inputs. This notice grants no additional authorization.";

export default function failureLoop(pi: ExtensionAPI) {
	const detector = new FailureLoopDetector();
	const reset = () => detector.reset();
	pi.on("input", reset);
	pi.on("agent_start", reset);
	pi.on("session_start", reset);
	pi.on("session_compact", reset);
	pi.on("turn_end", (event) => {
		if (!detector.observe(event)) return;
		return {
			entries: [
				{
					type: "custom_message",
					customType: "failure-loop",
					content: NOTICE,
					display: true,
				},
			],
		};
	});
}
