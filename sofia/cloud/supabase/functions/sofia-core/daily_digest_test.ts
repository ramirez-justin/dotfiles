import assert from "node:assert/strict";
import {
	formatDailyDigest,
	sendTelegramMessage,
	type DailyDigestSnapshot,
} from "./daily_digest.ts";

Deno.test("formatDailyDigest renders deterministic evening digest", () => {
	const snapshot: DailyDigestSnapshot = {
		pendingReviewCount: 4,
		recentEventCount: 7,
		redactedEventCount: 1,
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
			"Pending review: 4",
			"Recent captures: 7 in the last 24h",
			"Redactions: 1 capture had secrets/private material redacted",
			"Health: ok — scheduled digest function ran",
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
		recentEventCount: 0,
		redactedEventCount: 0,
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
		return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};

	const result = await sendTelegramMessage({
		botToken: "123:secret",
		chatId: "456",
		text: "hello",
		fetchImpl: fetchStub,
	});

	assert.equal(result.ok, true);
	assert.equal(calls[0].url, "https://api.telegram.org/bot123:secret/sendMessage");
	assert.equal(calls[0].init.method, "POST");
	assert.deepEqual(JSON.parse(calls[0].init.body as string), {
		chat_id: "456",
		text: "hello",
		disable_web_page_preview: true,
	});
});
