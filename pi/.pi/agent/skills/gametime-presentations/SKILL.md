---
name: gametime-presentations
description: >-
  Create or restyle Gametime-branded browser slide decks with speaker notes,
  screenshot-led walkthroughs, and verified technical examples. Use when the
  user requests a Gametime presentation, internal demo deck, or brand refresh
  of existing slides; not for general websites or product UI.
metadata:
  status: experimental
---

# Gametime Presentations

Experimental skill. Validate each deck; report gaps in this workflow.

## Scope and references

Use this skill for internal Gametime browser presentations. Do not publish,
commit, push, upload, or share externally without the applicable approval.
Keep confidential content out of public repositories and hosted previews.

Resolve these paths relative to this skill directory:

- `references/brand.md`: brand sources, palette, typography, asset limits.
- `assets/template.html`: reusable native HTML/CSS/JavaScript starting point.
- `assets/gametime-ticket.png`: approved ticket mark from the Brand Hub.

The template is an example, not a generator. Read it before editing. Reuse an
existing deck when appropriate; do not replace unrelated user changes.

## Intake and evidence

1. Establish audience, duration, goal, output location, and sharing boundary.
   Reuse answers already supplied. Recommend browser slides with notes when
   the user has not chosen another medium.
2. Read applicable repository instructions and source documentation. For
   technical claims, trace relevant implementation and verify PR status.
   Separate current, pending, illustrative, and unverified behavior.
3. Read the brand reference. Refresh the cited Notion sources when a brand
   change is requested or exact compliance matters. Do not silently treat
   drafted design-system guidance as approved brand policy.
4. Agree on the outline and substantial design choices in chat. Keep the
   process proportional; small approved deck edits need no new design cycle.

## Build the deck

- Use native HTML/CSS/JavaScript. No framework, CDN, analytics, package
  installation, or new build pipeline unless genuinely needed and approved.
- Use the documented palette and local brand fonts. Bundle only assets whose
  use and distribution are permitted; follow `references/brand.md`.
- Prefer an offline, self-contained final HTML file when practical. If images
  or fonts remain separate, keep relative paths and state which assets must
  travel with the deck. Never retain expiring signed URLs or access tokens.
- Use one clear idea per slide, bounded reading widths, and generous but
  intentional spacing. Center coherent content groups vertically. Do not
  pin callouts to the bottom with large empty gaps above them.
- Scale typography to both viewport width and height. Give sparse slides
  stronger hierarchy rather than stretching their blocks apart. Do not fix
  overflow merely by making all text tiny.
- Break long UI procedures into screenshot-led steps. Use real approved
  screenshots, meaningful alt text, short instructions, and a full-size view
  when helpful. Note outdated UI/runtime details; do not alter screenshots
  to imply behavior that was never verified.
- For feature demos, show a practical AI prompt, command/config example,
  expected outcome, and the important limitation. Clearly distinguish
  preparing reviewable changes from applying infrastructure or running jobs.
- Put operational detail and source provenance in notes or an appendix, not
  dense main slides. Never claim local checks are mandatory without evidence.
- Include time ranges and a prepared fallback for live demos. Budget Q&A and
  keep the agenda and notes consistent after adding or moving slides.
- Preserve arrow-key/button navigation, hash deep links, a live slide counter,
  a notes toggle, focus visibility, reduced-motion support, and print layout.
  Notes are visible on the shared slide, not a separate presenter window;
  warn the presenter to hide them while sharing.

## Verification before delivery

Use installed tools; do not install browser automation just for the deck.

1. Check HTML structure, unique IDs, slide order/count, image paths/alt text,
   no accidental remote resources, and inline JavaScript syntax.
2. Open the actual deck in a browser. Wait for fonts and images. Test arrow
   keys, buttons, first/last boundaries, hash routes, notes, and reduced
   motion.
3. Measure every slide at representative desktop and narrow viewports. Include
   a short browser viewport such as 1366 by 625 as well as 1920 by 1080.
   Browser window size is not necessarily the inner viewport size. Check
   horizontal and vertical overflow and code/table clipping. Narrow layouts
   may scroll vertically; all content and controls must remain reachable.
4. Inspect representative screenshots: title, text-heavy, code/config, UI
   walkthrough, and appendix. Check spacing, contrast, and legibility, not
   just DOM dimensions. Distinguish diagram categories in their legend too.
5. Check print rendering exposes all slides and hides controls. Notes should
   print only when requested. Do not claim PDF page counts without checking.
6. Check the final content against the request, timing, and current evidence.
   Report gaps rather than presenting assumptions as tested behavior.

## Handoff

Report the file path, how to open it, controls, verification, required sibling
assets, and limitations. Do not open PRs or deploy/publish as a hidden side
effect. Keep task-specific plans out of the final deliverable.
