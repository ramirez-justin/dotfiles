import type { SupabaseClient } from "@supabase/supabase-js";

export type DailyDigestCandidate = {
	id: string;
	title: string;
	candidate_type: string;
	context: string;
	created_at: string;
};

export type DailyDigestSnapshot = {
	pendingReviewCount: number;
	recentEventCount: number;
	redactedEventCount: number;
	candidates: DailyDigestCandidate[];
};

type TelegramSendInput = {
	botToken: string;
	chatId: string;
	text: string;
	fetchImpl?: typeof fetch;
};

export type TelegramSendResult = {
	ok: boolean;
	status: number;
	body: unknown;
};

export function formatDailyDigest(
	snapshot: DailyDigestSnapshot,
	now = new Date(),
): string {
	const date = now.toISOString().slice(0, 10);
	const lines = [
		`SOFIA evening digest — ${date}`,
		"",
		`Pending review: ${snapshot.pendingReviewCount}`,
		`Recent captures: ${snapshot.recentEventCount} in the last 24h`,
		`Redactions: ${snapshot.redactedEventCount} capture${
			snapshot.redactedEventCount === 1 ? " had" : "s had"
		} secrets/private material redacted`,
		"Health: ok — scheduled digest function ran",
		"",
	];

	if (snapshot.candidates.length === 0) {
		lines.push("No pending memory candidates.");
	} else {
		lines.push("Top review candidates:");
		for (const [index, candidate] of snapshot.candidates.entries()) {
			lines.push(
				`${index + 1}. ${candidate.title} — ${candidate.candidate_type}/${candidate.context}`,
			);
		}
	}

	lines.push("", "Review in Pi with `sofia_cloud_review_candidates`.");
	return lines.join("\n");
}

function titleFromCandidate(row: Record<string, unknown>): string {
	const metadata = row.metadata as Record<string, unknown> | null;
	const title = metadata?.title;
	if (typeof title === "string" && title.trim()) return title.trim();
	const text = row.candidate_text;
	if (typeof text === "string" && text.trim()) {
		return text.trim().slice(0, 80);
	}
	return "Untitled";
}

export async function fetchDailyDigestSnapshot(
	supabase: SupabaseClient,
	now = new Date(),
): Promise<DailyDigestSnapshot> {
	const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

	const { count: pendingReviewCount, error: pendingCountError } = await supabase
		.from("memory_candidates")
		.select("id", { count: "exact", head: true })
		.eq("status", "pending_review");
	if (pendingCountError) {
		throw new Error(`load pending review count failed: ${pendingCountError.message}`);
	}

	const { data: candidateRows, error: candidateError } = await supabase
		.from("memory_candidates")
		.select("id, candidate_type, candidate_text, context, created_at, metadata")
		.eq("status", "pending_review")
		.order("created_at", { ascending: false })
		.limit(3);
	if (candidateError) {
		throw new Error(`load review candidates failed: ${candidateError.message}`);
	}

	const { count: recentEventCount, error: eventCountError } = await supabase
		.from("events")
		.select("id", { count: "exact", head: true })
		.gte("created_at", since);
	if (eventCountError) {
		throw new Error(`load recent event count failed: ${eventCountError.message}`);
	}

	const { count: redactedEventCount, error: redactedCountError } = await supabase
		.from("events")
		.select("id", { count: "exact", head: true })
		.gte("created_at", since)
		.eq("sensitivity", "secret_redacted");
	if (redactedCountError) {
		throw new Error(`load redacted event count failed: ${redactedCountError.message}`);
	}

	return {
		pendingReviewCount: pendingReviewCount ?? 0,
		recentEventCount: recentEventCount ?? 0,
		redactedEventCount: redactedEventCount ?? 0,
		candidates: (candidateRows ?? []).map((row) => ({
			id: row.id as string,
			title: titleFromCandidate(row as Record<string, unknown>),
			candidate_type: row.candidate_type as string,
			context: row.context as string,
			created_at: row.created_at as string,
		})),
	};
}

export async function sendTelegramMessage({
	botToken,
	chatId,
	text,
	fetchImpl = fetch,
}: TelegramSendInput): Promise<TelegramSendResult> {
	const response = await fetchImpl(
		`https://api.telegram.org/bot${botToken}/sendMessage`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				text,
				disable_web_page_preview: true,
			}),
		},
	);
	const contentType = response.headers.get("content-type") ?? "";
	const body = contentType.includes("application/json")
		? await response.json()
		: await response.text();
	return { ok: response.ok, status: response.status, body };
}

export async function deliverDailyDigest(
	supabase: SupabaseClient,
	env: Pick<typeof Deno.env, "get"> = Deno.env,
): Promise<{ snapshot: DailyDigestSnapshot; text: string; telegram: TelegramSendResult }> {
	const botToken = env.get("TELEGRAM_BOT_TOKEN")?.trim();
	const chatId = env.get("TELEGRAM_CHAT_ID")?.trim();
	if (!botToken || !chatId) {
		throw new Error("missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
	}

	const snapshot = await fetchDailyDigestSnapshot(supabase);
	const text = formatDailyDigest(snapshot);
	const telegram = await sendTelegramMessage({ botToken, chatId, text });
	if (!telegram.ok) {
		throw new Error(`telegram sendMessage failed: HTTP ${telegram.status}`);
	}
	return { snapshot, text, telegram };
}
