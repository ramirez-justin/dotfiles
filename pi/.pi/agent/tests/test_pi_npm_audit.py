"""Exercise the strict Pi npm audit gate without network access."""

import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from contextlib import nullcontext, redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[4]
SCRIPT = ROOT / "pi/.pi/agent/bin/pi-npm-audit.py"
spec = importlib.util.spec_from_file_location("pi_npm_audit", SCRIPT)
assert spec and spec.loader
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def vulnerable(name, severity, url="https://github.com/advisories/GHSA-test"):
    advisory = {"name": name, "title": "test", "url": url, "severity": severity}
    return {
        "name": name,
        "severity": severity,
        "via": [advisory],
        "effects": [],
        "nodes": [f"node_modules/{name}"],
        "fixAvailable": False,
    }


def zod_findings(fix: bool | dict[str, object] = False):
    """The formerly excepted dependency chain must now block like any other."""
    parent = vulnerable("context-mode", "high")
    parent["via"] = ["zod"]
    child = vulnerable(
        "zod", "high", "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5"
    )
    child["nodes"] = ["node_modules/context-mode/node_modules/zod"]
    child["effects"] = ["context-mode"]
    for entry in (parent, child):
        entry["fixAvailable"] = fix
    return {"context-mode": parent, "zod": child}


def report(vulnerabilities=None, **extra):
    document = {"auditReportVersion": 2, "vulnerabilities": vulnerabilities or {}}
    document.update(extra)
    return json.dumps(document)


MALFORMED_FIXES = [
    {},
    {"name": "context-mode", "version": "2.0.0", "isSemVerMajor": "false"},
    {"name": "context-mode", "version": "2.0.0"},
    {"name": "", "version": "2.0.0", "isSemVerMajor": True},
    {"name": "context-mode", "version": 2, "isSemVerMajor": False},
    {"version": "2.0.0", "isSemVerMajor": True},
]
DECODE_ERROR = UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte")


def decoder_failures():
    for error in (ValueError, RecursionError):
        loads = mock.patch.object(audit.json, "loads", side_effect=error("decoder"))
        yield error.__name__, report(), loads
    yield "digits", "1" * 5000, nullcontext()
    yield "depth", "[" * 100_000 + "]" * 100_000, nullcontext()


class Harness:
    """Record every subprocess invocation and return a synthetic npm report."""

    def __init__(self, stdout="", returncode=0, error=None):
        self.stdout, self.returncode, self.error = stdout, returncode, error
        self.calls, self.prefix = [], None

    def __call__(self, argv, **kwargs):
        self.calls.append(list(argv))
        if self.error:
            raise self.error
        return subprocess.CompletedProcess(argv, self.returncode, self.stdout, "")


class GateTests(unittest.TestCase):
    def gate(self, stdout="", returncode=1, error=None):
        harness = Harness(stdout, returncode, error)
        out, err = io.StringIO(), io.StringIO()
        with (
            tempfile.TemporaryDirectory(prefix="pi-audit-prefix-") as prefix,
            mock.patch.object(audit.subprocess, "run", harness),
            redirect_stdout(out),
            redirect_stderr(err),
        ):
            # No installed package metadata is needed to enforce audit findings.
            code = audit.main(["gate", "--prefix", prefix, "--npm", "/abs/npm"])
        self.assertEqual(
            harness.calls,
            [["/abs/npm", "audit", "--prefix", prefix, "--omit=peer", "--json", "--offline=false"]],
        )
        return code, out.getvalue() + err.getvalue()

    def test_clean_audit_passes_without_obsolete_notice(self):
        code, output = self.gate(report(), returncode=0)
        self.assertEqual(code, 0)
        self.assertIn("no high or critical findings", output)
        self.assertNotIn("exception", output.lower())
        self.assertNotIn("monitor", output.lower())

    def test_nonblocking_severities_remain_permitted(self):
        for severity in ("info", "low", "moderate"):
            with self.subTest(severity=severity):
                code, _ = self.gate(report({"pkg": vulnerable("pkg", severity)}))
                self.assertEqual(code, 0)

    def test_previously_excepted_advisory_is_blocked_regardless_of_fix(self):
        fixes: list[bool | dict[str, object]] = [
            False,
            True,
            {"name": "context-mode", "version": "2.0.0", "isSemVerMajor": False},
            {"name": "context-mode", "version": "2.0.0", "isSemVerMajor": True},
        ]
        for fix in fixes:
            with self.subTest(fix=fix):
                code, output = self.gate(report(zod_findings(fix)))
                self.assertEqual(code, 1)
                self.assertIn("context-mode", output)
                self.assertIn("zod", output)
                self.assertNotIn("WARNING", output)
                self.assertNotIn("ERROR", output)

    def test_any_high_or_critical_finding_is_blocked(self):
        for severity in ("high", "critical"):
            with self.subTest(severity=severity):
                code, output = self.gate(report({"pkg": vulnerable("pkg", severity)}))
                self.assertEqual(code, 1)
                self.assertIn(f"pkg ({severity})", output)

    def test_aggregated_reference_severity_is_blocked_not_error(self):
        shared = vulnerable("shared", "critical")
        shared["via"].insert(0, dict(shared["via"][0], severity="moderate"))
        shared["effects"] = ["parent"]
        parent = dict(vulnerable("parent", "moderate"), via=["shared"])
        code, output = self.gate(report({"parent": parent, "shared": shared}))
        self.assertEqual(code, 1)
        self.assertNotIn("ERROR", output)

    def test_malformed_or_failed_audits_fail_closed(self):
        lowered = vulnerable("pkg", "moderate")
        lowered["via"][0]["severity"] = "critical"
        dangling = dict(vulnerable("pkg", "high"), via=["missing"])
        for stdout, returncode in [
            ("", 1),
            ("not json", 1),
            ("[]", 1),
            (json.dumps({"auditReportVersion": 2}), 1),
            (report(error={"code": "ENOTFOUND", "summary": "network down"}), 1),
            (report(zod_findings()), 2),
            (report(), 1),
            (report({"pkg": dict(vulnerable("pkg", "high"), severity="severe")}), 1),
            (report({"pkg": dict(vulnerable("pkg", "high"), fixAvailable="yes")}), 1),
            (report({"pkg": dict(vulnerable("pkg", "high"), via="pkg")}), 1),
            *(
                (report({"pkg": dict(vulnerable("pkg", "high"), fixAvailable=fix)}), 1)
                for fix in MALFORMED_FIXES
            ),
            (report({"pkg": "high"}), 1),
            (report({"pkg": lowered}), 1),
            (report({"pkg": dangling}), 1),
        ]:
            with self.subTest(stdout=stdout, returncode=returncode):
                code, output = self.gate(stdout, returncode)
                self.assertEqual(code, 2)
                self.assertIn("ERROR", output)

    def test_all_decoder_failures_fail_closed(self):
        for name, stdout, decoder in decoder_failures():
            with self.subTest(failure=name), decoder:
                code, output = self.gate(stdout)
                self.assertEqual(code, 2)
                self.assertIn("ERROR", output)

    def test_npm_launch_failure_or_timeout_fails_closed(self):
        for error in (OSError("missing npm"), subprocess.TimeoutExpired("npm", 300), DECODE_ERROR):
            with self.subTest(error=error):
                code, output = self.gate(error=error)
                self.assertEqual(code, 2)
                self.assertIn("ERROR", output)

    def test_monitor_and_installer_commands_are_removed(self):
        for command in ("monitor", "install-launchd"):
            with (
                self.subTest(command=command),
                tempfile.TemporaryDirectory(prefix="pi-audit-retired-") as home,
                mock.patch("pathlib.Path.home", return_value=Path(home)),
                mock.patch("subprocess.run"),
                redirect_stderr(io.StringIO()),
            ):
                with self.assertRaises(SystemExit) as error:
                    audit.main([command])
                self.assertEqual(error.exception.code, 2)


FAKE_NPM = """#!/bin/sh
if [ "$npm_config_offline" = true ] && [ "$6" != --offline=false ]; then
    printf '%s' '{"vulnerabilities":{}}'
    exit 0
fi
if [ "$FAKE_NPM_MODE" = bytes ]; then
    printf '\\377'
else
    printf '%s' "$FAKE_NPM_REPORT"
fi
exit 1
"""


class RealSubprocessTests(unittest.TestCase):
    def run_audit(self, mode):
        with tempfile.TemporaryDirectory(prefix="pi-audit-npm-") as directory:
            npm = Path(directory) / "npm"
            npm.write_text(FAKE_NPM)
            npm.chmod(0o700)
            env = {
                "npm_config_offline": "true",
                "FAKE_NPM_MODE": mode,
                "FAKE_NPM_REPORT": report(zod_findings()),
            }
            out = io.StringIO()
            with mock.patch.dict(os.environ, env), redirect_stdout(out), redirect_stderr(out):
                code = audit.main(["gate", "--prefix", directory, "--npm", str(npm)])
            return code, out.getvalue()

    def test_inherited_offline_config_cannot_hide_findings(self):
        code, output = self.run_audit("report")
        self.assertEqual(code, 1)
        self.assertIn("zod", output)

    def test_undecodable_output_fails_closed(self):
        code, output = self.run_audit("bytes")
        self.assertEqual(code, 2)
        self.assertIn("ERROR", output)


if __name__ == "__main__":
    unittest.main()
