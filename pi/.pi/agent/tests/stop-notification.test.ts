import { describe, expect, test } from "bun:test";
import { startsAuthCommand } from "../extensions/stop-notification.ts";

describe("auth command sound", () => {
	test("recognizes agent-initiated AWS and 1Password commands", () => {
		for (const command of [
			"aws-vault exec justin.ramirez -- aws sts get-caller-identity",
			"aws-me -- aws sts get-caller-identity",
			"zsh -ic 'aws-me -- aws sts get-caller-identity'",
			"op read 'op://vault/item/field'",
			"export TOKEN=$(op read 'op://vault/item/field')",
			"op run -- command",
			"op signin",
		]) {
			expect(startsAuthCommand(command)).toBe(true);
		}
	});

	test("ignores inspection, quoted examples, and non-auth operations", () => {
		for (const command of [
			"rg -n 'op read' .",
			"echo 'aws-vault exec example'",
			"printf 'aws-me -- example'",
			"op --version",
			"aws-vault list",
			"aws sts get-caller-identity",
		]) {
			expect(startsAuthCommand(command)).toBe(false);
		}
	});
});
