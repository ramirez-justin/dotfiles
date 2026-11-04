#!/usr/bin/env python3
"""Gate and monitor npm audit findings for Pi extensions.

One temporary exception is accepted: GHSA-mrhx-c7xc-m3w5 in the Zod v3 copy
nested under context-mode, only while npm reports no compatible fix. Every
other high or critical finding, and every audit error, fails closed. Moderate
and lower findings are permitted, matching `npm audit --audit-level=high`.
"""

import argparse
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ADVISORY_ID = "GHSA-mrhx-c7xc-m3w5"
ADVISORY_URL = f"https://github.com/advisories/{ADVISORY_ID}"
PARENT, PARENT_NODE = "context-mode", "node_modules/context-mode"
CHILD, CHILD_NODE = "zod", "node_modules/context-mode/node_modules/zod"
SEVERITIES = ("info", "low", "moderate", "high", "critical")
BLOCKING = {"high", "critical"}

LABEL = "com.ramirez-justin.dotfiles.pi-npm-audit-monitor"
LAUNCHCTL = "/bin/launchctl"
OSASCRIPT = "/usr/bin/osascript"
# Constant AppleScript; title and message travel only as argv.
NOTIFY_COMMAND = [
    OSASCRIPT,
    "-e",
    "on run argv",
    "-e",
    "display notification (item 2 of argv) with title (item 1 of argv)",
    "-e",
    "end run",
]
TITLE = "Pi npm audit"
LOG = "~/Library/Logs/pi-npm-audit-monitor.log"
MESSAGES = {
    "clean": f"The temporary {ADVISORY_ID} exception is no longer needed. "
    "Run mise run pi-update, "
    "then remove the temporary exception and this monitor.",
    "fix-available": f"npm reports a compatible fix for {ADVISORY_ID}. "
    "Run mise run pi-update.",
    "blocked": "New high or critical Pi npm audit findings. "
    f"See {LOG} and run mise run pi-update.",
    "error": f"Pi npm audit check failed. See {LOG}.",
}
WARNING = f"""
==================== WARNING: TEMPORARY SECURITY EXCEPTION ====================
Accepting {ADVISORY_ID} (high): Zod can exhaust memory while validating
oversized constrained collections. This exception applies only to
{CHILD_NODE} (Zod v3, required by context-mode),
and npm reports no compatible fix. Untrusted oversized input validated by
context-mode could exhaust memory. Zod 4 is not forced onto context-mode.
Every pi-update rechecks the live audit; `mise run pi-audit-monitor` checks
weekly for a compatible fix. Remove this exception once it is obsolete.
===============================================================================
"""
OBSOLETE = (
    f"NOTICE: the temporary {ADVISORY_ID} exception no longer matches the live "
    "audit. Remove it from pi/.pi/agent/bin/pi-npm-audit.py and uninstall the "
    "weekly monitor."
)


class AuditError(Exception):
    pass


def run_audit(npm, prefix):
    # Inherited offline config makes npm skip the audit and report nothing.
    command = [
        npm,
        "audit",
        "--prefix",
        prefix,
        "--omit=peer",
        "--json",
        "--offline=false",
    ]
    try:
        result = subprocess.run(
            command, check=False, capture_output=True, encoding="utf-8", timeout=300
        )
    except (OSError, subprocess.TimeoutExpired, UnicodeError) as error:
        raise AuditError(f"npm audit could not run: {error}") from error
    try:
        report = json.loads(result.stdout)
    except (ValueError, RecursionError) as error:
        raise AuditError(
            f"npm audit JSON could not be decoded (exit {result.returncode})"
        ) from error
    if not isinstance(report, dict):
        raise AuditError("npm audit report is not a JSON object")
    if "error" in report:
        raise AuditError(f"npm audit reported an error: {json.dumps(report['error'])}")
    if result.returncode not in (0, 1):
        raise AuditError(f"npm audit exited {result.returncode}")
    vulnerabilities = report.get("vulnerabilities")
    if not isinstance(vulnerabilities, dict):
        raise AuditError("npm audit report has no vulnerabilities object")
    if result.returncode == 1 and not vulnerabilities:
        raise AuditError("npm audit failed without reporting vulnerabilities")
    for name, entry in vulnerabilities.items():
        validate(name, entry)
    for name, entry in vulnerabilities.items():
        check_severity(vulnerabilities, name, entry)
    return vulnerabilities


def validate(name, entry):
    if not isinstance(entry, dict) or entry.get("severity") not in SEVERITIES:
        raise AuditError(f"malformed audit entry for {name}")
    via = entry.get("via")
    if not isinstance(via, list) or not all(
        isinstance(item, str)
        or (isinstance(item, dict) and item.get("severity") in SEVERITIES)
        for item in via
    ):
        raise AuditError(f"malformed via list for {name}")
    fix = entry.get("fixAvailable")
    if not isinstance(fix, bool) and not (
        isinstance(fix, dict)
        and all(
            isinstance(fix.get(key), str) and fix[key] for key in ("name", "version")
        )
        and isinstance(fix.get("isSemVerMajor"), bool)
    ):
        raise AuditError(f"malformed fixAvailable for {name}")


def check_severity(vulnerabilities, name, entry):
    """A summary is at least as severe as its inline advisories. String refs
    name package summaries aggregated across installed versions, so they can
    legitimately be more severe; classify blocks those entries directly."""
    for item in entry["via"]:
        if isinstance(item, str):
            if item not in vulnerabilities:
                raise AuditError(f"{name} references missing finding {item}")
            continue
        cause = item["severity"]
        if SEVERITIES.index(cause) > SEVERITIES.index(entry["severity"]):
            raise AuditError(f"{name} severity is lower than its cause {cause}")


def is_exception(vulnerabilities):
    parent, child = vulnerabilities.get(PARENT), vulnerabilities.get(CHILD)
    if not parent or not child:
        return False
    via = child["via"]
    advisories = [
        (item.get("url"), item["severity"])
        for item in via
        if isinstance(item, dict) and item["severity"] in BLOCKING
    ]
    return (
        parent["severity"] == "high"
        and parent["via"] == [CHILD]
        and parent.get("nodes") == [PARENT_NODE]
        and parent.get("effects") == []
        and child["severity"] == "high"
        and all(isinstance(item, dict) for item in via)
        and advisories == [(ADVISORY_URL, "high")]
        and child.get("nodes") == [CHILD_NODE]
        and child.get("effects") == [PARENT]
    )


def installed_zod_is_v3(prefix):
    """Read the installed nested package; advisory ranges can span v3 and v4."""
    path = Path(prefix) / CHILD_NODE / "package.json"
    try:
        package = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, RecursionError) as error:
        raise AuditError("cannot read installed nested Zod metadata") from error
    version = (
        package.get("version")
        if isinstance(package, dict) and package.get("name") == CHILD
        else None
    )
    if not isinstance(version, str):
        raise AuditError("invalid installed nested Zod version evidence")
    match = re.fullmatch(
        r"(?P<major>0|[1-9][0-9]*)"
        r"\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"
        r"(?:-(?P<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
        r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?",
        version,
    )
    if match is None:
        raise AuditError("invalid installed nested Zod version evidence")
    prerelease = match.group("pre")
    if prerelease and any(
        part.isdigit() and len(part) > 1 and part.startswith("0")
        for part in prerelease.split(".")
    ):
        raise AuditError("invalid installed nested Zod version evidence")
    # Compare strings: enormous major numbers must not trigger int limits.
    return match.group("major") == "3"


def compatible(fix):
    # npm reports a fixAvailable object, major or not, only when the fix is
    # outside the declared range and needs --force; true means a plain fix.
    return fix is True


def classify(vulnerabilities, prefix):
    """Return (status, blocking names); status is clean, accepted,
    fix-available, or blocked."""
    blocking = sorted(
        name for name, entry in vulnerabilities.items() if entry["severity"] in BLOCKING
    )
    excepted = is_exception(vulnerabilities) and installed_zod_is_v3(prefix)
    if excepted:
        blocking = [name for name in blocking if name not in (PARENT, CHILD)]
    if blocking:
        return "blocked", blocking
    if not excepted:
        return "clean", []
    if any(
        compatible(vulnerabilities[name]["fixAvailable"]) for name in (PARENT, CHILD)
    ):
        return "fix-available", []
    return "accepted", []


def describe(vulnerabilities, names):
    for name in names:
        entry = vulnerabilities[name]
        print(
            f"  {name} ({entry['severity']}) nodes={entry.get('nodes')}",
            file=sys.stderr,
        )
        for item in entry["via"]:
            if isinstance(item, dict):
                print(
                    f"    {item['severity']}: {item.get('title')} {item.get('url')}",
                    file=sys.stderr,
                )
            else:
                print(f"    via {item}", file=sys.stderr)


def evaluate(args):
    try:
        vulnerabilities = run_audit(args.npm, args.prefix)
        status, blocking = classify(vulnerabilities, args.prefix)
    except AuditError as error:
        print(f"ERROR: Pi npm audit failed closed: {error}", file=sys.stderr)
        return None
    if blocking:
        print("High or critical Pi npm audit findings:", file=sys.stderr)
        describe(vulnerabilities, blocking)
    return status


def gate(args):
    status = evaluate(args)
    if status is None:
        return 2
    if status == "blocked":
        return 1
    if status == "fix-available":
        print(
            f"npm reports a compatible fix for {ADVISORY_ID}; run npm audit fix.",
            file=sys.stderr,
        )
        return 1
    if status == "accepted":
        print(WARNING, file=sys.stderr)
        return 0
    print("Pi extension npm audit passed: no high or critical findings.")
    print(OBSOLETE)
    return 0


def notify(message):
    subprocess.run([*NOTIFY_COMMAND, TITLE, message], check=True, timeout=30)


def monitor(args):
    print(f"{datetime.now().isoformat(timespec='seconds')} checking {args.prefix}")
    status = evaluate(args)
    key = "error" if status is None else status
    if key == "accepted":
        print(f"{ADVISORY_ID} still reported; no compatible fix. No notification.")
        return 0
    print(MESSAGES[key])
    notify(MESSAGES[key])
    return 1 if key == "error" else 0


def install_launchd(_args):
    python, npm = sys.executable, shutil.which("npm")
    if not python or not npm or not os.path.isabs(python) or not os.path.isabs(npm):
        raise SystemExit(
            "Run through `mise run pi-audit-monitor-install` so python3 and npm "
            "resolve to absolute paths."
        )
    home = Path.home()
    plist = home / "Library/LaunchAgents" / f"{LABEL}.plist"
    log = str(home / "Library/Logs/pi-npm-audit-monitor.log")
    script = Path(__file__).resolve()
    agent = {
        "Label": LABEL,
        # Resolved executables bypass mise, so the job never auto-installs tools.
        "ProgramArguments": [
            python,
            str(script),
            "monitor",
            "--prefix",
            str(home / ".pi/agent/npm"),
            "--npm",
            npm,
        ],
        "WorkingDirectory": str(script.parents[4]),
        "EnvironmentVariables": {
            "HOME": str(home),
            "PATH": f"{Path(npm).parent}:/usr/bin:/bin:/usr/sbin:/sbin",
        },
        "StartCalendarInterval": {"Weekday": 1, "Hour": 9, "Minute": 0},
        "RunAtLoad": False,
        "ProcessType": "Background",
        "StandardOutPath": log,
        "StandardErrorPath": log,
    }
    plist.parent.mkdir(parents=True, exist_ok=True)
    Path(log).parent.mkdir(parents=True, exist_ok=True)
    plist.write_bytes(plistlib.dumps(agent))
    domain = f"gui/{os.getuid()}"
    # bootout fails when the job is not loaded yet; that is the fresh-install case.
    subprocess.run(
        [LAUNCHCTL, "bootout", f"{domain}/{LABEL}"], capture_output=True, check=False
    )
    subprocess.run([LAUNCHCTL, "enable", f"{domain}/{LABEL}"], check=True)
    subprocess.run([LAUNCHCTL, "bootstrap", domain, str(plist)], check=True)
    print(f"Installed {plist}; runs Mondays 09:00 local time. Log: {log}")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name, handler in (("gate", gate), ("monitor", monitor)):
        command = commands.add_parser(name)
        command.add_argument("--prefix", required=True)
        command.add_argument("--npm", default="npm")
        command.set_defaults(handler=handler)
    commands.add_parser("install-launchd").set_defaults(handler=install_launchd)
    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
