---
name: bragbook-maintenance
description: >-
  Audit and update Justin's Gametime Data Engineer P2 BragBook using completed
  work from Linear, GitHub, Notion, local repositories, and user-provided
  evidence, distilled against the Data Platform leveling guide.
---

# BragBook Maintenance

Use this skill when Justin asks to audit, extend, or update his Gametime
BragBook.

## Files

BragBook repository:

`/Users/justin/gametime/BragBook`

Primary document:

`Gametime/data_engineer_p2.md`

Keep extending the P2 document unless Justin explicitly requests another file.

## Defaults

- Use `June 2025 – Present` as the document period.
- Include completed outcomes only.
- Keep a clean narrative without evidence links.
- Preserve the chronological table and existing writing style.
- Map evidence to scope, autonomy, quality, influence, impact, and AI leverage.
- Do not claim a formal level or promotion decision.

Ask before changing any of these defaults.

## Evidence Audit

1. Read applicable repository instructions and the current BragBook.
2. Identify its latest coverage and existing entries.
3. Review completed Linear issues assigned to Justin.
4. Review authored and merged GitHub pull requests.
5. Review meaningful code-review activity across repositories.
6. Search connected Notion, Slack, or other read-only sources when useful.
7. Inspect relevant local git history for work absent from tracking systems.
8. Include user-provided work such as interviewing, mentoring, presentations,
   incident response, and informal enablement.
9. Separate verified evidence from user-provided context and inference.

Use context-mode for GitHub history, large command output, and data processing.

## Distillation Rules

- Group related tickets and pull requests into durable outcomes.
- Prefer end-to-end initiatives over task-level entries.
- Avoid counting the same work as separate platform, ingestion, and serving
  accomplishments unless they have distinct consumers and outcomes.
- Update an existing entry when work is a continuation of that initiative.
- Use standalone rows for materially distinct systems, standards, or business
  capabilities.
- Put interviewing, reviews, presentations, and mentoring under influence
  unless they produced a distinct reusable artifact.
- Exclude open, unmerged, canceled, or planning-only work from accomplishment
  claims.

## Claim Calibration

Do not claim:

- adoption without usage evidence;
- cost or time savings without measurements;
- business impact not demonstrated by the evidence;
- project ownership when Justin contributed but did not lead;
- future capacity or outcomes as completed impact.

Prefer wording such as:

- "delivered capabilities for";
- "made available through";
- "established a repeatable pattern";
- "contributed to";
- "reduced coupling";
- "made failures visible before merge."

## Editorial Workflow

1. Present the proposed rows, existing-row updates, and summary changes.
2. Explain any double-counting or claim-calibration concerns.
3. Get explicit approval before editing.
4. Make the smallest targeted edit to the P2 document.
5. Preserve unrelated existing content.
6. Keep Markdown prose under 80 characters where the table format permits.

## Verification

After editing:

- confirm the title and coverage period;
- confirm every new table row has six cells;
- check for duplicate initiative names;
- confirm only completed outcomes were added;
- scan for unsupported adoption or forward-looking claims;
- run `git diff --check`;
- confirm no unrelated files changed;
- independently review meaningful updates before declaring completion.

## When Not to Use

Do not use this skill for:

- weekly status reports that will not update the BragBook;
- raw lists of Linear tasks or GitHub activity;
- performance-review submission or promotion-packet writing unless Justin
  explicitly asks for that deliverable;
- modifying Linear, GitHub, Notion, or other work systems.
