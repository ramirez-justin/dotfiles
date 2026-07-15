# Pi Setup Presentation Design

## Goal

Create a self-contained browser presentation that explains Justin's Pi setup to
teammates who already use coding agents through Claude Code or Codex. The deck
must make the setup reproducible while emphasizing quality and safety.

## Constraints

- Fit a 10–15 minute live talk.
- Require no live demo.
- Work as a static browser presentation with no build step.
- Avoid secrets, internal identifiers, and sensitive configuration values.
- Use only claims supported by repository configuration or Pi documentation.

## Narrative

Use an architecture story rather than a file-by-file tour:

1. Establish the premise: Pi is a configurable coding-agent harness.
2. Show the setup as layers, from reproducible dotfiles to workflows.
3. Explain the quality loop and explicit approval boundaries.
4. End with portable ideas teammates can apply to any coding agent.

## Slide Outline

1. **My Pi setup** — title and thesis.
2. **The idea** — the model is one component; the harness supplies the system.
3. **The stack** — configuration, instructions, skills, tools, and workflows.
4. **Reproducible by default** — Git, GNU Stow, mise, and 1Password.
5. **A small core, composed** — packages and their responsibilities.
6. **Instructions encode judgment** — project rules and safety boundaries.
7. **Skills encode process** — brainstorm, plan, implement, debug, and verify.
8. **Subagents divide responsibility** — explore, plan, implement, review,
   and verify with model tiers.
9. **Tools meet the work** — LSP, AST search, MCP, context management, and
   workspace integrations.
10. **The quality loop** — inspect, plan, change narrowly, diagnose, test,
    review, and verify.
11. **What is portable** — patterns teammates can adopt in Claude Code or
    Codex.
12. **Takeaway** — configuration is less important than explicit process and
    evidence.

## Visual Direction

Use a dark Rose Pine-inspired theme to match the configured Pi theme. Favor
large typography, architecture diagrams, short labels, and restrained code
snippets. Use progressive visual layers rather than dense bullet lists.

The deck will support keyboard, click, and touch navigation. A progress bar,
slide count, overview mode, and speaker notes will make it practical to present.

## Deliverables

- `docs/presentations/pi-setup/index.html`: self-contained presentation.
- `docs/presentations/pi-setup/README.md`: launch and navigation instructions.

## Verification

- Confirm the HTML parses and contains no external runtime dependency.
- Check keyboard and button navigation behavior.
- Check responsive rendering at desktop and mobile viewport sizes.
- Search the deck for secret-like values and unsupported claims.
- Confirm the deck remains readable without JavaScript.
