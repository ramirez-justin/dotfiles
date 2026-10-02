import assert from "node:assert/strict";
import { test } from "node:test";
import routing from "../extensions/subagent-routing.ts";

const marker = "# Automatic subagent routing reminder";

function invoke(systemPrompt, selectedTools = ["Agent"], prompt = "Implement the request") {
  const handlers = new Map();
  routing({ on(event, handler) { handlers.set(event, handler); } });
  assert.deepEqual([...handlers.keys()], ["before_agent_start"]);
  return handlers.get("before_agent_start")({
    type: "before_agent_start",
    prompt,
    systemPrompt,
    systemPromptOptions: { selectedTools },
  });
}

test("reminds the main agent on an ordinary request without replacing existing prompt", () => {
  const original = "Base instructions\n\n# SOFIA — your second brain context\nKeep this context.";
  const result = invoke(original);
  assert.ok(result?.systemPrompt.startsWith(original + "\n\n"));
  assert.ok(result.systemPrompt.includes(marker));
  assert.match(result.systemPrompt, /evaluate.*delegat/i);
  assert.match(result.systemPrompt, /without.*ask/i);
  assert.match(result.systemPrompt, /SubagentWorkflow.*explicit/i);
  assert.match(result.systemPrompt, /small.*clear/i);
  assert.doesNotMatch(result.systemPrompt, /GPT-6|Luna|Terra|on Sol|on Astra/);
});

test("does not add duplicate reminders across repeated starts", () => {
  const once = invoke("Original").systemPrompt;
  assert.equal(invoke(once), undefined);
  assert.equal(once.split(marker).length, 2);
});

test("preserves SOFIA content when added after the routing reminder", () => {
  const routed = invoke("Base instructions").systemPrompt;
  const withSofia = `${routed}\n\n# SOFIA — your second brain context\nKeep this context.`;
  assert.equal(invoke(withSofia), undefined);
  assert.ok(withSofia.includes(marker));
  assert.ok(withSofia.includes("Keep this context."));
});

test("skips when the Agent tool is not selected", () => {
  assert.equal(invoke("Original", ["read", "write"]), undefined);
  assert.equal(invoke("Original", []), undefined);
});

test("skips child sessions even when nested Agent is selected", () => {
  assert.equal(invoke('Original\n<active_agent name="worker"/>'), undefined);
  assert.equal(invoke("Original\n<sub_agent_context>child</sub_agent_context>"), undefined);
});
