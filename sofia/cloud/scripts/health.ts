type CheckStatus = "ok" | "warn" | "fail";

type CommandResult = {
	code: number;
	stdout: string;
	stderr: string;
};

export function buildSofiaEndpoint(projectRef: string): string {
	return `https://${projectRef}.supabase.co/functions/v1/sofia-core`;
}

export function parseProjectStatus(output: string, projectRef: string): string | null {
	try {
		const projects = JSON.parse(output);
		if (!Array.isArray(projects)) return null;
		const project = projects.find((row) => {
			if (!row || typeof row !== "object") return false;
			const record = row as Record<string, unknown>;
			return record.ref === projectRef || record.id === projectRef;
		});
		if (!project || typeof project !== "object") return null;
		const status = (project as Record<string, unknown>).status;
		return typeof status === "string" ? status : null;
	} catch {
		return null;
	}
}

export function classifyEdgeStatus(status: number): { ok: boolean; message: string } {
	if (status === 401 || status === 403) {
		return { ok: true, message: "reachable; authentication required" };
	}
	if (status === 521) {
		return {
			ok: false,
			message: "Cloudflare 521; project may still be restoring",
		};
	}
	if (status >= 200 && status < 300) {
		return { ok: true, message: `reachable; HTTP ${status}` };
	}
	return { ok: false, message: `unexpected HTTP ${status}` };
}

export function formatCheck(status: CheckStatus, name: string, message: string): string {
	return `[${status}] ${name}: ${message}`;
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
	const child = new Deno.Command(command, { args }).output();
	const output = await child;
	const decoder = new TextDecoder();
	return {
		code: output.code,
		stdout: decoder.decode(output.stdout).trim(),
		stderr: decoder.decode(output.stderr).trim(),
	};
}

async function resolveProjectRef(): Promise<string | null> {
	const envRef = Deno.env.get("SUPABASE_SOFIA_PROJECT_REF")?.trim();
	if (envRef) return envRef;
	const result = await runCommand("op", [
		"read",
		"op://dev_vault/Supabase SOFIA/project id",
	]);
	if (result.code !== 0) return null;
	return result.stdout.trim() || null;
}

async function httpStatus(url: string, headers: Record<string, string> = {}): Promise<number | null> {
	try {
		const response = await fetch(url, { headers });
		await response.body?.cancel();
		return response.status;
	} catch {
		return null;
	}
}

async function main(): Promise<void> {
	let failures = 0;
	const print = (status: CheckStatus, name: string, message: string) => {
		if (status === "fail") failures += 1;
		console.log(formatCheck(status, name, message));
	};

	const projectRef = await resolveProjectRef();
	if (!projectRef) {
		print(
			"fail",
			"project ref",
			"missing; set SUPABASE_SOFIA_PROJECT_REF or reauthenticate 1Password CLI",
		);
		Deno.exit(1);
	}
	print("ok", "project ref", projectRef);

	const projects = await runCommand("supabase", ["projects", "list", "--output", "json"]);
	if (projects.code !== 0) {
		print("fail", "supabase projects", projects.stderr || "command failed");
	} else {
		const status = parseProjectStatus(projects.stdout, projectRef);
		if (!status) {
			print("fail", "supabase project", "project ref not found in `supabase projects list`");
		} else if (status === "ACTIVE_HEALTHY") {
			print("ok", "supabase project", status);
		} else {
			print("fail", "supabase project", `${status}; restore/wait before using SOFIA boot context`);
		}
	}

	const host = `${projectRef}.supabase.co`;
	const dns = await runCommand("dscacheutil", ["-q", "host", "-a", "name", host]);
	if (dns.code === 0 && dns.stdout.includes("ip_address")) {
		print("ok", "dns", `${host} resolves`);
	} else {
		print("fail", "dns", `${host} did not resolve; project may be inactive/restoring`);
	}

	const endpoint = buildSofiaEndpoint(projectRef);
	const unauthenticatedStatus = await httpStatus(endpoint);
	if (unauthenticatedStatus == null) {
		print("fail", "edge function", "request failed; check network or Supabase status");
	} else {
		const classified = classifyEdgeStatus(unauthenticatedStatus);
		print(classified.ok ? "ok" : "fail", "edge function", classified.message);
	}

	const accessKey = Deno.env.get("SOFIA_MCP_ACCESS_KEY")?.trim();
	if (!accessKey) {
		print(
			"fail",
			"SOFIA_MCP_ACCESS_KEY",
			"missing; source ~/.pi/agent/env.zsh or reauthenticate 1Password CLI",
		);
	} else {
		print("ok", "SOFIA_MCP_ACCESS_KEY", "set");
		const bootStatus = await httpStatus(`${endpoint}/boot-context?context=personal`, {
			"x-sofia-key": accessKey,
		});
		if (bootStatus === 200) {
			print("ok", "boot context", "authenticated personal boot context returned HTTP 200");
		} else if (bootStatus === 401 || bootStatus === 403) {
			print("fail", "boot context", `HTTP ${bootStatus}; SOFIA_MCP_ACCESS_KEY is invalid`);
		} else if (bootStatus === 521) {
			print("fail", "boot context", "Cloudflare 521; project may still be restoring");
		} else if (bootStatus == null) {
			print("fail", "boot context", "request failed; check network or Supabase status");
		} else {
			print("fail", "boot context", `unexpected HTTP ${bootStatus}`);
		}
	}

	if (failures > 0) {
		console.log("\nRecovery: see sofia/cloud/RUNBOOK.md");
		Deno.exit(1);
	}
}

if (import.meta.main) {
	await main();
}
