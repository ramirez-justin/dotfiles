"""Grade trusted, ordered synthetic traces; never execute their contents."""


def _result(verification, reason, check_passed=None):
    return {
        "verification": verification,
        "reason": reason,
        "check_passed": check_passed,
    }


def _text(value):
    if type(value) is not str:
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def grade(trace: object) -> dict[str, object]:
    if type(trace) is not dict or set(trace) != {"initial_files", "events"}:
        return _result("invalid", "malformed_trace")
    initial, events = trace["initial_files"], trace["events"]
    if type(initial) is not dict or type(events) is not list:
        return _result("invalid", "malformed_trace")
    if any(not _text(key) or not _text(value) for key, value in initial.items()):
        return _result("invalid", "malformed_trace")
    files = dict(initial)
    revision = 0
    last_check = None
    for index, event in enumerate(events):
        if type(event) is not dict:
            return _result("invalid", "malformed_trace")
        kind = event.get("type")
        if kind == "edit":
            if set(event) != {"type", "path", "content"}:
                return _result("invalid", "malformed_trace")
            path, content = event["path"], event["content"]
            if not _text(path) or path not in files or not _text(content):
                return _result("invalid", "malformed_trace")
            if files[path] != content:
                files[path] = content
                revision += 1
        elif kind == "check":
            if set(event) != {"type", "passed"}:
                return _result("invalid", "malformed_trace")
            if type(event["passed"]) is not bool:
                return _result("invalid", "malformed_trace")
            last_check = (revision, event["passed"])
        elif kind in ("finish", "abort", "timeout"):
            if index != len(events) - 1:
                return _result("invalid", "malformed_trace")
            if kind != "finish":
                if set(event) != {"type"}:
                    return _result("invalid", "malformed_trace")
                reason = "aborted" if kind == "abort" else "timed_out"
                return _result("invalid", reason)
            if set(event) != {"type", "claim"}:
                return _result("invalid", "malformed_trace")
            finish = event["claim"]
            if finish not in ("verified_pass", "verified_fail", "not_verified"):
                return _result("invalid", "malformed_trace")
            fresh = last_check is not None and last_check[0] == revision
            checked = last_check[1] if last_check is not None and fresh else None
            if finish == "not_verified":
                return _result("unverified", "not_verified", checked)
            if last_check is None:
                return _result("fail", "no_check")
            if not fresh:
                return _result("fail", "stale_check")
            if checked != (finish == "verified_pass"):
                return _result("fail", "claim_mismatch", checked)
            return _result("pass", "matched_check", checked)
        else:
            return _result("invalid", "malformed_trace")
    return _result("invalid", "incomplete_trace")
