# Gametime presentation brand reference

This is a reusable implementation reference, not a brand-compliance review.
The sources below were inspected while preparing an internal notebook demo.
Refresh them if current brand policy or exact compliance matters.

## Source hierarchy

1. Creative Team Brand Hub identifies approved assets and lists Inter and
   Abridge. Its content describes branding updated September 2025.
2. Design System and Claude links Stagecraft typography and color
   documentation. It describes strategy and drafted token work, not a
   completed certification process.
3. Stagecraft colors provides the palette used below; Stagecraft typography
   identifies Inter as the primary UI family and explains heading/body
   hierarchy.

Do not use the unfinished "Brand OS (Claude Output - Needs Work!!)" pages
as the authority for missing specifications. If sources conflict, explain the
conflict and ask which approved guidance to follow.

Internal links are intentionally omitted from this public repository.
Locate these sources internally when current guidance is needed.

## Palette

| Role | Value | Documented name |
| --- | --- | --- |
| Page | `#010314` | setlist-black |
| Slide surface | `#0a0d10` | cinema-black |
| Card | `#1c1c20` | gray-950 |
| Nested surface | `#26262b` | gray-900 |
| Border | `#313136` | gray-800 |
| Main text | `#f9f9fa` | gray-50 |
| Supporting text | `#dfe2e7` | gray-200 |
| Metadata | `#a3a8b5` | gray-400 |
| Primary accent | `#19ce85` | brand green-500 |
| Soft accent | `#72eebc` | brand green-300 |
| Dark accent | `#0d6e50` | brand green-900 |
| Warning | `#fac400` | system yellow |
| Information | `#669bc4` | system blue |
| Danger | `#e95345` | system red |

Use semantic CSS variables rather than scattered hex values. Use dark text
on bright green/yellow badges and buttons. Maintain WCAG AA contrast for
body text; do not assume every token combination is accessible.

For diagrams, use clearly distinct hues and text labels. The notebook demo
used yellow for IDE/agent, blue for Snowsight, gray for GitHub, and green for
Airflow. These category assignments are presentation choices, not brand rules.

## Typography and licensed assets

- Use Abridge Bold for display headings, Abridge Medium for small display
  labels, and Inter for body text. This is the deck treatment, not a claim
  that Stagecraft mandates Abridge headings for all product UI.
- Keep monospace for code and identifiers. Font metrics affect slide layout:
  wait for fonts before measuring and verify the fallback rendering too.
- The template uses local font faces and system fallbacks. On Justin's Mac,
  approved fonts were available under `~/Library/Fonts/` as
  `Inter-VariableFont_opsz,wght.ttf`, `Abridge-Bold.otf`, and
  `Abridge-Medium.otf`. Availability elsewhere is not guaranteed.
- Do not commit proprietary font binaries or extracted subsets to dotfiles.
  A font file's embedding flags alone are not a redistribution license.
  Confirm license/permissions before embedding in a private deliverable;
  otherwise use installed fonts or explicitly disclose the fallback.
- If embedding/subsetting is permitted, include every character needed by
  the final deck and notes. Re-subset when text changes; a subset built for
  one presentation is not a reusable font library.

`assets/gametime-ticket.png` is the actual green ticket mark referenced by
the Brand Hub's custom icon, resized proportionally for presentations. It
is a Gametime trademark, not newly licensed artwork. Use it only for
appropriate Gametime work; do not imply permission to republish other brand
assets. Never redraw an approximation or invent a wordmark.

The source asset is the Brand Hub icon named
`Gametime_Logo_Export_Gametime_Ticket_Green.png`; retrieve updated assets
through the Brand Hub, not by persisting signed download links.

## Composition

Prefer strong headings, restrained green accents, dark cards, clear grids,
and meaningful whitespace. Keep related blocks together. Avoid top-heavy
slides, bottom-pinned callouts, huge internal gaps, cramped code, and several
near-identical gray category colors.

The reusable template is deliberately neutral about technical content.
Notebook commands, roles, schedules, PR states, and infrastructure approvals
must come from the target project's verified sources, never this skill.
