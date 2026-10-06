"""Check real task shell ordering without invoking machine tooling."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import tomllib

ROOT = Path(__file__).parents[4]
TASKS = tomllib.loads((ROOT / "mise.toml").read_text())["tasks"]
SCRIPT = "pi/.pi/agent/bin/check-agent-tiers.py"
STAGES = [
    ["mise", "run", "check-agent-tiers"],
    [
        "python3",
        "-m",
        "unittest",
        "discover",
        "-s",
        "pi/.pi/agent/tests",
        "-p",
        "test_*.py",
    ],
    ["mise", "exec", "--", "bun", "test", "./pi/.pi/agent"],
]
SHIM = (
    f"#!{sys.executable}\n"
    + r"""
import json, os, sys
from pathlib import Path
call = [Path(sys.argv[0]).name, *sys.argv[1:]]
with open(os.environ["CALL_LOG"], "a") as stream:
    stream.write(json.dumps([os.getcwd(), call]) + "\n")
if call == json.loads(os.environ["FAIL_CALL"]):
    raise SystemExit(7)
"""
)


class MiseTaskTests(unittest.TestCase):
    def run_task(self, name, fail=None):
        self.assertIn(name, TASKS)
        with tempfile.TemporaryDirectory() as directory:
            outside = Path(directory).resolve()
            repo = outside / "repo"
            repo.mkdir()
            (repo / "test_decoy.py").touch()
            bin_dir = outside / "bin"
            bin_dir.mkdir()
            log = outside / "calls.jsonl"
            for command in ("mise", "python3"):
                path = bin_dir / command
                path.write_text(SHIM)
                path.chmod(0o700)
            env = {
                **os.environ,
                "PATH": str(bin_dir),
                "CALL_LOG": str(log),
                "FAIL_CALL": json.dumps(fail),
            }
            source = TASKS[name]["run"].replace("{{config_root}}", str(repo))
            result = subprocess.run(
                ["/bin/sh", "-c", source],
                cwd=outside,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            calls = (
                [json.loads(line) for line in log.read_text().splitlines()]
                if log.exists()
                else []
            )
            return result, calls, str(repo)

    def test_check_runs_each_stage_once_from_root(self):
        result, calls, repo = self.run_task("check")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [[repo, call] for call in STAGES])

    def test_check_stops_at_each_failed_stage(self):
        for index, call in enumerate(STAGES):
            with self.subTest(stage=index):
                result, calls, repo = self.run_task("check", fail=call)
                self.assertEqual(result.returncode, 7, result.stderr)
                self.assertEqual(calls, [[repo, c] for c in STAGES[: index + 1]])

    def test_checker_task_invokes_script_and_propagates_failure(self):
        self.assertTrue((ROOT / SCRIPT).is_file())
        call = ["python3", SCRIPT]
        for fail, status in ((None, 0), (call, 7)):
            with self.subTest(status=status):
                result, calls, repo = self.run_task("check-agent-tiers", fail)
                self.assertEqual(result.returncode, status, result.stderr)
                self.assertEqual(calls, [[repo, call]])
