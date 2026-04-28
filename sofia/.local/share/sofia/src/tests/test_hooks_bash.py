from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest


TOPIC_ROOT = Path(__file__).resolve().parents[5]
HOOKS = TOPIC_ROOT / ".claude" / "hooks"
PRE_COMPACT = HOOKS / "sofia-pre-compact.sh"
SESSION_END = HOOKS / "sofia-session-end.sh"


def _run_hook(script: Path, payload: dict, vault: Path) -> subprocess.CompletedProcess:
    env = {
        **os.environ,
        "SOFIA_VAULT": str(vault),
        "SOFIA_LOG": str(vault / "hooks.log"),  # keep test logs in tmp
    }
    return subprocess.run(
        [str(script)], input=json.dumps(payload),
        capture_output=True, text=True, env=env,
    )


@pytest.fixture
def vault_with_dirs(tmp_vault: Path) -> Path:
    return tmp_vault


def test_pre_compact_appends_section_to_today_personal(vault_with_dirs: Path):
    payload = {
        "cwd": "/Users/anyone/personal",
        "transcript_path": "/path/to/transcript.jsonl",
        "session_id": "abc-123",
        "trigger": "auto",
    }
    res = _run_hook(PRE_COMPACT, payload, vault_with_dirs)
    assert res.returncode == 0, res.stderr

    daily = vault_with_dirs / "_agent" / "daily" / "personal"
    files = list(daily.glob("*.md"))
    assert len(files) == 1
    body = files[0].read_text()
    assert "session pre-compact" in body
    assert "transcript.jsonl" in body
    assert "abc-123" in body


def test_pre_compact_routes_work_context_when_in_telophaseqs(vault_with_dirs: Path):
    payload = {
        "cwd": f"{os.path.expanduser('~')}/telophaseqs/repo",
        "transcript_path": "/t.jsonl",
        "session_id": "xyz",
        "trigger": "manual",
    }
    res = _run_hook(PRE_COMPACT, payload, vault_with_dirs)
    assert res.returncode == 0, res.stderr

    work_dir = vault_with_dirs / "_agent" / "daily" / "work"
    personal_dir = vault_with_dirs / "_agent" / "daily" / "personal"
    assert any(work_dir.glob("*.md"))
    assert not any(personal_dir.glob("*.md"))


def test_session_end_appends_section(vault_with_dirs: Path):
    payload = {
        "cwd": "/Users/anyone/personal",
        "transcript_path": "/t.jsonl",
        "session_id": "s-1",
        "reason": "exit",
    }
    res = _run_hook(SESSION_END, payload, vault_with_dirs)
    assert res.returncode == 0

    files = list((vault_with_dirs / "_agent" / "daily" / "personal").glob("*.md"))
    assert len(files) == 1
    body = files[0].read_text()
    assert "session end" in body
    assert "exit" in body


def test_hooks_dont_block_on_bad_json(vault_with_dirs: Path):
    res = subprocess.run(
        [str(PRE_COMPACT)], input="not json at all",
        capture_output=True, text=True,
        env={**os.environ, "SOFIA_VAULT": str(vault_with_dirs), "SOFIA_LOG": str(vault_with_dirs / "log")},
    )
    # Hooks must always exit 0 to avoid blocking sessions.
    assert res.returncode == 0
