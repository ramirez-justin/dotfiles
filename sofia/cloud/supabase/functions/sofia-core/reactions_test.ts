import { assertEquals } from "jsr:@std/assert";
import {
  classifyReactionEmoji,
  recordReactionEvent,
  summarizeReactionPatterns,
} from "./reactions.ts";

class FakeQuery {
  constructor(private table: string, private state: FakeSupabase) {}

  insert(row: Record<string, unknown>) {
    this.state.inserts.push({ table: this.table, row });
    return {
      select: () => ({
        single: () =>
          Promise.resolve({
            data: { id: "reaction-1", ...row },
            error: null,
          }),
      }),
    };
  }
}

class FakeSupabase {
  inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  from(table: string) {
    return new FakeQuery(table, this);
  }
}

Deno.test("classifyReactionEmoji maps common reactions deterministically", () => {
  assertEquals(classifyReactionEmoji("👍"), {
    emoji: "👍",
    sentiment: "positive",
    category: "approval",
    learning_signal: "positive_preference",
    confidence: 0.9,
  });
  assertEquals(classifyReactionEmoji("👎").sentiment, "negative");
  assertEquals(classifyReactionEmoji("✅").category, "confirmation");
  assertEquals(
    classifyReactionEmoji("👀").learning_signal,
    "attention_requested",
  );
  assertEquals(classifyReactionEmoji("🦆").sentiment, "neutral");
});

Deno.test("recordReactionEvent redacts preview and stores append-only classified event", async () => {
  const fake = new FakeSupabase();
  const result = await recordReactionEvent(fake as never, {
    context: "personal",
    platform: "telegram",
    actor_id: "justin",
    chat_id: "dm-1",
    message_id: "msg-1",
    emoji: "👎",
    message_preview: "This accidentally includes sk-1234567890abcdefghijklmnop",
    source: "telegram_gateway",
    metadata: { skill: "sofia" },
  });

  assertEquals(result.id, "reaction-1");
  assertEquals(fake.inserts.length, 1);
  assertEquals(fake.inserts[0].table, "reaction_events");
  assertEquals(fake.inserts[0].row.sentiment, "negative");
  assertEquals(fake.inserts[0].row.category, "disapproval");
  assertEquals(
    fake.inserts[0].row.message_preview,
    "This accidentally includes [REDACTED_SECRET:openai_key]",
  );
  assertEquals(fake.inserts[0].row.metadata, {
    skill: "sofia",
    redacted: true,
    redaction_labels: ["openai_key"],
  });
});

Deno.test("summarizeReactionPatterns flags repeated stable signals but ignores singletons", () => {
  const patterns = summarizeReactionPatterns([
    {
      context: "personal",
      emoji: "👍",
      sentiment: "positive",
      category: "approval",
      learning_signal: "positive_preference",
      context_key: "deploy_summary",
      count: 3,
      distinct_days: 2,
      latest_at: "2026-06-04T12:00:00Z",
    },
    {
      context: "personal",
      emoji: "👎",
      sentiment: "negative",
      category: "disapproval",
      learning_signal: "negative_preference",
      context_key: "verbose_update",
      count: 1,
      distinct_days: 1,
      latest_at: "2026-06-04T12:00:00Z",
    },
  ]);

  assertEquals(patterns.length, 2);
  assertEquals(patterns[0].candidate_worthy, true);
  assertEquals(patterns[0].suggested_action, "create_review_candidate");
  assertEquals(patterns[1].candidate_worthy, false);
  assertEquals(patterns[1].suggested_action, "keep_as_telemetry");
});
