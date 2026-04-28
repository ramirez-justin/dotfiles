from __future__ import annotations

import json
from pathlib import Path

import pytest

from sofia.hooks import session_start


def test_build_payload_includes_soul_user_and_memory(tmp_vault: Path):
    payload = session_start.build_payload(
        vault=tmp_vault,
        context="personal",
        max_chars=32000,
        memory_max_entries=20,
    )
    assert "SOUL" in payload
    assert "USER" in payload
    assert "Personal Memory" in payload or "personal" in payload.lower()
    assert "context: personal" in payload.lower() or "personal" in payload.lower()


def test_build_payload_picks_correct_context_memory(tmp_vault: Path):
    p_payload = session_start.build_payload(vault=tmp_vault, context="personal", max_chars=32000, memory_max_entries=20)
    w_payload = session_start.build_payload(vault=tmp_vault, context="work", max_chars=32000, memory_max_entries=20)
    assert "Personal Memory" in p_payload
    assert "Work Memory" in w_payload
    # Personal payload should not mention work memory's distinctive phrase.
    assert "Quarterly reviews" not in p_payload
    # And vice versa.
    assert "Decided to use uv" not in w_payload


def test_payload_respects_size_budget(tmp_vault: Path):
    # Use a tiny budget; payload should still emit but be truncated.
    payload = session_start.build_payload(
        vault=tmp_vault, context="personal", max_chars=200, memory_max_entries=20,
    )
    assert len(payload) <= 250  # 200 + small overshoot tolerance for marker text


def test_payload_truncates_memory_entries(tmp_vault: Path):
    # Stuff memory.md with many entries.
    mem = tmp_vault / "_agent" / "memory" / "personal.md"
    blocks = "\n\n".join(
        f"## 2026-04-{i:02d} · decision\nEntry {i}." for i in range(1, 30)
    )
    mem.write_text(f"---\ntype: memory\ncontext: personal\n---\n# Personal Memory\n\n{blocks}")

    payload = session_start.build_payload(
        vault=tmp_vault, context="personal", max_chars=32000, memory_max_entries=5,
    )
    # only the most recent 5 should appear
    assert payload.count("· decision") <= 5


def test_emit_outputs_claude_hook_json(tmp_vault: Path, capsys: pytest.CaptureFixture):
    session_start.emit(
        vault=tmp_vault, context="personal",
        max_chars=32000, memory_max_entries=20,
    )
    captured = capsys.readouterr().out
    payload = json.loads(captured)
    assert "hookSpecificOutput" in payload
    additional = payload["hookSpecificOutput"]["additionalContext"]
    assert "SOUL" in additional


def test_emit_handles_missing_vault_gracefully(tmp_path: Path, capsys: pytest.CaptureFixture):
    missing = tmp_path / "no_vault_here"
    session_start.emit(
        vault=missing, context="personal",
        max_chars=32000, memory_max_entries=20,
    )
    captured = capsys.readouterr().out
    # Should still emit valid JSON, just with a minimal/empty additionalContext.
    payload = json.loads(captured)
    assert "hookSpecificOutput" in payload
