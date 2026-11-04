"""Exercise the Pi npm audit gate, weekly monitor, and launchd renderer.

npm, osascript, and launchctl are mocked or faked; nothing touches the network.
"""

import copy
import importlib.util
import io
import json
import os
import plistlib
import subprocess
import sys
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

GHSA = "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5"
ZOD_ADVISORY = {
    "source": 1243066,
    "name": "zod",
    "dependency": "zod",
    "title": "Zod can exhaust memory while validating oversized collections",
    "url": GHSA,
    "severity": "high",
    "range": "<4.6.6",
}
EXCEPTION = {
    "context-mode": {
        "name": "context-mode",
        "severity": "high",
        "isDirect": True,
        "via": ["zod"],
        "effects": [],
        "range": "<=1.0.169",
        "nodes": ["node_modules/context-mode"],
        "fixAvailable": False,
    },
    "zod": {
        "name": "zod",
        "severity": "high",
        "isDirect": False,
        "via": [ZOD_ADVISORY],
        "effects": ["context-mode"],
        "range": "<4.6.6",
        "nodes": ["node_modules/context-mode/node_modules/zod"],
        "fixAvailable": False,
    },
}


MALFORMED_FIXES = [
    {},
    {"name": "context-mode", "version": "2.0.0", "isSemVerMajor": "false"},
    {"name": "context-mode", "version": "2.0.0"},
    {"name": "", "version": "2.0.0", "isSemVerMajor": True},
    {"name": "context-mode", "version": 2, "isSemVerMajor": False},
    {"version": "2.0.0", "isSemVerMajor": True},
]


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


def report(vulnerabilities=None, **extra):
    document = {"auditReportVersion": 2, "vulnerabilities": vulnerabilities or {}}
    document.update(extra)
    return json.dumps(document)


def exception(**changes):
    vulnerabilities = copy.deepcopy(EXCEPTION)
    for name, fields in changes.items():
        vulnerabilities[name].update(fields)
    return vulnerabilities


def inconsistent_reports():
    """Summaries npm would never emit: severity below an inline advisory,
    or a reference to a finding missing from the report."""
    lowered = vulnerable("lodash", "moderate")
    lowered["via"][0]["severity"] = "critical"
    moderate = {"severity": "moderate"}
    return [
        report(exception(**{"context-mode": moderate, "zod": moderate})),
        report({"lodash": lowered}),
        report(exception(**{"context-mode": {"via": ["zod", "missing"]}})),
    ]


def aggregated_reports():
    """Valid npm output: summaries are keyed by package name across installed
    versions, so a parent may be lower than a referenced summary."""
    shared = vulnerable("shared", "critical")
    shared["via"].insert(0, dict(shared["via"][0], severity="moderate"))
    shared["effects"] = ["parent"]
    parent = dict(vulnerable("parent", "moderate"), via=["shared"])
    return [
        report({"parent": parent, "shared": shared}),
        report(exception(**{"context-mode": {"severity": "moderate"}})),
    ]


DECODE_ERROR = UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid start byte")


def decoder_failures():
    """json.loads raises more than JSONDecodeError: other ValueErrors (such as
    integer limits) and RecursionError. Mocks make both deterministic; the
    bounded payloads also trigger them for real. Labels avoid printing them."""
    for error in (ValueError, RecursionError):
        loads = mock.patch.object(audit.json, "loads", side_effect=error("decoder"))
        yield error.__name__, report(), loads
    yield "digits", "1" * 5000, nullcontext()
    yield "depth", "[" * 100_000 + "]" * 100_000, nullcontext()


class Harness:
    """Fake subprocess.run for npm, osascript, and launchctl."""

    def __init__(self, stdout="", returncode=0, error=None):
        self.stdout, self.returncode, self.error = stdout, returncode, error
        self.calls, self.prefix = [], None

    def __call__(self, argv, **kwargs):
        self.calls.append(list(argv))
        if Path(argv[0]).name == "npm":
            if self.error:
                raise self.error
            return subprocess.CompletedProcess(argv, self.returncode, self.stdout, "")
        return subprocess.CompletedProcess(argv, 0, "", "")

    def notifications(self):
        return [call for call in self.calls if call[0] == audit.OSASCRIPT]


def zod_package(version, name=audit.CHILD):
    return json.dumps({"name": name, "version": version}).encode()


def write_zod(prefix, content):
    """Install nested Zod package.json bytes under a disposable npm prefix."""
    path = Path(prefix, audit.CHILD_NODE, "package.json")
    path.parent.mkdir(parents=True)
    path.write_bytes(content)
    return path


def invoke(command, harness, version: str | None = "3.25.76"):
    """Run main on a disposable prefix; version=None installs no Zod metadata."""
    out, err = io.StringIO(), io.StringIO()
    with (
        tempfile.TemporaryDirectory(prefix="pi-audit-prefix-") as prefix,
        mock.patch.object(audit.subprocess, "run", harness),
        redirect_stdout(out),
        redirect_stderr(err),
    ):
        if version is not None:
            write_zod(prefix, zod_package(version))
        harness.prefix = prefix
        code = audit.main([command, "--prefix", prefix, "--npm", "/abs/npm"])
    return code, out.getvalue() + err.getvalue()


class GateTests(unittest.TestCase):
    def gate(
        self, stdout="", returncode=1, error=None, version: str | None = "3.25.76"
    ):
        harness = Harness(stdout, returncode, error)
        code, output = invoke("gate", harness, version)
        self.assertEqual(
            harness.calls,
            [
                [
                    "/abs/npm",
                    "audit",
                    "--prefix",
                    harness.prefix,
                    "--omit=peer",
                    "--json",
                    "--offline=false",
                ]
            ],
        )
        return code, output

    def test_clean_audit_passes_and_reports_exception_obsolete(self):
        code, output = self.gate(report(), returncode=0)
        self.assertEqual(code, 0)
        self.assertIn("GHSA-mrhx-c7xc-m3w5", output)
        self.assertIn("no longer", output)

    def test_moderate_findings_remain_permitted(self):
        code, output = self.gate(
            report({"left-pad": vulnerable("left-pad", "moderate")})
        )
        self.assertEqual(code, 0)
        self.assertIn("no longer", output)

    def test_exact_exception_passes_with_prominent_warning(self):
        vulnerabilities = exception()
        vulnerabilities["left-pad"] = vulnerable("left-pad", "moderate")
        code, output = self.gate(report(vulnerabilities))
        self.assertEqual(code, 0)
        self.assertIn("WARNING", output)
        self.assertIn("TEMPORARY", output)
        self.assertIn("applies only to", output)
        self.assertIn("GHSA-mrhx-c7xc-m3w5", output)
        self.assertNotIn("no longer", output)

    def test_exception_requires_installed_zod_v3(self):
        # Known other majors are ordinary findings, not exceptions or errors.
        for version in ("4.0.0", "2.9.9"):
            with self.subTest(version=version):
                code, output = self.gate(report(exception()), version=version)
                self.assertEqual(code, 1)
                self.assertIn("zod", output)
                self.assertNotIn("WARNING", output)
                self.assertNotIn("ERROR", output)

    def test_unknown_zod_evidence_fails_closed(self):
        for version in (None, "3"):
            with self.subTest(version=version):
                code, output = self.gate(report(exception()), version=version)
                self.assertEqual(code, 2)
                self.assertIn("ERROR", output)
                self.assertNotIn("WARNING", output)

    def test_noncandidate_reports_need_no_zod_evidence(self):
        for stdout, returncode, status in [
            (report(), 0, 0),
            (report({"left-pad": vulnerable("left-pad", "moderate")}), 1, 0),
            (report({"lodash": vulnerable("lodash", "high")}), 1, 1),
            (report(exception(zod={"nodes": ["node_modules/zod"]})), 1, 1),
        ]:
            with self.subTest(stdout=stdout):
                code, output = self.gate(stdout, returncode, version=None)
                self.assertEqual(code, status)
                self.assertNotIn("ERROR", output)

    def test_other_zod_advisory_is_blocked(self):
        other = dict(ZOD_ADVISORY, url="https://github.com/advisories/GHSA-other")
        for via in ([other], [ZOD_ADVISORY, other]):
            with self.subTest(via=via):
                code, output = self.gate(report(exception(zod={"via": via})))
                self.assertEqual(code, 1)
                self.assertIn("zod", output)

    def test_exception_advisory_at_critical_is_blocked(self):
        critical = dict(ZOD_ADVISORY, severity="critical")
        code, _ = self.gate(
            report(
                exception(
                    zod={"via": [critical], "severity": "critical"},
                    **{"context-mode": {"severity": "critical"}},
                )
            )
        )
        self.assertEqual(code, 1)

    def test_unrelated_high_or_critical_is_blocked(self):
        for severity in ("high", "critical"):
            with self.subTest(severity=severity):
                for vulnerabilities in ({}, exception()):
                    vulnerabilities["lodash"] = vulnerable("lodash", severity)
                    code, output = self.gate(report(vulnerabilities))
                    self.assertEqual(code, 1)
                    self.assertIn("lodash", output)

    def test_changed_dependency_chain_or_path_is_blocked(self):
        for changes in [
            {"zod": {"nodes": ["node_modules/zod"]}},
            {"zod": {"nodes": EXCEPTION["zod"]["nodes"] + ["node_modules/zod"]}},
            {"zod": {"effects": ["context-mode", "pi-lens"]}},
            {"zod": {"via": [ZOD_ADVISORY, "other-package"]}},
            {"context-mode": {"via": ["zod", "lodash"]}},
            {
                "context-mode": {
                    "nodes": ["node_modules/pi-lens/node_modules/context-mode"]
                }
            },
            {"context-mode": {"effects": ["pi-lens"]}},
        ]:
            with self.subTest(changes=changes):
                vulnerabilities = exception(**changes)
                for entry in list(vulnerabilities.values()):
                    for item in entry["via"]:
                        if isinstance(item, str) and item not in vulnerabilities:
                            vulnerabilities[item] = vulnerable(item, "moderate")
                code, _ = self.gate(report(vulnerabilities))
                self.assertEqual(code, 1)

    def test_partial_exception_chain_fails_closed(self):
        # A missing zod finding leaves context-mode with a dangling reference.
        for name, status in (("context-mode", 1), ("zod", 2)):
            with self.subTest(missing=name):
                vulnerabilities = exception()
                del vulnerabilities[name]
                code, _ = self.gate(report(vulnerabilities))
                self.assertEqual(code, status)

    def test_aggregated_reference_severity_is_blocked_not_error(self):
        for stdout in aggregated_reports():
            with self.subTest(stdout=stdout):
                code, output = self.gate(stdout)
                self.assertEqual(code, 1)
                self.assertNotIn("ERROR", output)

    def test_compatible_fix_fails_gate_so_repair_is_required(self):
        for name in ("context-mode", "zod"):
            with self.subTest(name=name):
                code, output = self.gate(
                    report(exception(**{name: {"fixAvailable": True}}))
                )
                self.assertEqual(code, 1)
                self.assertIn("compatible fix", output)

    def test_forced_fix_objects_are_not_compatible(self):
        # npm reports any fixAvailable object only when --force is required.
        for major in (True, False):
            fix = {"name": "context-mode", "version": "2.0.0", "isSemVerMajor": major}
            for name in ("context-mode", "zod"):
                with self.subTest(major=major, name=name):
                    code, output = self.gate(
                        report(exception(**{name: {"fixAvailable": fix}}))
                    )
                    self.assertEqual(code, 0)
                    self.assertIn("WARNING", output)
                    self.assertNotIn("run npm audit fix", output)

    def test_malformed_or_failed_audits_fail_closed(self):
        for stdout, returncode in [
            ("", 1),
            ("not json", 1),
            ("[]", 1),
            (json.dumps({"auditReportVersion": 2}), 1),
            (report(error={"code": "ENOTFOUND", "summary": "network down"}), 1),
            (report(exception()), 2),
            (report(), 1),
            (report({"zod": dict(EXCEPTION["zod"], severity="severe")}), 1),
            (report({"zod": dict(EXCEPTION["zod"], fixAvailable="yes")}), 1),
            (report({"zod": dict(EXCEPTION["zod"], via="zod")}), 1),
            *(
                (report(exception(**{name: {"fixAvailable": fix}})), 1)
                for name in ("context-mode", "zod")
                for fix in MALFORMED_FIXES
            ),
            (report({"zod": "high"}), 1),
            *((stdout, 1) for stdout in inconsistent_reports()),
        ]:
            with self.subTest(stdout=stdout, returncode=returncode):
                code, output = self.gate(stdout, returncode)
                self.assertEqual(code, 2)
                self.assertIn("ERROR", output)

    def test_all_decoder_failures_fail_closed(self):
        for name, stdout, decoder in decoder_failures():
            with self.subTest(failure=name), decoder:
                try:
                    code, output = self.gate(stdout)
                except (ValueError, RecursionError) as error:
                    self.fail(f"decoder {type(error).__name__} escaped the gate")
                self.assertEqual(code, 2)
                self.assertIn("ERROR", output)

    def test_npm_launch_failure_or_timeout_fails_closed(self):
        for error in (
            OSError("missing npm"),
            subprocess.TimeoutExpired("npm", 300),
            DECODE_ERROR,
        ):
            with self.subTest(error=error):
                code, output = self.gate(error=error)
                self.assertEqual(code, 2)
                self.assertIn("ERROR", output)


class MonitorTests(unittest.TestCase):
    def monitor(
        self, stdout="", returncode=1, error=None, version: str | None = "3.25.76"
    ):
        harness = Harness(stdout, returncode, error)
        code, output = invoke("monitor", harness, version)
        return code, output, harness.notifications()

    def assert_fixed_notification(self, notifications, message):
        self.assertEqual(len(notifications), 1)
        self.assertEqual(notifications[0][-2:], [audit.TITLE, message])
        # AppleScript source is constant; dynamic text only travels as argv.
        self.assertEqual(notifications[0][:-2], audit.NOTIFY_COMMAND)

    def test_still_vulnerable_without_fix_is_silent(self):
        code, output, notifications = self.monitor(report(exception()))
        self.assertEqual((code, notifications), (0, []))
        self.assertIn("no compatible fix", output)

    def test_installed_zod_v4_notifies_blocked(self):
        code, _, notifications = self.monitor(report(exception()), version="4.0.0")
        self.assertEqual(code, 0)
        self.assert_fixed_notification(notifications, audit.MESSAGES["blocked"])

    def test_unknown_zod_evidence_notifies_error(self):
        code, _, notifications = self.monitor(report(exception()), version=None)
        self.assertEqual(code, 1)
        self.assert_fixed_notification(notifications, audit.MESSAGES["error"])

    def test_fixed_advisory_notifies_exception_obsolete(self):
        code, _, notifications = self.monitor(report(), returncode=0)
        self.assertEqual(code, 0)
        self.assert_fixed_notification(notifications, audit.MESSAGES["clean"])

    def test_compatible_fix_notifies(self):
        code, _, notifications = self.monitor(
            report(exception(zod={"fixAvailable": True}))
        )
        self.assertEqual(code, 0)
        self.assert_fixed_notification(notifications, audit.MESSAGES["fix-available"])

    def test_forced_fix_objects_are_silent(self):
        for major in (True, False):
            fix = {"name": "context-mode", "version": "2.0.0", "isSemVerMajor": major}
            with self.subTest(major=major):
                code, _, notifications = self.monitor(
                    report(exception(zod={"fixAvailable": fix}))
                )
                self.assertEqual((code, notifications), (0, []))

    def test_aggregated_reference_severity_notifies_blocked(self):
        for stdout in aggregated_reports():
            with self.subTest(stdout=stdout):
                code, _, notifications = self.monitor(stdout)
                self.assertEqual(code, 0)
                self.assert_fixed_notification(
                    notifications, audit.MESSAGES["blocked"]
                )

    def test_new_blocking_finding_notifies_without_dynamic_text(self):
        vulnerabilities = exception()
        vulnerabilities['x" & do shell script "id'] = vulnerable("x", "high")
        code, output, notifications = self.monitor(report(vulnerabilities))
        self.assertEqual(code, 0)
        self.assert_fixed_notification(notifications, audit.MESSAGES["blocked"])
        self.assertIn("do shell script", output)  # details stay in the log

    def test_check_errors_notify_and_fail(self):
        for stdout, error in [
            ("not json", None),
            (report(error={"code": "ENOTFOUND", "summary": "offline"}), None),
            ("", OSError("missing npm")),
            ("", DECODE_ERROR),
            *((stdout, None) for stdout in inconsistent_reports()),
        ]:
            with self.subTest(stdout=stdout, error=error):
                code, _, notifications = self.monitor(stdout, error=error)
                self.assertEqual(code, 1)
                self.assert_fixed_notification(notifications, audit.MESSAGES["error"])

    def test_decoder_failures_notify_and_fail(self):
        for name, stdout, decoder in decoder_failures():
            with self.subTest(failure=name), decoder:
                try:
                    code, _, notifications = self.monitor(stdout)
                except (ValueError, RecursionError) as error:
                    self.fail(f"decoder {type(error).__name__} escaped the monitor")
                self.assertEqual(code, 1)
                self.assert_fixed_notification(notifications, audit.MESSAGES["error"])

    def test_monitor_never_runs_repairs(self):
        harness = Harness(report(exception(zod={"fixAvailable": True})))
        invoke("monitor", harness)
        npm_calls = [call for call in harness.calls if call[0] == "/abs/npm"]
        self.assertEqual(len(npm_calls), 1)
        self.assertNotIn("fix", npm_calls[0])


FAKE_NPM = f"""#!{sys.executable}
import os, sys
if os.environ["FAKE_NPM_MODE"] == "bytes":
    sys.stdout.buffer.write(b"\\xff")
    raise SystemExit(1)
# Like real npm: offline config skips the audit request and reports nothing.
if os.environ.get("npm_config_offline") == "true" and "--offline=false" not in sys.argv:
    print('{{"auditReportVersion": 2, "vulnerabilities": {{}}}}')
    raise SystemExit(0)
print(os.environ["FAKE_NPM_REPORT"])
raise SystemExit(1)
"""


class RealSubprocessTests(unittest.TestCase):
    """Run a fake npm executable through the real subprocess boundary."""

    def run_audit(self, command, mode, version: str | None = "3.25.76"):
        with tempfile.TemporaryDirectory(prefix="pi-audit-npm-") as directory:
            if version is not None:
                write_zod(directory, zod_package(version))
            npm = Path(directory) / "npm"
            npm.write_text(FAKE_NPM)
            npm.chmod(0o700)
            env = {
                "npm_config_offline": "true",
                "FAKE_NPM_MODE": mode,
                "FAKE_NPM_REPORT": report(exception()),
            }
            out = io.StringIO()
            with (
                mock.patch.dict(os.environ, env),
                mock.patch.object(audit, "notify") as notify,
                redirect_stdout(out),
                redirect_stderr(out),
            ):
                code = audit.main([command, "--prefix", directory, "--npm", str(npm)])
            return code, out.getvalue(), [c.args for c in notify.call_args_list]

    def test_inherited_offline_config_cannot_hide_findings(self):
        code, output, _ = self.run_audit("gate", "report")
        self.assertEqual(code, 0)
        self.assertIn("WARNING", output)
        code, _, notifications = self.run_audit("monitor", "report")
        self.assertEqual((code, notifications), (0, []))

    def test_installed_zod_evidence_controls_exception(self):
        code, output, _ = self.run_audit("gate", "report", "4.0.0")
        self.assertEqual(code, 1)
        self.assertNotIn("WARNING", output)
        code, _, notifications = self.run_audit("monitor", "report", "4.0.0")
        self.assertEqual((code, notifications), (0, [(audit.MESSAGES["blocked"],)]))
        code, output, _ = self.run_audit("gate", "report", None)
        self.assertEqual(code, 2)
        self.assertIn("ERROR", output)
        code, _, notifications = self.run_audit("monitor", "report", None)
        self.assertEqual((code, notifications), (1, [(audit.MESSAGES["error"],)]))

    def test_undecodable_output_fails_closed(self):
        code, output, _ = self.run_audit("gate", "bytes")
        self.assertEqual(code, 2)
        self.assertIn("ERROR", output)
        code, _, notifications = self.run_audit("monitor", "bytes")
        self.assertEqual((code, notifications), (1, [(audit.MESSAGES["error"],)]))


class InstalledZodTests(unittest.TestCase):
    def installed(self, content):
        with tempfile.TemporaryDirectory(prefix="pi-audit-zod-") as prefix:
            if content is not None:
                write_zod(prefix, content)
            return audit.installed_zod_is_v3(prefix)

    def test_valid_versions_compare_major_as_text(self):
        for version, expected in [
            ("3.25.76", True),
            ("3.0.0-0", True),
            ("3.0.0-beta.1", True),
            ("3.25.76+build.5", True),
            ("3.0.0-rc.1+sha.0abc", True),
            ("4.0.0", False),
            ("2.9.9", False),
            ("0.1.0", False),
            ("30.0.0", False),
            # Valid but beyond int conversion limits; must not raise.
            ("1" * 5000 + ".0.0", False),
        ]:
            with self.subTest(version=version[:24]):
                self.assertIs(self.installed(zod_package(version)), expected)

    def test_unknown_evidence_raises_audit_error(self):
        cases = {
            "missing": None,
            "invalid UTF-8": b"\xff",
            "malformed JSON": b"{",
            "deep JSON": b"[" * 100_000 + b"]" * 100_000,
            "non-object": b"[]",
            "wrong name": zod_package("3.0.0", name="zod-fork"),
            "no name": json.dumps({"version": "3.0.0"}).encode(),
            "no version": json.dumps({"name": "zod"}).encode(),
            "numeric version": json.dumps({"name": "zod", "version": 3}).encode(),
        }
        for version in (
            *("", "3", "3.0", "v3.0.0", " 3.0.0", "3.0.0\n", "3.0.0.0"),
            *("03.0.0", "3.01.0", "3.0.00", "3.0.0-01", "3.0.0-rc.00"),
            *("3.0.0-", "3.0.0-a..b", "3.0.0+", "3.0.0+a..b", "3.0.0-beta_1"),
            "3.0.0-\u03b2",
        ):
            cases[repr(version)] = zod_package(version)
        for label, content in cases.items():
            with self.subTest(label), self.assertRaises(audit.AuditError):
                self.installed(content)

    @unittest.skipIf(os.geteuid() == 0, "root bypasses file permissions")
    def test_unreadable_metadata_raises_audit_error(self):
        with tempfile.TemporaryDirectory(prefix="pi-audit-zod-") as prefix:
            write_zod(prefix, zod_package("3.25.76")).chmod(0)
            with self.assertRaises(audit.AuditError):
                audit.installed_zod_is_v3(prefix)


class LaunchdTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix="pi-audit-launchd-")
        self.addCleanup(directory.cleanup)
        self.home = Path(directory.name)
        self.plist = self.home / "Library/LaunchAgents" / f"{audit.LABEL}.plist"

    def install(self, npm="/opt/node/bin/npm", python="/opt/python/bin/python3"):
        harness = Harness()
        out = io.StringIO()
        with (
            mock.patch.object(audit.subprocess, "run", harness),
            mock.patch.dict(os.environ, {"HOME": str(self.home)}),
            mock.patch.object(audit.os, "getuid", return_value=502),
            mock.patch.object(audit.shutil, "which", return_value=npm),
            mock.patch.object(audit.sys, "executable", python),
            redirect_stdout(out),
        ):
            code = audit.main(["install-launchd"])
        return code, harness.calls

    def test_renders_weekly_read_only_agent_with_absolute_paths(self):
        code, _ = self.install()
        self.assertEqual(code, 0)
        agent = plistlib.loads(self.plist.read_bytes())
        npm_root = str(self.home / ".pi/agent/npm")
        self.assertEqual(agent["Label"], audit.LABEL)
        self.assertEqual(
            agent["ProgramArguments"],
            [
                "/opt/python/bin/python3",
                str(SCRIPT),
                "monitor",
                "--prefix",
                npm_root,
                "--npm",
                "/opt/node/bin/npm",
            ],
        )
        self.assertNotIn("mise", " ".join(agent["ProgramArguments"]))
        self.assertEqual(
            agent["StartCalendarInterval"], {"Weekday": 1, "Hour": 9, "Minute": 0}
        )
        self.assertEqual(agent["WorkingDirectory"], str(ROOT))
        self.assertEqual(
            agent["EnvironmentVariables"],
            {
                "HOME": str(self.home),
                "PATH": "/opt/node/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            },
        )
        log = str(self.home / "Library/Logs/pi-npm-audit-monitor.log")
        self.assertEqual(agent["StandardOutPath"], log)
        self.assertEqual(agent["StandardErrorPath"], log)
        self.assertFalse(agent["RunAtLoad"])
        self.assertTrue((self.home / "Library/Logs").is_dir())

    def test_install_is_idempotent_and_bootstraps_gui_domain(self):
        expected = [
            [audit.LAUNCHCTL, "bootout", f"gui/502/{audit.LABEL}"],
            [audit.LAUNCHCTL, "enable", f"gui/502/{audit.LABEL}"],
            [audit.LAUNCHCTL, "bootstrap", "gui/502", str(self.plist)],
        ]
        first_code, first_calls = self.install()
        first = self.plist.read_bytes()
        second_code, second_calls = self.install()
        self.assertEqual((first_code, second_code), (0, 0))
        self.assertEqual(first_calls, expected)
        self.assertEqual(second_calls, expected)
        self.assertEqual(self.plist.read_bytes(), first)

    def test_install_refuses_unresolved_executables(self):
        for npm, python in [
            (None, "/opt/python/bin/python3"),
            ("npm", "/py"),
            ("/n", ""),
        ]:
            with self.subTest(npm=npm, python=python):
                with self.assertRaises(SystemExit):
                    self.install(npm=npm, python=python)
                self.assertFalse(self.plist.exists())


if __name__ == "__main__":
    unittest.main()
