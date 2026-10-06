import json
import pathlib
import subprocess
import sys

root = pathlib.Path.cwd()
agents = root / "pi/.pi/agent/agents"
settings_path = root / "pi/.pi/agent/settings.json"

expected = {
    "AdvancedPlan.md": ("anthropic/claude-opus-5-5", "max"),
    "Explore.md": ("openai-codex/gpt-6-luna", "max"),
    "implementer.md": ("anthropic/claude-opus-5-5", "high"),
    "oracle.md": ("anthropic/claude-opus-5-5", "max"),
    "Plan.md": ("openai-codex/gpt-6.1-sol", "xhigh"),
    "researcher.md": (
        "pi-claude-code-provider/sonnet",
        "high",
    ),
    "reviewer.md": ("openai-codex/gpt-6-luna", "max"),
    "simplifier.md": ("openai-codex/gpt-6-luna", "max"),
    "verifier.md": ("openai-codex/gpt-6-luna", "max"),
    "worker.md": ("openai-codex/gpt-6.1-sol", "high"),
}


def frontmatter(path):
    text = path.read_text()
    parts = text.split("---", 2)
    if len(parts) != 3:
        raise ValueError(f"{path}: missing YAML frontmatter")
    values = {}
    for line in parts[1].splitlines():
        if ": " in line:
            key, value = line.split(": ", 1)
            values[key] = value
    return values


errors = []
for name, (model, thinking) in expected.items():
    path = agents / name
    if not path.is_file():
        errors.append(f"missing required agent: {path}")
        continue
    values = frontmatter(path)
    if values.get("model") != model:
        errors.append(
            f"{path}: expected model {model}, got "
            f"{values.get('model')}"
        )
    if values.get("thinking") != thinking:
        errors.append(
            f"{path}: expected thinking {thinking}, got "
            f"{values.get('thinking')}"
        )

simplifier = agents / "simplifier.md"
if simplifier.is_file():
    values = frontmatter(simplifier)
    for key, value in {"tools": "read, grep, find", "isolated": "true"}.items():
        if values.get(key) != value:
            errors.append(f"{simplifier}: expected {key}={value}")

subagents_path = root / "pi/.pi/agent/subagents.json"
subagents = json.loads(subagents_path.read_text())
if subagents.get("fallbackSubagent") != "none":
    errors.append(f"{subagents_path}: expected fallbackSubagent=none")

changed_paths = set()
for args in (
    ["diff", "--name-only", "-z"],
    ["diff", "--cached", "--name-only", "-z"],
    ["ls-files", "--others", "--exclude-standard", "-z"],
):
    result = subprocess.run(
        ["git", *args], check=True, capture_output=True, text=True,
    )
    changed_paths.update(result.stdout.split("\0"))

pi_root = pathlib.Path("pi/.pi/agent")
markers = ("TODO", "TBD")
instructions = {"AGENTS.md", "AGENT.local.md", "CLAUDE.md", "CLAUDE.local.md"}
for name in sorted(changed_paths - {""}):
    relative = pathlib.Path(name)
    path = root / relative
    if path.suffix.lower() != ".md" or not path.is_file():
        continue
    pi_markdown = relative.is_relative_to(pi_root) and (
        relative.relative_to(pi_root).parts[0] in {"agents", "skills", "prompts"}
        or path.name in instructions
    )
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if len(line) > 80:
            errors.append(f"{relative}:{number}: line exceeds 80 characters")
        if pi_markdown and any(marker in line for marker in markers):
            errors.append(f"{relative}:{number}: unfinished marker")

actual_files = {path.name for path in agents.glob("*.md")}
extra_files = sorted(actual_files - set(expected))
if extra_files:
    errors.append(f"unvalidated agent definitions: {extra_files}")

settings = json.loads(settings_path.read_text())
sources = [
    item if isinstance(item, str) else item.get("source")
    for item in settings.get("packages", [])
]
required_sources = {
    "git:https://github.com/obra/superpowers.git",
    "npm:pi-claude-code-provider",
}
for source in sorted(required_sources):
    if source not in sources:
        errors.append(f"{settings_path}: missing package {source}")

for source in sources:
    if source and source.startswith(
        "git:https://github.com/obra/superpowers.git@"
    ):
        errors.append(f"{settings_path}: Superpowers must be unpinned")
    if source and source.startswith("npm:pi-claude-code-provider@"):
        errors.append(f"{settings_path}: Claude provider must be unpinned")

# Require the explicit allowlist so broad globs, omitted filters, or a
# duplicate package entry cannot silently restore upstream orchestration.
retained_skills = {
    "brainstorming",
    "systematic-debugging",
    "test-driven-development",
    "verification-before-completion",
    "finishing-a-development-branch",
    "receiving-code-review",
    "requesting-code-review",
    "using-git-worktrees",
}
superpowers = [
    item for item in settings.get("packages", [])
    if (item if isinstance(item, str) else item.get("source"))
    == "git:https://github.com/obra/superpowers.git"
]
expected_filters = {f"skills/{name}/**" for name in retained_skills}
if len(superpowers) != 1 or not isinstance(superpowers[0], dict):
    errors.append("Superpowers must have exactly one filtered package entry")
else:
    filters = superpowers[0].get("skills")
    if not isinstance(filters, list) or set(filters) != expected_filters:
        errors.append(
            "Superpowers skills must use the retained engineering allowlist; "
            "writing-plans and executing-plans must remain local only"
        )

for name in ("writing-plans", "executing-plans", "ponytail-review"):
    path = root / "pi/.pi/agent/skills" / name / "SKILL.md"
    if not path.is_file():
        errors.append(f"missing local workflow skill: {path}")
        continue
    try:
        values = frontmatter(path)
    except ValueError as error:
        errors.append(str(error))
        continue
    if values.get("name") != name:
        errors.append(f"{path}: expected skill name {name}")
    if not values.get("description"):
        errors.append(f"{path}: missing skill description")

required_defaults = {
    "defaultProvider": "openai-codex",
    "defaultModel": "gpt-6.1-sol",
    "defaultThinkingLevel": "medium",
}
for key, value in required_defaults.items():
    if settings.get(key) != value:
        errors.append(
            f"{settings_path}: expected {key}={value}, got "
            f"{settings.get(key)}"
        )

if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)

result = subprocess.run(
    ["mise", "exec", "--", "pi", "--offline", "--list-models"],
    check=True,
    capture_output=True,
    text=True,
)
catalog = {
    (parts[0], parts[1])
    for line in result.stdout.splitlines()
    if len(parts := line.split()) >= 2
}
for model, _thinking in expected.values():
    provider, model_id = model.split("/", 1)
    if (provider, model_id) not in catalog:
        errors.append(f"Pi model catalog does not contain {model}")

if errors:
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)

print("Pi agent models, defaults, and local workflow skills verified")
