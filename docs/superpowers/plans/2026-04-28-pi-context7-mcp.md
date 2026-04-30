# Pi Context7 MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Context7 documentation lookup to global pi sessions through the dotfiles-managed pi configuration.

**Architecture:** Install `pi-mcp-adapter` as a global pi package from `pi/.pi/agent/settings.json`. Configure Context7 in dotfiles-managed `pi/.pi/agent/mcp.json` using `npx -y @upstash/context7-mcp`, and add a global agent instruction so pi uses Context7 for third-party/version-sensitive docs.

**Tech Stack:** pi packages/extensions, `pi-mcp-adapter` npm package, MCP JSON config, Context7 MCP server, GNU Stow via `mise run link`, `jq` for JSON validation.

---

## File Structure

- Modify `pi/.pi/agent/settings.json`: add `npm:pi-mcp-adapter` to the existing global pi `packages` array.
- Create `pi/.pi/agent/mcp.json`: configure the `context7` MCP server and promote its tools directly because Context7 has a small tool surface.
- Modify `pi/.pi/agent/AGENTS.md`: add guidance to use Context7 for external library/framework documentation when freshness matters.
- No custom TypeScript extension files are needed.

---

### Task 1: Verify adapter and Context7 package metadata

**Files:**
- Read only: npm registry metadata

- [ ] **Step 1: Verify `pi-mcp-adapter` package metadata**

Run:

```bash
cd ~/Repositories/dotfiles
mise exec node@20 -- npm view pi-mcp-adapter name version description repository.url pi --json
```

Expected: output includes `"name": "pi-mcp-adapter"`, a version, repository URL `git+https://github.com/nicobailon/pi-mcp-adapter.git`, and a `pi.extensions` entry containing `./index.ts`.

- [ ] **Step 2: Verify Context7 MCP package metadata**

Run:

```bash
cd ~/Repositories/dotfiles
mise exec node@20 -- npm view @upstash/context7-mcp name version description bin --json
```

Expected: output includes `"name": "@upstash/context7-mcp"`, a version, and package metadata showing it can run as an npm executable.

- [ ] **Step 3: Commit is not needed**

This task is read-only. Do not commit.

---

### Task 2: Add `pi-mcp-adapter` to global pi packages

**Files:**
- Modify: `pi/.pi/agent/settings.json`

- [ ] **Step 1: Update `settings.json`**

Edit `pi/.pi/agent/settings.json` so the `packages` array becomes:

```json
  "packages": [
    {
      "source": "git:https://github.com/obra/superpowers.git@v5.0.7",
      "skills": [
        "skills/brainstorming/**",
        "skills/writing-plans/**",
        "skills/executing-plans/**",
        "skills/systematic-debugging/**",
        "skills/test-driven-development/**",
        "skills/verification-before-completion/**",
        "skills/finishing-a-development-branch/**",
        "skills/receiving-code-review/**",
        "skills/requesting-code-review/**",
        "skills/using-git-worktrees/**"
      ],
      "extensions": [],
      "prompts": [],
      "themes": []
    },
    "npm:@zenobius/pi-rose-pine",
    "npm:pi-mcp-adapter"
  ]
```

Leave all other settings unchanged.

- [ ] **Step 2: Validate JSON**

Run:

```bash
cd ~/Repositories/dotfiles
jq . pi/.pi/agent/settings.json >/dev/null
```

Expected: command exits 0 with no output.

- [ ] **Step 3: Inspect diff**

Run:

```bash
cd ~/Repositories/dotfiles
git diff -- pi/.pi/agent/settings.json
```

Expected: only the `packages` array changed, adding a comma after `"npm:@zenobius/pi-rose-pine"` and a new `"npm:pi-mcp-adapter"` entry.

- [ ] **Step 4: Commit settings change**

Run:

```bash
cd ~/Repositories/dotfiles
git add pi/.pi/agent/settings.json
git commit -m "feat(pi): add mcp adapter package"
```

Expected: commit succeeds.

---

### Task 3: Add global Context7 MCP config

**Files:**
- Create: `pi/.pi/agent/mcp.json`

- [ ] **Step 1: Create `mcp.json`**

Create `pi/.pi/agent/mcp.json` with this exact content:

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "lifecycle": "lazy",
      "directTools": true
    }
  }
}
```

- [ ] **Step 2: Validate JSON**

Run:

```bash
cd ~/Repositories/dotfiles
jq . pi/.pi/agent/mcp.json >/dev/null
```

Expected: command exits 0 with no output.

- [ ] **Step 3: Inspect diff**

Run:

```bash
cd ~/Repositories/dotfiles
git diff -- pi/.pi/agent/mcp.json
```

Expected: new file contains only the `context7` MCP server. `lifecycle` is `lazy`; `directTools` is `true` so Context7's small tool set can appear as direct pi tools after metadata is cached.

- [ ] **Step 4: Commit MCP config**

Run:

```bash
cd ~/Repositories/dotfiles
git add pi/.pi/agent/mcp.json
git commit -m "feat(pi): configure context7 mcp server"
```

Expected: commit succeeds.

---

### Task 4: Add Context7 usage guidance to global pi instructions

**Files:**
- Modify: `pi/.pi/agent/AGENTS.md`

- [ ] **Step 1: Add documentation-awareness guidance**

In `pi/.pi/agent/AGENTS.md`, add this section after `## Tool Preferences` and its bullets:

```markdown
## Documentation Awareness

- When working with third-party libraries, frameworks, SDKs, or version-sensitive APIs, prefer Context7 documentation lookup before relying on model memory.
- Use Context7 selectively when documentation freshness matters; do not call it for simple local-code questions where repository files already answer the question.
- If Context7 cannot resolve a library, ask for a more specific package/library name or fall back to local docs and repository files.
```

- [ ] **Step 2: Inspect diff**

Run:

```bash
cd ~/Repositories/dotfiles
git diff -- pi/.pi/agent/AGENTS.md
```

Expected: diff adds only the `Documentation Awareness` section.

- [ ] **Step 3: Commit instruction change**

Run:

```bash
cd ~/Repositories/dotfiles
git add pi/.pi/agent/AGENTS.md
git commit -m "docs(pi): prefer context7 for fresh library docs"
```

Expected: commit succeeds.

---

### Task 5: Link dotfiles and verify global files

**Files:**
- Verify live files: `~/.pi/agent/settings.json`, `~/.pi/agent/mcp.json`, `~/.pi/agent/AGENTS.md`

- [ ] **Step 1: Restow dotfiles**

Run:

```bash
cd ~/Repositories/dotfiles
mise run link
```

Expected: command succeeds. It may run Homebrew bundle first because the existing `link` task depends on `brew-install`.

- [ ] **Step 2: Verify live symlinks/files**

Run:

```bash
readlink ~/.pi/agent/settings.json
readlink ~/.pi/agent/mcp.json
readlink ~/.pi/agent/AGENTS.md
```

Expected: each path points into `/Users/justin/Repositories/dotfiles/pi/.pi/agent/`.

- [ ] **Step 3: Verify live config content**

Run:

```bash
jq '.packages' ~/.pi/agent/settings.json
jq '.mcpServers.context7' ~/.pi/agent/mcp.json
rg -n "Documentation Awareness|Context7" ~/.pi/agent/AGENTS.md
```

Expected:
- packages include `npm:pi-mcp-adapter`
- Context7 config shows `command: npx`, `args: ["-y", "@upstash/context7-mcp"]`, `lifecycle: lazy`, and `directTools: true`
- `AGENTS.md` contains the new Context7 guidance

- [ ] **Step 4: Commit is not needed**

This task changes live symlinks only. Do not commit.

---

### Task 6: Verify pi loads the adapter and Context7 works

**Files:**
- No repo file changes expected

- [ ] **Step 1: Let pi install/load packages in a non-interactive smoke test**

Run:

```bash
cd ~/Repositories/dotfiles
pi -p "Say 'pi context7 smoke test' and list your available MCP-related tool or command names if visible. Do not modify files."
```

Expected: pi starts without extension-load errors. If pi installs missing packages on startup, allow it to complete. The response should mention MCP availability or complete without errors.

- [ ] **Step 2: Populate Context7 metadata cache if needed**

Run:

```bash
cd ~/Repositories/dotfiles
pi -p "Use the MCP adapter to connect to the context7 server and describe or list the available Context7 tools. Do not modify files."
```

Expected: pi calls the MCP adapter, starts `npx -y @upstash/context7-mcp` lazily, and reports Context7 tools. If this is the first run, direct tools may become available only after metadata is cached and a later reload/session.

- [ ] **Step 3: Verify a documentation lookup**

Run:

```bash
cd ~/Repositories/dotfiles
pi -p "Use Context7 to look up React useEffect documentation. Summarize the key cleanup behavior in two bullet points. Do not modify files."
```

Expected: pi uses Context7/MCP and returns a React `useEffect` cleanup summary. If Context7 cannot resolve `React`, the response should ask for a more specific package name or explain the lookup failure clearly.

- [ ] **Step 4: Verify no unintended repo changes**

Run:

```bash
cd ~/Repositories/dotfiles
git status --short
```

Expected: no uncommitted changes from the verification commands.

---

### Task 7: Final review

**Files:**
- Review: `pi/.pi/agent/settings.json`, `pi/.pi/agent/mcp.json`, `pi/.pi/agent/AGENTS.md`

- [ ] **Step 1: Show final commit history for this change**

Run:

```bash
cd ~/Repositories/dotfiles
git log --oneline -5
```

Expected: recent commits include:
- `docs: design pi context7 mcp integration`
- `feat(pi): add mcp adapter package`
- `feat(pi): configure context7 mcp server`
- `docs(pi): prefer context7 for fresh library docs`

- [ ] **Step 2: Confirm final state**

Run:

```bash
cd ~/Repositories/dotfiles
git status --short
```

Expected: clean working tree.

- [ ] **Step 3: Report completion**

Summarize:
- adapter package added: `npm:pi-mcp-adapter`
- Context7 server configured: `npx -y @upstash/context7-mcp`
- global guidance added to `AGENTS.md`
- verification results from Task 6
