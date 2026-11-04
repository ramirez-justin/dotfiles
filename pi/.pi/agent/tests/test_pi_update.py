"""Exercise the real update script without updating or installing anything."""

import os
import subprocess
import tempfile
import tomllib
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
TASKS = tomllib.loads((ROOT / "mise.toml").read_text())["tasks"]
SCRIPT = TASKS["pi-update"]["run"].replace("{{config_root}}", "/repo")
GATE = (
    "exec -- python3 /repo/pi/.pi/agent/bin/pi-npm-audit.py gate"
    " --prefix $HOME/.pi/agent/npm"
)

# Every mise invocation is intercepted. Unknown commands fail closed.
STUB = r'''
mise() {
    printf '%s\n' "$*" >> "$CALLS"
    case "$*" in
        'exec -- pi update --extensions') return "${UPDATE_RC:-0}" ;;
        'exec -- npm audit fix '*) return "${FIX_RC:-0}" ;;
        'exec -- python3 /repo/pi/.pi/agent/bin/pi-npm-audit.py gate --prefix '*)
            audits=$((audits + 1))
            if [ "$audits" -eq 1 ]; then return "${AUDIT_RC:-0}"; fi
            return "${REAUDIT_RC:-0}"
            ;;
        'run check') return "${CHECK_RC:-0}" ;;
        'exec -- pi --offline --list-models') return "${STARTUP_RC:-0}" ;;
        *) return 99 ;;
    esac
}
audits=0
'''


class PiUpdateTests(unittest.TestCase):
    def run_update(self, npm_root: bool = True, /, **statuses: int):
        with tempfile.TemporaryDirectory(prefix="pi-update-") as directory:
            home = Path(directory)
            if npm_root:
                package = home / ".pi/agent/npm/package.json"
                package.parent.mkdir(parents=True)
                package.write_text("{}")
            calls = home / "calls"
            env = {
                "PATH": os.defpath,
                "HOME": str(home),
                "CALLS": str(calls),
                **{key: str(value) for key, value in statuses.items()},
            }
            result = subprocess.run(
                ["bash", "-c", STUB + SCRIPT],
                env=env,
                cwd=home,
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
            commands = calls.read_text().splitlines()
            # Normalize only the disposable home path, not command behavior.
            commands = [command.replace(str(home), "$HOME") for command in commands]
            return result.returncode, commands

    def test_all_success_paths_run_checks_after_update_and_audit(self):
        update = "exec -- pi update --extensions"
        audit = GATE
        fix = "exec -- npm audit fix --prefix $HOME/.pi/agent/npm --omit=peer --legacy-peer-deps"
        checks = ["run check", "exec -- pi --offline --list-models"]
        for npm_root, statuses, operations in [
            (False, {}, [update]),
            (True, {}, [update, audit]),
            (True, {"AUDIT_RC": 1}, [update, audit, fix, audit]),
            # npm audit fix exits nonzero when unfixable findings remain; the
            # final gate (exception-aware) decides.
            (True, {"AUDIT_RC": 1, "FIX_RC": 1}, [update, audit, fix, audit]),
        ]:
            with self.subTest(npm_root=npm_root, statuses=statuses):
                code, commands = self.run_update(npm_root, **statuses)
                self.assertEqual(code, 0)
                self.assertEqual(commands, operations + checks)

    def test_update_or_audit_failure_stops_before_checks(self):
        for statuses in [
            {"UPDATE_RC": 7},
            {"AUDIT_RC": 1, "REAUDIT_RC": 7},
            {"AUDIT_RC": 1, "FIX_RC": 3, "REAUDIT_RC": 7},
        ]:
            with self.subTest(statuses=statuses):
                code, commands = self.run_update(**statuses)
                self.assertEqual(code, 7)
                self.assertNotIn("run check", commands)
                self.assertNotIn("exec -- pi --offline --list-models", commands)

    def test_audit_errors_fail_closed_without_repair(self):
        for status in (2, 127):
            with self.subTest(status=status):
                code, commands = self.run_update(AUDIT_RC=status)
                self.assertEqual(code, status)
                self.assertEqual(commands, ["exec -- pi update --extensions", GATE])

    def test_monitor_tasks_call_read_only_monitor_and_installer(self):
        script = "{{config_root}}/pi/.pi/agent/bin/pi-npm-audit.py"
        self.assertIn(
            f'{script} monitor --prefix "$HOME/.pi/agent/npm"',
            TASKS["pi-audit-monitor"]["run"],
        )
        self.assertNotIn("audit fix", TASKS["pi-audit-monitor"]["run"])
        self.assertIn(
            f"{script} install-launchd", TASKS["pi-audit-monitor-install"]["run"]
        )

    def test_failed_tests_stop_before_startup_check(self):
        code, commands = self.run_update(CHECK_RC=8)
        self.assertEqual(code, 8)
        self.assertEqual(commands[-1], "run check")
        self.assertNotIn("exec -- pi --offline --list-models", commands)

    def test_failed_startup_check_fails_the_update_task(self):
        code, commands = self.run_update(STARTUP_RC=9)
        self.assertEqual(code, 9)
        self.assertEqual(
            commands[-2:], ["run check", "exec -- pi --offline --list-models"]
        )


if __name__ == "__main__":
    unittest.main()
