#!/usr/bin/env python3
"""Gate npm audit findings for Pi extensions.

Every high or critical finding, and every audit error, fails closed. Moderate
and lower findings are permitted, matching `npm audit --audit-level=high`.
"""

import argparse
import json
import subprocess
import sys

SEVERITIES = ("info", "low", "moderate", "high", "critical")
BLOCKING = {"high", "critical"}


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
    legitimately be more severe; the gate blocks those entries directly."""
    for item in entry["via"]:
        if isinstance(item, str):
            if item not in vulnerabilities:
                raise AuditError(f"{name} references missing finding {item}")
            continue
        cause = item["severity"]
        if SEVERITIES.index(cause) > SEVERITIES.index(entry["severity"]):
            raise AuditError(f"{name} severity is lower than its cause {cause}")


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


def gate(args):
    try:
        vulnerabilities = run_audit(args.npm, args.prefix)
    except AuditError as error:
        print(f"ERROR: Pi npm audit failed closed: {error}", file=sys.stderr)
        return 2
    blocking = sorted(
        name for name, entry in vulnerabilities.items() if entry["severity"] in BLOCKING
    )
    if blocking:
        print("High or critical Pi npm audit findings:", file=sys.stderr)
        describe(vulnerabilities, blocking)
        return 1
    print("Pi extension npm audit passed: no high or critical findings.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("gate")
    command.add_argument("--prefix", required=True)
    command.add_argument("--npm", default="npm")
    args = parser.parse_args(argv)
    return gate(args)


if __name__ == "__main__":
    sys.exit(main())
