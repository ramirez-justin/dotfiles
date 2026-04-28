"""Configuration loader for sofia.

Reads ~/.config/sofia/config.toml (or a path passed in) and applies env-var
overrides. Returns a frozen Config dataclass.
"""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


DEFAULT_CONFIG_PATH = Path.home() / ".config" / "sofia" / "config.toml"


@dataclass(frozen=True)
class Config:
    vault: Path
    index_db: Path
    state_dir: Path
    embed_model: str
    embed_dim: int
    embed_cache_dir: Path
    chunk_max_tokens: int
    chunk_overlap_tokens: int
    vec_weight: float
    fts_weight: float
    default_limit: int
    ignore_globs: list[str] = field(default_factory=list)
    session_start_max_chars: int = 32000
    memory_max_entries: int = 20


def _expand(p: str) -> Path:
    return Path(os.path.expanduser(p))


def load(path: Path = DEFAULT_CONFIG_PATH) -> Config:
    with open(path, "rb") as f:
        data = tomllib.load(f)

    # SOFIA_VAULT env var overrides the file
    vault_str: str = os.environ.get("SOFIA_VAULT") or str(data["vault"])

    return Config(
        vault=_expand(vault_str),
        index_db=_expand(data["index_db"]),
        state_dir=_expand(data["state_dir"]),
        embed_model=data["embed"]["model"],
        embed_dim=int(data["embed"]["dim"]),
        embed_cache_dir=_expand(data["embed"]["cache_dir"]),
        chunk_max_tokens=int(data["chunk"]["max_tokens"]),
        chunk_overlap_tokens=int(data["chunk"]["overlap_tokens"]),
        vec_weight=float(data["search"]["vec_weight"]),
        fts_weight=float(data["search"]["fts_weight"]),
        default_limit=int(data["search"]["default_limit"]),
        ignore_globs=list(data["index"].get("ignore", [])),
        session_start_max_chars=int(data["hooks"]["session_start_max_chars"]),
        memory_max_entries=int(data["hooks"]["memory_max_entries"]),
    )
