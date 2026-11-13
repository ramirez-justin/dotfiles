import { describe, expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Match sibling installed-package tests; they mutate the agent-dir env var.
const agentDir = join(homedir(), ".pi", "agent");
const approval = await import(pathToFileURL(join(
  agentDir, "npm/node_modules/pi-mcp-adapter/tool-approval.ts",
)).href);
const config = JSON.parse(readFileSync(
  new URL("../mcp-adapter.json", import.meta.url), "utf8",
));

// Reviewed mutation semantics, not destructiveHint-based classification.
const writes = {
  linear: [
    "prepare_attachment_upload", "prepare_file_upload",
    "create_attachment_from_upload", "create_attachment",
    "delete_attachment", "save_comment", "delete_comment",
    "save_document", "save_issue", "save_issue_label",
    "create_issue_label", "retire_issue_label", "restore_issue_label",
    "save_project", "retire_project_label", "restore_project_label",
    "save_project_label", "save_release", "save_release_note",
    "share_issue", "unshare_issue", "save_milestone", "mark_notification",
    "save_diff_comment", "resolve_diff_thread", "delete_diff_comment",
    "submit_diff_review", "update_diff", "merge_diff", "save_initiative",
    "save_initiative_label", "create_initiative_label",
    "retire_initiative_label", "restore_initiative_label",
    "save_status_update", "delete_status_update",
  ],
  notion: [
    "notion-create-attachment", "notion-create-file-upload",
    "notion-create-pages", "notion-update-page", "notion-delete-pages",
    "notion-delete-databases", "notion-restore-pages",
    "notion-convert-page-to-skill", "notion-upload-skill",
    "notion-update-skill-settings", "notion-complete-mcp-setup",
    "notion-move-pages", "notion-duplicate-page", "notion-create-database",
    "notion-create-folder", "notion-update-folder",
    "notion-update-data-source", "notion-create-comment",
    "notion-update-comment", "notion-delete-comment",
    "notion-set-discussion-resolved", "notion-set-comment-reaction",
    "notion-create-suggested-edit", "notion-resolve-suggested-edit",
    "notion-spawn-session", "notion-stop-session",
    "notion-send-message-to-session", "notion-create-view",
    "notion-update-view", "notion-restore-version",
    "notion-update-sidebar-tabs", "notion-update-page-favorites",
    "notion-calendar-create-events", "notion-calendar-update-events",
    "notion-calendar-cancel-events",
    "notion-link-meeting-note-to-calendar-event",
    "notion-convert-to-meetings-database", "notion-create-meeting-note",
  ],
};

const reads = {
  linear: [
    "get_issue", "list_issues", "search_documentation", "extract_images",
    "get_diff_threads", "get_notifications", "whoami",
  ],
  notion: [
    "notion-search", "notion-memory-search", "notion-fetch",
    "notion-get-tool-access", "notion-download-attachment",
    "notion-download-skill", "notion-query-data-sources",
    "notion-query-multiple-data-sources", "notion-list-private-pages",
    "notion-read-session-event", "notion-wait-session",
    "notion-calendar-list-events", "notion-view-version",
    "read_notion_page",
  ],
};

function meta(server: string, originalName: string) {
  return {
    name: `${server}_${originalName}`,
    originalName,
    description: "Synthetic approval test",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: false, destructiveHint: false },
  };
}

function stateFor(decision?: string) {
  const prompts: string[] = [];
  const state = {
    config: structuredClone(config),
    toolMetadata: new Map(),
    approvedToolCalls: new Map(),
    approvedServers: new Map(),
    ui: {
      select: async (prompt: string) => {
        prompts.push(prompt);
        return decision;
      },
    },
  };
  return { state, prompts };
}

for (const [server, names] of Object.entries(writes)) {
  describe(`${server} mutations`, () => {
    for (const name of names) {
      test(`${name} requires approval even if non-destructive`, () => {
        expect(approval.isToolCallApprovalRequired(
          config, server, meta(server, name),
        )).toBe(true);
      });
    }
  });
}

for (const [server, names] of Object.entries(reads)) {
  describe(`${server} reads`, () => {
    for (const name of names) {
      test(`${name} does not require approval`, () => {
        expect(approval.isToolCallApprovalRequired(
          config, server, meta(server, name),
        )).toBe(false);
      });
    }
  });
}

for (const [server, name] of [
  ["linear", "save_issue"], ["notion", "notion-update-page"],
]) {
  describe(`${server} native gate`, () => {
    const tool = meta(server, name);
    const args = { content: "inert fixture" };

    test("read does not open a dialog", async () => {
      const { state, prompts } = stateFor("Deny");
      const result = await approval.ensureToolCallApproved(
        state, server, meta(server, reads[server as keyof typeof reads][0]),
        {},
      );
      expect(result.ok).toBe(true);
      expect(prompts).toHaveLength(0);
    });

    for (const choice of ["Deny", undefined]) {
      test(`denial or cancellation blocks: ${choice}`, async () => {
        const { state, prompts } = stateFor(choice);
        const result = await approval.ensureToolCallApproved(
          state, server, tool, args,
        );
        expect(result).toMatchObject({ ok: false, reason: "denied" });
        expect(prompts).toHaveLength(1);
      });
    }

    test("fresh headless mutation fails closed", async () => {
      const { state } = stateFor();
      const result = await approval.ensureToolCallApproved(
        { ...state, ui: undefined }, server, tool, args,
      );
      expect(result).toEqual({
        ok: false, reason: "approval_required_headless",
      });
    });

    test("approval permits the configured mutation", async () => {
      const { state, prompts } = stateFor("Allow once");
      expect((await approval.ensureToolCallApproved(
        state, server, tool, args,
      )).ok).toBe(true);
      expect(prompts).toHaveLength(1);
    });
  });
}

test("omits namespace wrappers while preserving gateway and direct tools", async () => {
  const root = join(agentDir, "npm/node_modules/pi-mcp-adapter");
  const piBin = Bun.which("pi");
  if (!piBin) throw new Error("pi is not on PATH; install it with mise");
  const piEntry = Bun.resolveSync(
    "@earendil-works/pi-coding-agent", dirname(realpathSync(piBin)),
  );
  const peers = {
    typebox: Bun.resolveSync("typebox", piEntry),
    "@earendil-works/pi-tui": Bun.resolveSync("@earendil-works/pi-tui", piEntry),
  };
  // Mirror Pi's loader-supplied peers, as in model-tiers.test.ts.
  Bun.plugin({
    name: "mcp-namespace-pi-peers",
    setup(build) {
      build.onLoad({ filter: /\/pi-mcp-adapter\/.*\.ts$/ }, args => {
        let contents = readFileSync(args.path, "utf8");
        for (const [name, entry] of Object.entries(peers)) {
          contents = contents.replaceAll(JSON.stringify(name), JSON.stringify(entry));
        }
        return { contents, loader: "ts" };
      });
    },
  });
  const { syncNamespaceProxyTools } = await import(
    pathToFileURL(join(root, "namespace-tools.ts")).href
  );
  const { computeServerHash } = await import(
    pathToFileURL(join(root, "metadata-cache.ts")).href
  );
  // Inert metadata keeps registration offline; no cache or server is opened.
  const cache = {
    version: 1,
    servers: Object.fromEntries(Object.entries(config.mcpServers).map(
      ([name, definition]) => [name, {
        configHash: computeServerHash(definition),
        cachedAt: Date.now(),
        tools: [{ name: "get_fixture", inputSchema: { type: "object" } }],
      }],
    )),
  };
  const common = {
    cache,
    envOverride: null,
    existingDirectNames: new Set(["existing_direct_tool"]),
    getState: () => null,
    getInitPromise: () => null,
    getPiTools: () => [],
    executeCall: () => { throw new Error("Unexpected tool execution"); },
  };
  const wrappers: string[] = [];
  syncNamespaceProxyTools({
    ...common,
    config: { ...config, settings: { ...config.settings, namespaceProxyTools: true } },
    existingNamespaceNames: new Set(),
    pi: { registerTool: (tool: { name: string }) => wrappers.push(tool.name) },
  });
  expect(wrappers.sort()).toEqual([
    "mcp__chalk", "mcp__gmail", "mcp__jira", "mcp__linear", "mcp__notion",
  ]);

  let active = ["mcp", "existing_direct_tool", ...wrappers];
  const registered: string[] = [];
  const result = syncNamespaceProxyTools({
    ...common,
    config,
    existingNamespaceNames: new Set(wrappers),
    pi: {
      registerTool: (tool: { name: string }) => registered.push(tool.name),
      getActiveTools: () => active,
      setActiveTools: (names: string[]) => { active = names; },
    },
  });
  expect(result.specs).toEqual([]);
  expect(registered).toEqual([]);
  expect(active).toEqual(["mcp", "existing_direct_tool"]);
});
