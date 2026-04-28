"""Tests for sofia.config."""
from __future__ import annotations

from pathlib import Path

import pytest

from sofia.config import Config, load


def test_load_resolves_user_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    cfg_text = """
vault = "~/dev/SOFIA"
index_db = "~/.local/share/sofia/index.db"
state_dir = "~/.local/state/sofia"
[embed]
model = "test-model"
dim = 384
cache_dir = "~/.cache/fastembed"
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
"""
    cfg_path = tmp_path / "config.toml"
    cfg_path.write_text(cfg_text)
    monkeypatch.delenv("SOFIA_VAULT", raising=False)

    cfg = load(cfg_path)

    assert isinstance(cfg, Config)
    assert cfg.vault == Path.home() / "dev" / "SOFIA"
    assert cfg.embed_model == "test-model"
    assert cfg.vec_weight == 0.7
    assert ".obsidian/**" in cfg.ignore_globs


def test_env_var_overrides_vault(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    cfg_path = tmp_path / "config.toml"
    cfg_path.write_text("""
vault = "/should/be/overridden"
index_db = "~/.local/share/sofia/index.db"
state_dir = "~/.local/state/sofia"
[embed]
model = "m"
dim = 384
cache_dir = "~/.cache/fastembed"
[chunk]
max_tokens = 512
overlap_tokens = 64
[search]
vec_weight = 0.7
fts_weight = 0.3
default_limit = 20
[index]
ignore = []
[hooks]
session_start_max_chars = 32000
memory_max_entries = 20
""")
    monkeypatch.setenv("SOFIA_VAULT", str(tmp_path / "real_vault"))

    cfg = load(cfg_path)

    assert cfg.vault == tmp_path / "real_vault"
