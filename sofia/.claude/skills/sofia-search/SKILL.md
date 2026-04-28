---
name: sofia-search
description: Hybrid search across the SOFIA vault. Wraps the `sofia search` CLI and formats results as a ranked list with snippets and clickable Obsidian URIs. Use whenever the user asks "what did I write/decide/plan about X", "search my notes for Y", or any retrieval over the vault. Pass through context (personal/work) and type filters.
---

You are running a search over the SOFIA second brain vault.

**Inputs:**
- `query`: the user's query (required)
- Optional flags: `--context personal|work|both`, `--type memory|daily|plan|inbox|project`, `--limit N`

**Steps:**

1. Resolve `$SOFIA_VAULT` and confirm the `sofia` CLI is on `$PATH` (`command -v sofia` should find it; otherwise instruct the user to run `mise run link`).
2. Build the command. Always pass `--json` so we can format consistently:
   ```bash
   sofia search "<query>" [--context X] [--type Y] [--limit N] --json
   ```
3. If the user did not specify `--context`, infer it: use `$SOFIA_CONTEXT` env, otherwise check `$PWD` (anything under `~/telophaseqs` or `*/SOFIA/*/work/*` → `work`, else `personal`). Default to `personal`.
4. Execute the command via Bash. Capture stdout.
5. Parse the JSON. For each result, render:
   ```
   N. <path>  [<context>/<type>]  score=X.XX
      ## <heading>
      <snippet>
      → obsidian://open?vault=SOFIA&file=<URL-encoded path without leading dir>
   ```
6. If results > 0, optionally synthesize a 1-sentence summary across the top 3-5 results (only if the user's query is a question, not a literal grep).
7. If results = 0, suggest a broader query, switching context, or running `/sofia-status` to see what's indexed.

**Failure modes:**
- `sofia search` exits non-zero with "no index yet" → instruct the user to run `mise run sofia-init` then `sofia index`.
- Empty results → see step 7.

**Don't** filter or post-process results beyond what the CLI returned. Trust the ranking.
