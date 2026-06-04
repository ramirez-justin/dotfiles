import assert from "node:assert/strict";
import {
  type DailyDigestSnapshot,
  formatDailyDigest,
  sendTelegramMessage,
} from "./daily_digest.ts";

Deno.test("formatDailyDigest renders deterministic evening digest", () => {
  const snapshot: DailyDigestSnapshot = {
    pendingReviewCount: 4,
    pendingReviewBySeverity: { high: 1, normal: 2, low: 1 },
    pendingContradictionsBySeverity: { high: 2, medium: 1, low: 0 },
    recentEventCount: 7,
    redactedEventCount: 1,
    staleHighPriorityMemories: [
      {
        id: "memory-1",
        title: "Old operating rule",
        context: "work",
        retrieval_priority: 90,
      },
    ],
    confusingRetrievals: [
      {
        retrieval_id: "retrieval-1",
        memory_id: "memory-2",
        query: "boot context",
        feedback: "wrong project",
      },
    ],
    dueTodos: [
      {
        id: "todo-1",
        title: "Review SOFIA candidates",
        context: "work",
        status: "open",
        due_at: "2026-06-03T12:00:00Z",
      },
    ],
    recentBootSnapshots: [
      {
        id: "snapshot-1",
        context: "work",
        generated_at: "2026-06-02T22:00:00Z",
        token_count: 1234,
      },
    ],
    recentNegativeReactions: [
      {
        id: "reaction-1",
        context: "personal",
        emoji: "👎",
        category: "disapproval",
        message_preview: "too verbose",
        created_at: "2026-06-02T21:00:00Z",
      },
    ],
    reactionPatterns: [
      {
        context: "personal",
        context_key: "deploy_summary",
        emoji: "👍",
        sentiment: "positive",
        category: "approval",
        learning_signal: "positive_preference",
        count: 3,
        distinct_days: 2,
        latest_at: "2026-06-02T22:00:00Z",
        candidate_worthy: true,
        suggested_action: "create_review_candidate",
        rationale:
          "Repeated reaction pattern crossed conservative review threshold.",
      },
    ],
    candidates: [
      {
        id: "candidate-1",
        title: "SOFIA should add Telegram digests",
        candidate_type: "decision",
        context: "personal",
        created_at: "2026-06-02T18:00:00Z",
      },
      {
        id: "candidate-2",
        title: "Untitled",
        candidate_type: "lesson",
        context: "shared",
        created_at: "2026-06-02T17:00:00Z",
      },
    ],
  };

  assert.equal(
    formatDailyDigest(snapshot, new Date("2026-06-02T23:00:00Z")),
    [
      "SOFIA evening digest — 2026-06-02",
      "",
      "Pending review: 4 (high 1, normal 2, low 1)",
      "Pending contradictions: high 2, medium 1, low 0",
      "Recent captures: 7 in the last 24h",
      "Redactions: 1 capture had secrets/private material redacted",
      "Health: attention needed — review queue or QA signals present",
      "",
      "Urgent memory QA:",
      "- Stale high-priority memory: Old operating rule — work/priority 90 (memory-1)",
      '- Confusing retrieval: memory-2 for "boot context" — wrong project (retrieval-1)',
      "",
      "Due soon:",
      "- Review SOFIA candidates — work/open due 2026-06-03T12:00:00Z (todo-1)",
      "",
      "Recent boot snapshots:",
      "- work snapshot snapshot-1 at 2026-06-02T22:00:00Z — 1234 tokens",
      "",
      "Reaction learning:",
      "- Negative reaction 👎/disapproval on personal message reaction-1 — too verbose",
      "- Pattern ready for review: 👍 deploy_summary — 3 reactions across 2 days (personal)",
      "",
      "Top review candidates:",
      "1. SOFIA should add Telegram digests — decision/personal",
      "2. Untitled — lesson/shared",
      "",
      "Review in Pi with `sofia_cloud_review_candidates`.",
    ].join("\n"),
  );
});

Deno.test("formatDailyDigest handles empty review queue", () => {
  const snapshot: DailyDigestSnapshot = {
    pendingReviewCount: 0,
    pendingReviewBySeverity: { high: 0, normal: 0, low: 0 },
    pendingContradictionsBySeverity: { high: 0, medium: 0, low: 0 },
    recentEventCount: 0,
    redactedEventCount: 0,
    staleHighPriorityMemories: [],
    confusingRetrievals: [],
    dueTodos: [],
    recentBootSnapshots: [],
    recentNegativeReactions: [],
    reactionPatterns: [],
    candidates: [],
  };

  assert.match(
    formatDailyDigest(snapshot, new Date("2026-06-02T23:00:00Z")),
    /No pending memory candidates\./,
  );
});

Deno.test("sendTelegramMessage posts sendMessage payload", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchStub = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: 1 } }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const result = await sendTelegramMessage({
    botToken: "123:secret",
    chatId: "456",
    text: "hello",
    fetchImpl: fetchStub,
  });

  assert.equal(result.ok, true);
  assert.equal(
    calls[0].url,
    "https://api.telegram.org/bot123:secret/sendMessage",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body as string), {
    chat_id: "456",
    text: "hello",
    disable_web_page_preview: true,
  });
});
