import assert from "node:assert/strict";
import { redactSecrets } from "./redact.ts";

Deno.test("redactSecrets redacts OpenAI-style keys", () => {
	const result = redactSecrets(
		"key is " + "s" + "k-" + "testabcdefghijklmnopqrstuvwxyz123456",
	);
	assert.equal(result.redacted, true);
	assert.equal(result.content.includes("s" + "k-" + "test"), false);
	assert.equal(result.content.includes("[REDACTED_SECRET:openai_key]"), true);
	assert.deepEqual(result.labels, ["openai_key"]);
});

Deno.test("redactSecrets redacts bearer tokens", () => {
	const result = redactSecrets(
		"Authorization: Bearer abcdefghijklmnopqrstuvwxyz.1234567890",
	);
	assert.equal(result.redacted, true);
	assert.equal(
		result.content,
		"Authorization: Bearer [REDACTED_SECRET:bearer_token]",
	);
});

Deno.test("redactSecrets redacts private keys", () => {
	const result = redactSecrets(
		"-----BEGIN " +
			"PRIVATE " +
			"KEY-----\nabc\n-----END " +
			"PRIVATE " +
			"KEY-----",
	);
	assert.equal(result.redacted, true);
	assert.equal(result.content, "[REDACTED_SECRET:private_key]");
});

Deno.test("redactSecrets leaves normal text unchanged", () => {
	const result = redactSecrets("SOFIA should use Supabase as a cloud target.");
	assert.equal(result.redacted, false);
	assert.deepEqual(result.labels, []);
	assert.equal(result.content, "SOFIA should use Supabase as a cloud target.");
});
