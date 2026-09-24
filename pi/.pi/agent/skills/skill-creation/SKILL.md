---
name: skill-creation
description: >-
  Create or improve local Pi skills from repeated workflows. Use when the user
  asks Pi to make a skill, automate a repeated agent workflow, or capture a
  reusable procedure as an Agent Skill.
---

# Skill Creation

Use this skill to create focused, reviewable Pi skills in Justin's dotfiles.

## Target Location

Create local skills under:

```text
pi/.pi/agent/skills/<skill-name>/SKILL.md
```

## Process

1. Collect at least one concrete workflow example from the user or repository.
2. Decide whether the right artifact is a skill, prompt, script, or SOFIA
   memory.
3. If a skill is appropriate, choose a lowercase hyphenated name.
4. Draft `SKILL.md` with valid frontmatter and narrow trigger wording.
5. Include only instructions needed for the repeated workflow.
6. Self-review for safety, ambiguity, scope creep, and missing paths.
7. Present the draft and wait for approval before installing it.
8. Install as experimental unless the user asks to make it active immediately.

## Required Frontmatter

```yaml
---
name: example-skill
description: >-
  Specific trigger wording that says when to use the skill and what it does.
---
```

## Quality Bar

A good skill:

- Has one clear purpose.
- Uses narrow trigger language.
- Names exact files, commands, and approval gates.
- Avoids secrets and hidden side effects.
- Says when not to use the skill.
- Can be understood without unrelated chat history.

## Validation

Verify valid frontmatter, lowercase hyphenated naming, non-empty description,
no placeholders, and links that resolve relative to the skill directory.
