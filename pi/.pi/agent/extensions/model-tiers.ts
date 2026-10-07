import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// Agents select tiers/tier-N; model-tiers.json maps each tier to a physical
// provider/model. Edit only that file to upgrade a tier, then /reload or
// restart Pi. Requests keep the agent's thinking level; Pi clamps it to the
// physical model and rejects targets that are missing, virtual, or unauthed.

const MAPPING = fileURLToPath(new URL("./model-tiers.json", import.meta.url));
const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

function readMapping() {
	const mapping = JSON.parse(readFileSync(MAPPING, "utf8"));
	const entries =
		mapping && typeof mapping === "object" && !Array.isArray(mapping)
			? Object.entries(mapping)
			: [];
	if (entries.length === 0) {
		throw new Error(`${MAPPING}: expected tier-N entries`);
	}
	return entries.map(([tier, target]) => {
		const match =
			typeof target === "string" ? /^([^/\s]+)\/(\S+)$/.exec(target) : null;
		if (!/^tier-\d+$/.test(tier) || !match) {
			throw new Error(
				`${MAPPING}: ${tier} must map to "provider/model", ` +
					`got ${JSON.stringify(target)}`,
			);
		}
		return { tier, provider: match[1], id: match[2] };
	});
}

export default function modelTiers(pi: ExtensionAPI) {
	// Subagent sessions share the parent's model runtime. A non-isolated child
	// that loads this extension re-registers the tiers, and its context goes
	// stale when it ends, so route through the registry captured at start.
	let registry: ExtensionContext["modelRegistry"] | undefined;
	pi.on("session_start", (_event, ctx) => {
		registry = ctx.modelRegistry;
	});
	for (const { tier, provider, id } of readMapping()) {
		pi.registerVirtualModel({
			provider: "tiers",
			id: tier,
			name: `Tier ${tier.slice("tier-".length)}`,
			thinkingLevels: THINKING_LEVELS,
			route(request, ctx) {
				const model = (registry ?? ctx.modelRegistry).find(provider, id);
				if (!model) {
					throw new Error(
						`tiers/${tier} maps to ${provider}/${id}, ` +
							"which is not in the Pi model catalog",
					);
				}
				return { model, thinkingLevel: request.thinkingLevel };
			},
		});
	}
}
