from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

import tomllib

REPO_ROOT = Path(__file__).resolve().parents[4]
AGENT_ROOT = REPO_ROOT / "pi/.pi/agent"


def parse_frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text()
    if not text.startswith("---\n"):
        raise AssertionError(f"missing frontmatter: {path}")
    _, raw, _ = text.split("---", 2)
    result: dict[str, str] = {}
    for line in raw.splitlines():
        if not line or line[0].isspace() or ":" not in line:
            continue
        key, value = line.split(":", 1)
        result[key.strip()] = value.strip()
    return result


def package_source(entry: object) -> str:
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict) and isinstance(entry.get("source"), str):
        return entry["source"]
    raise AssertionError(f"invalid package entry: {entry!r}")


class AgentWorkflowContract(unittest.TestCase):
    def test_package_selection(self) -> None:
        settings = json.loads((AGENT_ROOT / "settings.json").read_text())
        self.assertEqual(settings["defaultModel"], "gpt-6-sol")
        packages = settings["packages"]
        sources = {package_source(entry) for entry in packages}
        self.assertIn("npm:@tintinweb/pi-subagents", sources)
        self.assertNotIn("npm:pi-claude-code-provider", sources)
        self.assertNotIn("npm:pi-intercom", sources)

        superpowers = next(
            entry
            for entry in packages
            if isinstance(entry, dict)
            and package_source(entry).startswith(
                "git:https://github.com/obra/superpowers.git"
            )
        )
        selected = superpowers["skills"]
        self.assertFalse(any("writing-plans" in item for item in selected))
        self.assertFalse(any("executing-plans" in item for item in selected))

    def test_subagent_defaults_fail_closed(self) -> None:
        config = json.loads((AGENT_ROOT / "subagents.json").read_text())
        self.assertEqual(
            config,
            {
                "maxConcurrent": 4,
                "fallbackSubagent": "none",
                "defaultJoinMode": "smart",
                "schedulingEnabled": False,
                "scopeModels": False,
                "disableDefaultAgents": False,
                "toolDescriptionMode": "compact",
                "fleetView": True,
                "widgetMode": "background",
            },
        )

    def test_agent_role_contracts(self) -> None:
        expected = {
            "AstraPlan.md": (
                "openai-codex/gpt-6-astra",
                "max",
                {"read", "grep", "find", "bash"},
                True,
            ),
            "Explore.md": (
                "openai-codex/gpt-6-luna",
                "max",
                {"read", "grep", "find", "bash"},
                False,
            ),
            "Plan.md": (
                "openai-codex/gpt-5.6-terra",
                "max",
                {"read", "grep", "find", "bash"},
                False,
            ),
            "implementer.md": (
                "openai-codex/gpt-6-astra",
                "low",
                {"read", "grep", "find", "bash", "edit", "write"},
                False,
            ),
            "oracle.md": (
                "openai-codex/gpt-6-astra",
                "max",
                {"read", "grep", "find", "bash"},
                False,
            ),
            "researcher.md": (
                "openai-codex/gpt-6-luna",
                "high",
                {"read", "grep", "find", "bash"},
                False,
            ),
            "reviewer.md": (
                "openai-codex/gpt-5.6-terra",
                "max",
                {"read", "grep", "find", "bash"},
                False,
            ),
            "simplifier.md": (
                "openai-codex/gpt-5.6-terra",
                "max",
                {"read", "grep", "find"},
                True,
            ),
            "verifier.md": (
                "openai-codex/gpt-6-luna",
                "max",
                {"read", "grep", "find", "bash"},
                False,
            ),
            "worker.md": (
                "openai-codex/gpt-6-sol",
                "medium",
                {"read", "grep", "find", "bash", "edit", "write"},
                False,
            ),
        }

        agent_dir = AGENT_ROOT / "agents"
        self.assertEqual({path.name for path in agent_dir.glob("*.md")}, set(expected))
        for name, (model, thinking, tools, isolated) in expected.items():
            frontmatter = parse_frontmatter(agent_dir / name)
            self.assertEqual(frontmatter.get("model"), model, name)
            self.assertEqual(frontmatter.get("thinking"), thinking, name)
            self.assertEqual(set(frontmatter.get("tools", "").split(", ")), tools, name)
            self.assertEqual(frontmatter.get("isolated") == "true", isolated, name)

        oracle = parse_frontmatter(agent_dir / "oracle.md")
        self.assertEqual(oracle.get("display_name"), "Oracle (Astra)")

        for name in expected:
            tools = set(parse_frontmatter(agent_dir / name)["tools"].split(", "))
            if name not in {"worker.md", "implementer.md"}:
                self.assertTrue({"edit", "write"}.isdisjoint(tools), name)

    def test_local_workflow_skills(self) -> None:
        required = {
            "writing-plans",
            "executing-plans",
            "ponytail-review",
            "orchestration",
            "skill-creation",
            "ai-docs-maintenance",
        }
        for name in required:
            path = AGENT_ROOT / "skills" / name / "SKILL.md"
            frontmatter = parse_frontmatter(path)
            self.assertEqual(frontmatter.get("name"), name)
            self.assertTrue(frontmatter.get("description"))

    def test_personal_instructions_and_memory_boundary(self) -> None:
        instructions = (AGENT_ROOT / "AGENTS.md").read_text()
        self.assertIn("## Subagent Routing", instructions)
        self.assertRegex(instructions, re.compile(r"single.writer", re.IGNORECASE))
        self.assertIn("SOFIA Cloud", instructions)
        self.assertFalse((AGENT_ROOT / "extensions/memory-governor").exists())
        self.assertFalse((AGENT_ROOT / "memory").exists())

    def test_extensions_use_settled_lifecycle(self) -> None:
        notification = (AGENT_ROOT / "extensions/stop-notification.ts").read_text()
        self.assertIn('pi.on("agent_settled"', notification)
        self.assertNotIn('pi.on("agent_end"', notification)
        self.assertTrue((AGENT_ROOT / "extensions/session-status.ts").is_file())

    def test_mise_workflow_tasks(self) -> None:
        config = tomllib.loads((REPO_ROOT / "mise.toml").read_text())
        tasks = config["tasks"]
        self.assertIn("check-agent-tiers", tasks)
        self.assertNotIn("depends", tasks["link"])
        self.assertIn("command -v stow", tasks["link"]["run"])
        self.assertIn("mise run pi-update", tasks["update"]["run"])
        doctor = tasks["doctor"]["run"]
        self.assertIn("brew_prefix=$(brew --prefix)", doctor)
        self.assertIn(
            'PATH="$brew_prefix/bin:$brew_prefix/sbin:$HOME/.cargo/bin:$PATH"',
            doctor,
        )
        self.assertIn("HOMEBREW_NO_AUTO_UPDATE=1", doctor)
        self.assertIn("brew bundle check --no-upgrade", doctor)


if __name__ == "__main__":
    unittest.main()
