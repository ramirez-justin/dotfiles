import json
from pathlib import Path
import unittest


REPO_ROOT = Path(__file__).parents[4]


class RuntimeSecretsConfigTests(unittest.TestCase):
    def test_jira_mcp_resolves_its_token_at_startup(self):
        config = json.loads(
            (REPO_ROOT / "pi/.pi/agent/mcp.json").read_text()
        )
        command = config["mcpServers"]["jira"]["args"][1]
        launcher = (REPO_ROOT / "pi/.pi/agent/bin/jira-mcp").read_text()
        self.assertIn("jira-mcp", command)
        self.assertIn("op read", launcher)
        self.assertIn("JIRA_API_TOKEN", launcher)
        self.assertNotIn(
            "${JIRA_API_TOKEN}", json.dumps(config["mcpServers"]["jira"])
        )

    def test_claude_settings_do_not_override_runtime_secrets(self):
        settings = json.loads(
            (REPO_ROOT / "claude/.claude/settings.json").read_text()
        )
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


if __name__ == "__main__":
    unittest.main()
