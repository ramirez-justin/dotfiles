import json
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).parents[4]


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise AssertionError(f"Could not load JSON from {path}") from error


class RuntimeSecretsConfigTests(unittest.TestCase):
    def test_jira_mcp_resolves_its_token_at_startup(self):
        config = load_json(REPO_ROOT / "pi/.pi/agent/mcp.json")
        command = config["mcpServers"]["jira"]["args"][1]
        launcher = (REPO_ROOT / "pi/.pi/agent/bin/jira-mcp").read_text()
        self.assertIn("jira-mcp", command)
        self.assertIn("op read", launcher)
        self.assertIn("JIRA_API_TOKEN", launcher)
        self.assertNotIn("${JIRA_API_TOKEN}", json.dumps(config["mcpServers"]["jira"]))

    def test_jira_mcp_does_not_depend_on_parent_environment(self):
        config = load_json(REPO_ROOT / "pi/.pi/agent/mcp.json")
        environment = config["mcpServers"]["jira"]["env"]
        self.assertEqual(environment["JIRA_URL"], "https://gametime.atlassian.net")
        self.assertEqual(environment["JIRA_USERNAME"], "justin.ramirez@gametime.co")

    def test_claude_settings_do_not_override_runtime_secrets(self):
        settings = load_json(REPO_ROOT / "claude/.claude/settings.json")
        environment = settings["env"]
        self.assertNotIn("JIRA_API_TOKEN", environment)
        self.assertNotIn("FIVETRAN_API_KEY", environment)
        self.assertNotIn("FIVETRAN_API_SECRET", environment)

    def test_pi_environment_does_not_source_plaintext_secrets(self):
        environment = (REPO_ROOT / "pi/.pi/agent/env.zsh").read_text()
        self.assertNotIn("env.local.zsh", environment)
        self.assertNotIn("JIRA_API_TOKEN", environment)

    def test_bootstrap_does_not_inject_plaintext_secrets(self):
        mise = (REPO_ROOT / "mise.toml").read_text()
        readme = (REPO_ROOT / "README.md").read_text()
        self.assertNotIn("inject-secrets", mise)
        self.assertNotIn("inject-secrets", readme)

    def test_migration_task_removes_only_legacy_secret_files(self):
        mise = (REPO_ROOT / "mise.toml").read_text()
        readme = (REPO_ROOT / "README.md").read_text()
        self.assertIn("[tasks.migrate-agent-secrets]", mise)
        self.assertIn("op run --env-file", mise)
        self.assertIn("settings.local.json", mise)
        self.assertIn("env.local.zsh", mise)
        self.assertIn("mise run migrate-agent-secrets", readme)


if __name__ == "__main__":
    unittest.main()
