# Pi Context7 MCP Integration Design

## Goal

Add Context7 documentation lookup to global pi sessions through the dotfiles-managed pi configuration. The integration should improve documentation awareness for third-party libraries and frameworks without adding custom MCP protocol code to this dotfiles repo.

## Approach

Use the existing `pi-mcp-adapter` extension, configured by an `mcp.json` file, with Context7 as the first MCP server. This is more pi-friendly than writing a custom Context7-only extension because pi already supports extensions/packages, while MCP server details stay declarative in config.

## Architecture

The dotfiles repo owns the global pi configuration under `pi/.pi/agent/`. GNU Stow links that topic into `~/.pi/agent/` via the existing `mise run link` workflow.

The integration will add:

- A global pi package/extension entry for `pi-mcp-adapter` in `pi/.pi/agent/settings.json`, after verifying the exact trusted npm or git package source during implementation.
- A dotfiles-managed `pi/.pi/agent/mcp.json` containing a `context7` MCP server definition.
- A short instruction in `pi/.pi/agent/AGENTS.md` encouraging Context7 use for third-party or version-sensitive documentation.

At runtime, pi loads `pi-mcp-adapter`, the adapter reads `mcp.json`, starts the Context7 MCP server when needed, and exposes Context7 tools to the agent as pi-callable tools.

## Configuration

Context7 should track the latest published package by using `npx -y`:

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

This favors low maintenance and current docs tooling. The trade-off is that upstream Context7 changes could alter behavior without a dotfiles change. If that becomes a problem, the package can be pinned in `mcp.json` later.

## Usage

Once loaded, pi agents can use Context7 on demand during coding sessions to resolve libraries and fetch relevant documentation. The global instruction should tell agents to prefer Context7 when working with external libraries, frameworks, unfamiliar APIs, or version-sensitive behavior.

The integration should not force Context7 use for every task. It is most useful when documentation freshness matters.

## Error Handling

Failure modes should be non-fatal:

- If `npx`, network access, or package installation fails, the Context7 tool call should return a clear error while pi continues working.
- If Context7 cannot resolve a library, the agent should ask for a more specific library/package name or fall back to local docs and repository files.
- No secrets are required.

Because `npx -y @upstash/context7-mcp` runs npm-distributed code, this integration has an explicit trust boundary: only use it if the `@upstash/context7-mcp` package and the adapter source are trusted.

## Verification

Implementation should verify:

1. `mise run link` exposes the new pi files under `~/.pi/agent/`.
2. A fresh pi session or `/reload` loads `pi-mcp-adapter` without errors.
3. Context7 tools are available to the agent.
4. A test prompt can retrieve docs for a known library, such as React `useEffect`.
5. Existing pi behavior remains intact, including theme, superpowers skills, model settings, and other packages.

## Out of Scope

- Building a custom MCP adapter.
- Adding multiple MCP servers beyond Context7.
- Pinning Context7 to a specific version initially.
- Adding secrets or private documentation sources.
