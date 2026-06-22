#!/usr/bin/env python3
import contextlib
import json
import os
import pty
import select
import shlex
import signal
import subprocess
import sys
import time
from pathlib import Path


def read_available(master, chunks):
    while True:
        ready, _, _ = select.select([master], [], [], 0)
        if master not in ready:
            return
        try:
            data = os.read(master, 4096)
        except OSError:
            return
        if not data:
            return
        chunks.append(data)
        if sum(len(c) for c in chunks) > 200_000:
            del chunks[:-50]


def main():
    if len(sys.argv) != 2:
        print("usage: pty-runner.py <config.json>", file=sys.stderr)
        return 2

    config = json.loads(Path(sys.argv[1]).read_text())
    cwd = config["cwd"]
    prompt = config["prompt"]
    settings_path = config["settingsPath"]
    sentinel_path = Path(config["sentinelPath"])
    timeout_seconds = float(config.get("timeoutSeconds", 240))
    startup_delay_seconds = float(config.get("startupDelaySeconds", 4))
    tools = config.get("tools", ["Read", "Grep", "Glob", "LS"])

    tool_args = " ".join(shlex.quote(tool) for tool in tools)
    command = (
        "source ~/.zshrc >/dev/null 2>&1 || true; "
        f"cd {shlex.quote(cwd)}; "
        "exec claude "
        f"--settings {shlex.quote(settings_path)} "
        "--permission-mode acceptEdits "
        f"--tools {tool_args} "
        "--name pi-claude-planner "
        f"{shlex.quote(prompt)}"
    )

    master, slave = pty.openpty()
    proc = subprocess.Popen(
        ["zsh", "-ic", command],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        start_new_session=True,
    )
    os.close(slave)
    chunks = []
    start = time.time()
    sent_prompt = True
    sent_followup_submit = False
    saw_sentinel = False

    try:
        while time.time() - start < timeout_seconds:
            read_available(master, chunks)
            if proc.poll() is not None:
                break
            if (
                not sent_followup_submit
                and time.time() - start >= startup_delay_seconds
            ):
                sent_followup_submit = True
            if sentinel_path.exists():
                saw_sentinel = True
                with contextlib.suppress(OSError):
                    os.write(master, b"/quit\r")
                break
            time.sleep(0.25)
    finally:
        time.sleep(0.5)
        read_available(master, chunks)
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=3)
            except Exception:
                with contextlib.suppress(Exception):
                    os.killpg(proc.pid, signal.SIGKILL)
        with contextlib.suppress(OSError):
            os.close(master)

    output = b"".join(chunks).decode("utf-8", errors="replace")
    result = {
        "ok": saw_sentinel,
        "exitCode": proc.returncode,
        "sentPrompt": sent_prompt,
        "sentFollowupSubmit": sent_followup_submit,
        "sawSentinel": saw_sentinel,
        "capturedOutputTail": output[-8000:],
    }
    print(json.dumps(result))
    return 0 if saw_sentinel else 1


if __name__ == "__main__":
    raise SystemExit(main())
