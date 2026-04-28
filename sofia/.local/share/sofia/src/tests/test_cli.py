from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from sofia.cli import app


runner = CliRunner()


def _write_config(tmp_path: Path, vault: Path, db_path: Path) -> Path:
    cfg = tmp_path / "config.toml"
    cfg.write_text(f"""
vault = "{vault}"
index_db = "{db_path}"
state_dir = "{tmp_path / 'state'}"

[embed]
model = "sentence-transformers/all-MiniLM-L6-v2"
dim = 384
cache_dir = "{tmp_path / 'embed_cache'}"

[chunk]
max_tokens = 512
overlap_tokens = 64

[search]
vec_weight = 0.7
fts_weight = 0.3
default_limit = 20

[index]
ignore = [".obsidian/**"]

[hooks]
session_start_max_chars = 32000
memory_max_entries = 20
""")
    return cfg


def test_cli_help_lists_subcommands():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    out = result.stdout
    for cmd in ["init", "index", "search", "status", "doctor"]:
        assert cmd in out


def test_cli_index_then_search_roundtrip(tmp_vault: Path, tmp_db: Path, tmp_path: Path, monkeypatch):
    cfg = _write_config(tmp_path, tmp_vault, tmp_db)
    monkeypatch.setenv("SOFIA_CONFIG", str(cfg))

    # Use a stub embedder by setting an env var the CLI honours in tests.
    monkeypatch.setenv("SOFIA_TEST_STUB_EMBEDDER", "1")

    r1 = runner.invoke(app, ["index"])
    assert r1.exit_code == 0, r1.output
    assert "indexed" in r1.output.lower()

    r2 = runner.invoke(app, ["search", "memory", "--json"])
    assert r2.exit_code == 0, r2.output
    payload = json.loads(r2.output)
    assert isinstance(payload, list)
    assert len(payload) > 0
    assert "path" in payload[0]


def test_cli_status_reports_db_stats(tmp_vault: Path, tmp_db: Path, tmp_path: Path, monkeypatch):
    cfg = _write_config(tmp_path, tmp_vault, tmp_db)
    monkeypatch.setenv("SOFIA_CONFIG", str(cfg))
    monkeypatch.setenv("SOFIA_TEST_STUB_EMBEDDER", "1")
    runner.invoke(app, ["index"])

    r = runner.invoke(app, ["status"])
    assert r.exit_code == 0, r.output
    assert "documents" in r.output.lower()
    assert "chunks" in r.output.lower()
