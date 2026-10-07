"""Run the agent tier checker against temporary repository copies."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[4]
AGENT = Path("pi/.pi/agent")
SCRIPT = ROOT / AGENT / "bin/check-agent-tiers.py"
MAPPING = AGENT / "extensions/model-tiers.json"
EXTENSION = AGENT / "extensions/model-tiers.ts"
COPIED = [
    AGENT / "agents",
    AGENT / "settings.json",
    AGENT / "subagents.json",
    AGENT / "skills/writing-plans/SKILL.md",
    AGENT / "skills/executing-plans/SKILL.md",
    AGENT / "skills/ponytail-review/SKILL.md",
    MAPPING,
]
# Fake mise: list a catalog only when Pi loads the repository tier extension.
MISE = (
    f"#!{sys.executable}\n"
    + r"""
import os, sys
extension = os.path.join(os.getcwd(), "pi/.pi/agent/extensions/model-tiers.ts")
expected = ["exec", "--", "pi", "--offline", "-e", extension, "--list-models"]
if sys.argv[1:] != expected:
    sys.exit(f"unexpected mise call: {sys.argv[1:]}")
print("provider model context")
print(open(os.environ["CATALOG"]).read())
"""
)


class CheckAgentTiersTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.outside = Path(directory.name).resolve()
        self.repo = self.outside / "repo"
        for relative in COPIED:
            source, target = ROOT / relative, self.repo / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if source.is_dir():
                shutil.copytree(source, target)
            else:
                shutil.copy2(source, target)
        git = ["git", "-C", str(self.repo)]
        subprocess.run([*git, "init", "-q"], check=True)
        subprocess.run([*git, "add", "-A"], check=True)
        subprocess.run(
            [
                *git,
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-qm",
                "fixture",
            ],
            check=True,
        )
        bin_dir = self.outside / "bin"
        bin_dir.mkdir()
        (bin_dir / "mise").write_text(MISE)
        (bin_dir / "mise").chmod(0o700)
        self.env = {
            **os.environ,
            "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
            "CATALOG": str(self.outside / "catalog.txt"),
        }
        self.set_catalog(self.mapping().values(), aliases=self.mapping())

    def mapping(self):
        return json.loads((self.repo / MAPPING).read_text())

    def write_mapping(self, mapping):
        (self.repo / MAPPING).write_text(json.dumps(mapping))

    def set_catalog(self, models, aliases=()):
        lines = [model.replace("/", " ", 1) for model in models]
        lines += [f"tiers {tier}" for tier in aliases]
        Path(self.env["CATALOG"]).write_text("\n".join(lines))

    def edit_agent(self, name, old, new):
        path = self.repo / AGENT / "agents" / name
        text = path.read_text()
        self.assertIn(old, text)
        path.write_text(text.replace(old, new, 1))

    def run_checker(self):
        return subprocess.run(
            [sys.executable, str(SCRIPT)],
            cwd=self.repo,
            env=self.env,
            capture_output=True,
            text=True,
            check=False,
        )

    def assert_fails(self, message):
        result = self.run_checker()
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn(message, result.stderr)

    def test_accepts_current_configuration(self):
        result = self.run_checker()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_accepts_mapping_only_upgrade(self):
        mapping = {**self.mapping(), "tier-2": "openai-codex/gpt-7-sol"}
        self.write_mapping(mapping)
        self.set_catalog(mapping.values(), aliases=mapping)
        result = self.run_checker()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_agent_alias_and_thinking_drift(self):
        self.edit_agent(
            "worker.md", "model: tiers/tier-2", "model: openai-codex/gpt-6.1-sol"
        )
        self.edit_agent("Plan.md", "thinking: xhigh", "thinking: high")
        result = self.run_checker()
        self.assertEqual(result.returncode, 1)
        self.assertIn("worker.md: expected model tiers/tier-2", result.stderr)
        self.assertIn("Plan.md: expected thinking xhigh", result.stderr)

    def test_rejects_invalid_mapping(self):
        mapping = self.mapping()
        for name, invalid in {
            "list": [],
            "missing tier": {k: v for k, v in mapping.items() if k != "tier-4"},
            "extra tier": {**mapping, "tier-5": "anthropic/claude-opus-5-5"},
            "non-string": {**mapping, "tier-1": 7},
            "no provider": {**mapping, "tier-1": "claude-opus-5-5"},
            "virtual": {**mapping, "tier-1": "tiers/tier-2"},
        }.items():
            with self.subTest(name):
                self.write_mapping(invalid)
                self.assert_fails(str(MAPPING))

    def test_rejects_targets_missing_from_catalog(self):
        mapping = self.mapping()
        missing = mapping["tier-1"]
        others = [m for m in mapping.values() if m != missing]
        self.set_catalog(others, aliases=mapping)
        self.assert_fails(f"Pi model catalog does not contain {missing}")

    def test_rejects_unregistered_alias(self):
        mapping = self.mapping()
        self.set_catalog(mapping.values(), aliases=["tier-1", "tier-2", "tier-3"])
        self.assert_fails("Pi model catalog does not contain tiers/tier-4")

    def test_retains_unrelated_validation(self):
        self.edit_agent("simplifier.md", "isolated: true", "isolated: false")
        self.assert_fails("expected isolated=true")


if __name__ == "__main__":
    unittest.main()
