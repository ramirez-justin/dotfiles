import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REMINDER = `# Automatic subagent routing reminder

On ordinary requests, evaluate scope, uncertainty, and risk for useful delegation without waiting for a command or asking permission just to delegate. Follow AGENTS.md routing and each agent's instructions: use Explore for broad unfamiliar subsystems; apply the Plan/AstraPlan gate when warranted; delegate approved meaningful writes to exactly one worker or implementer while the parent does not write concurrently. Use the simplifier skill checkpoint and independent correctness review when warranted, and verifier before claiming meaningful changes complete. Keep direct work for small, clear tasks, and do not force a pipeline for conversation or retrieval. Use Agent for automatic delegation; SubagentWorkflow requires explicit opt-in. Preserve all user approvals and safety gates.`;

export default function subagentRouting(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    if (
      !event.systemPromptOptions.selectedTools.includes("Agent") ||
      event.systemPrompt.includes("<active_agent ") ||
      event.systemPrompt.includes("<sub_agent_context>") ||
      event.systemPrompt.includes("# Automatic subagent routing reminder")
    ) return;

    return { systemPrompt: `${event.systemPrompt}\n\n${REMINDER}` };
  });
}
