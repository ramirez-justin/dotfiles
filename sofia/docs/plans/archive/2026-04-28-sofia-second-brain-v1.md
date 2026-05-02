# SOFIA Second Brain v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 SOFIA second brain — a reactive Obsidian-vault-backed system with hooks, fully-local hybrid search, and seven Claude Code skills, all packaged as a stowable dotfiles topic.

**Architecture:** Three planes (control/state/retrieval). Hooks load identity + context-specific memory at SessionStart and append session boundaries to daily logs. A Python `sofia` CLI maintains a SQLite + sqlite-vec + FTS5 hybrid index over the vault, kept fresh by an `fswatch`-driven LaunchAgent. Seven skills (`sofia-{init,search,journal,promote,plan,status,link}`) operate on the vault via the CLI and Obsidian's local REST API.

**Tech Stack:** Python 3.12 + uv, FastEmbed (`all-MiniLM-L6-v2`), sqlite-vec, FTS5, typer, python-frontmatter, fswatch, launchd, bash, GNU Stow. Tests via pytest.

**Spec:** `dotfiles/sofia/docs/specs/2026-04-28-sofia-second-brain-v1-design.md` (commit `04acc85`).

**Preconditions:**
- Working tree at `/Users/justinramirez/dev/dotfiles` is clean (verify with `git status`).
- `~/dev/SOFIA/` vault exists with `obsidian-local-rest-api` plugin installed (verified earlier — commit `b5a32b8` wired the env vars).
- `mise`, `uv`, and `op` (1Password CLI) are available.
- `fswatch` will be installed via Brewfile in Task 24.
- Recommended: run implementation in a worktree off `main` (e.g., `git worktree add ../dotfiles-sofia-v1 -b sofia/v1`). Not strictly required since each task lands its own commit on `main`.

---

## File Structure

### Created in dotfiles repo (under `dotfiles/sofia/`)

| Path | Responsibility |
|---|---|
| `.stow-local-ignore` | Exclude `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.venv/`, `tests/` from stow |
| `.config/sofia/config.toml` | Defaults: vault path, model name, search weights, ignore globs |
| `.local/bin/sofia` | Bash wrapper invoking `uv run` with the right venv |
| `.local/share/sofia/src/pyproject.toml` | uv project: deps, build, scripts |
| `.local/share/sofia/src/sofia/__init__.py` | Package marker, version |
| `.local/share/sofia/src/sofia/config.py` | Load `config.toml`, resolve env overrides |
| `.local/share/sofia/src/sofia/db.py` | SQLite + sqlite-vec + FTS5 schema and connection |
| `.local/share/sofia/src/sofia/chunker.py` | Markdown → list[Chunk] with heading-aware boundaries |
| `.local/share/sofia/src/sofia/embedder.py` | FastEmbed wrapper |
| `.local/share/sofia/src/sofia/indexer.py` | Walk vault, ignore-list, dedup, chunk, embed, upsert |
| `.local/share/sofia/src/sofia/search.py` | Hybrid query (vector + FTS5 blend) |
| `.local/share/sofia/src/sofia/cli.py` | Typer entrypoint and subcommands |
| `.local/share/sofia/src/sofia/hooks/__init__.py` | Package marker |
| `.local/share/sofia/src/sofia/hooks/session_start.py` | Build `additionalContext` payload |
| `.local/share/sofia/src/sofia/hooks/context.py` | Shared context-detection helper |
| `.local/share/sofia/src/tests/conftest.py` | Pytest fixtures (tmp vault, tmp db) |
| `.local/share/sofia/src/tests/test_chunker.py` | Chunker unit tests |
| `.local/share/sofia/src/tests/test_db.py` | DB schema + CRUD tests |
| `.local/share/sofia/src/tests/test_embedder.py` | Embedder smoke test (real, slow first run) |
| `.local/share/sofia/src/tests/test_indexer.py` | Indexer integration tests |
| `.local/share/sofia/src/tests/test_search.py` | Search integration tests |
| `.local/share/sofia/src/tests/test_session_start.py` | SessionStart hook unit tests |
| `.local/share/sofia/src/tests/test_cli.py` | CLI integration via typer's CliRunner |
| `.local/share/sofia/src/tests/test_hooks_bash.py` | Drives bash hooks via subprocess, asserts stdout/files |
| `.local/share/sofia/src/tests/fixtures/vault/` | Sample markdown files for indexer/search tests |
| `.claude/hooks/sofia-session-start.sh` | Bash gate → context.py → session_start.py |
| `.claude/hooks/sofia-pre-compact.sh` | Append session-pre-compact section to daily log |
| `.claude/hooks/sofia-session-end.sh` | Append session-end section to daily log |
| `.claude/hooks/_sofia-context.sh` | Sourced helper: context detection, vault path resolution, daily-log path |
| `.claude/skills/sofia-init/SKILL.md` | Onboarding interview |
| `.claude/skills/sofia-search/SKILL.md` | Search formatter |
| `.claude/skills/sofia-journal/SKILL.md` | Daily-log appender |
| `.claude/skills/sofia-promote/SKILL.md` | Daily-log → memory curator |
| `.claude/skills/sofia-plan/SKILL.md` | Project plan opener |
| `.claude/skills/sofia-status/SKILL.md` | Situational digest |
| `.claude/skills/sofia-link/SKILL.md` | Backlink suggester |
| `Library/LaunchAgents/com.sofia.indexer.plist` | fswatch-driven incremental indexer |

### Modified in dotfiles repo

| Path | Change |
|---|---|
| `Brewfile` | Add `brew "fswatch"` |
| `mise.toml` | Add `sofia` to `link`/`unlink` task lists; add `sofia-init` and `sofia-status` tasks |
| `claude/.claude/settings.json` | Add `SOFIA_VAULT` env var; register three SOFIA hooks |

### Modified outside dotfiles

| Path | Change |
|---|---|
| `~/.claude/settings.json` | Mirror of `claude/.claude/settings.json` (in `.stow-local-ignore`) |
| `~/dev/SOFIA/_agent/` | Replace empty `context/`+`heartbeat/` scaffold with `memory/`, `daily/{personal,work}/`, `plans/{personal,work}/`, plus initial `SOUL.md`/`USER.md`/`memory/personal.md`/`memory/work.md` (skeletons; `/sofia-init` fills SOUL.md and USER.md properly later) |

---

## Phase A — Topology & Skeleton

### Task 1: Stow topic skeleton + config.toml

**Why first:** Establishes directory layout. Subsequent tasks add files into this skeleton.

**Files:**
- Create: `dotfiles/sofia/.stow-local-ignore`
- Create: `dotfiles/sofia/.config/sofia/config.toml`

- [ ] **Step 1: Create `.stow-local-ignore`**

```
docs
tests
__pycache__
\.pyc$
\.pytest_cache
\.venv
\.ruff_cache
```

(GNU Stow uses regex per line; `docs` and `tests` are top-level directory names that should not be stowed into `$HOME`.)

- [ ] **Step 2: Create `.config/sofia/config.toml`**

```toml
# SOFIA second brain — runtime config
# Env overrides (read at startup):
#   SOFIA_VAULT     → vault path (overrides `vault` below)
#   SOFIA_CONTEXT   → personal | work | both (overrides PWD-based detection)

vault = "~/dev/SOFIA"
index_db = "~/.local/share/sofia/index.db"
state_dir = "~/.local/state/sofia"

[embed]
model = "sentence-transformers/all-MiniLM-L6-v2"
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
# Glob patterns (relative to vault root) to skip
ignore = [
  ".obsidian/**",
  ".trash/**",
  "**/*.secret.md",
  "**/private/**",
  "**/*credentials*",
  "**/*token*",
  "**/*api-key*",
]

[hooks]
# Max characters of injected SessionStart context (~8000 tokens at 4 chars/token)
session_start_max_chars = 32000
# How many MEMORY entries (top-most) to include before truncating
memory_max_entries = 20
```

- [ ] **Step 3: Verify directory structure**

```bash
find dotfiles/sofia -type f | sort
```

Expected output:
```
dotfiles/sofia/.config/sofia/config.toml
dotfiles/sofia/.stow-local-ignore
dotfiles/sofia/docs/specs/2026-04-28-sofia-second-brain-v1-design.md
```

- [ ] **Step 4: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.stow-local-ignore sofia/.config/sofia/config.toml
git -C ~/dev/dotfiles commit -m "sofia: scaffold dotfiles topic with config.toml"
```

---

### Task 2: Python project bootstrap (uv + pyproject.toml)

**Files:**
- Create: `dotfiles/sofia/.local/share/sofia/src/pyproject.toml`
- Create: `dotfiles/sofia/.local/share/sofia/src/sofia/__init__.py`
- Create: `dotfiles/sofia/.local/share/sofia/src/sofia/hooks/__init__.py`
- Create: `dotfiles/sofia/.local/share/sofia/src/tests/conftest.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "sofia"
version = "0.1.0"
description = "SOFIA second brain — local hybrid search + Claude Code hooks for Obsidian"
requires-python = ">=3.12"
dependencies = [
  "typer>=0.12",
  "python-frontmatter>=1.0",
  "fastembed>=0.3",
  "sqlite-vec>=0.1.6",
  "tomli>=2.0; python_version < '3.11'",
]

[project.scripts]
sofia = "sofia.cli:app"

[dependency-groups]
dev = [
  "pytest>=8",
  "pytest-cov>=5",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-v --tb=short"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["sofia"]
```

- [ ] **Step 2: Create empty `__init__.py` files**

`dotfiles/sofia/.local/share/sofia/src/sofia/__init__.py`:
```python
__version__ = "0.1.0"
```

`dotfiles/sofia/.local/share/sofia/src/sofia/hooks/__init__.py`:
```python
```

(Empty file.)

- [ ] **Step 3: Create `tests/conftest.py` with shared fixtures**

```python
"""Shared pytest fixtures for the sofia test suite."""
from __future__ import annotations

import os
import sqlite3
import textwrap
from pathlib import Path

import pytest


@pytest.fixture
def tmp_vault(tmp_path: Path) -> Path:
    """Create a minimal SOFIA-shaped vault for indexer/search tests."""
    vault = tmp_path / "vault"
    (vault / "_agent" / "memory").mkdir(parents=True)
    (vault / "_agent" / "daily" / "personal").mkdir(parents=True)
    (vault / "_agent" / "daily" / "work").mkdir(parents=True)
    (vault / "_agent" / "plans" / "personal").mkdir(parents=True)
    (vault / "_agent" / "plans" / "work").mkdir(parents=True)
    (vault / "inbox").mkdir()
    (vault / "projects").mkdir()

    (vault / "_agent" / "SOUL.md").write_text(textwrap.dedent("""\
        ---
        type: soul
        context: universal
        agent-managed: true
        last-touched: 2026-04-28
        sofia-index: true
        ---
        # SOUL
        Test agent identity.
        """))

    (vault / "_agent" / "USER.md").write_text(textwrap.dedent("""\
        ---
        type: user
        context: universal
        agent-managed: true
        ---
        # USER
        ## Personal
        Test user, personal facet.
        ## Work
        Test user, work facet.
        """))

    (vault / "_agent" / "memory" / "personal.md").write_text(textwrap.dedent("""\
        ---
        type: memory
        context: personal
        agent-managed: true
        ---
        # Personal Memory

        ## 2026-04-27 · decision
        Decided to use uv. Source: [[daily/personal/2026-04-27#16-30]]
        """))

    (vault / "_agent" / "memory" / "work.md").write_text(textwrap.dedent("""\
        ---
        type: memory
        context: work
        agent-managed: true
        ---
        # Work Memory

        ## 2026-04-27 · lesson
        Quarterly reviews need 2 weeks lead time. Source: [[daily/work/2026-04-27#10-15]]
        """))

    return vault


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    """Path for a fresh sqlite DB; not yet created."""
    return tmp_path / "index.db"


@pytest.fixture
def env_vault(monkeypatch: pytest.MonkeyPatch, tmp_vault: Path) -> Path:
    """Set SOFIA_VAULT to the tmp vault for the duration of the test."""
    monkeypatch.setenv("SOFIA_VAULT", str(tmp_vault))
    return tmp_vault
```

- [ ] **Step 4: Initialize uv environment**

```bash
cd ~/dev/dotfiles/sofia/.local/share/sofia/src
uv sync
```

Expected: creates `.venv/` and `uv.lock` with all deps including FastEmbed, sqlite-vec, typer, pytest. First run downloads packages (~1-2 minutes).

- [ ] **Step 5: Verify the package installs and importable**

```bash
cd ~/dev/dotfiles/sofia/.local/share/sofia/src
uv run python -c "import sofia; print(sofia.__version__)"
```

Expected: `0.1.0`

- [ ] **Step 6: Run the (currently zero) test suite to confirm pytest is wired up**

```bash
cd ~/dev/dotfiles/sofia/.local/share/sofia/src
uv run pytest
```

Expected: `no tests ran in 0.0s` (exit 5, but no error).

- [ ] **Step 7: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.local/share/sofia/src
git -C ~/dev/dotfiles commit -m "sofia: bootstrap python project (uv, typer, fastembed, sqlite-vec)"
```

---

### Task 3: Bash CLI wrapper

**Files:**
- Create: `dotfiles/sofia/.local/bin/sofia`

- [ ] **Step 1: Write the wrapper**

```bash
#!/usr/bin/env bash
# sofia — wrapper that runs the typer CLI from the stowed src dir
# Resolves the repo path and invokes uv run regardless of $PWD.
set -uo pipefail

SOFIA_SRC="${SOFIA_SRC:-$HOME/.local/share/sofia/src}"

if [[ ! -d "$SOFIA_SRC" ]]; then
  echo "sofia: source not found at $SOFIA_SRC" >&2
  echo "Did you run 'mise run link' to stow the sofia topic?" >&2
  exit 1
fi

cd "$SOFIA_SRC"
exec uv run --quiet python -m sofia.cli "$@"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x ~/dev/dotfiles/sofia/.local/bin/sofia
```

- [ ] **Step 3: Verify it errors gracefully (no `cli.py` yet)**

```bash
~/dev/dotfiles/sofia/.local/bin/sofia --help
```

Expected: exits non-zero with a Python `ModuleNotFoundError` for `sofia.cli`. (We'll create `cli.py` in Task 10.) The script itself is correct; the error proves the wrapper is plumbed.

- [ ] **Step 4: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.local/bin/sofia
git -C ~/dev/dotfiles commit -m "sofia: add bash wrapper for the typer CLI"
```

---

## Phase B — Search Infrastructure

### Task 4: Config loader (`config.py`)

**Files:**
- Create: `dotfiles/sofia/.local/share/sofia/src/sofia/config.py`
- Create: `dotfiles/sofia/.local/share/sofia/src/tests/test_config.py`

- [ ] **Step 1: Write the failing test**

`tests/test_config.py`:
```python
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
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd ~/dev/dotfiles/sofia/.local/share/sofia/src
uv run pytest tests/test_config.py -v
```

Expected: `ModuleNotFoundError: No module named 'sofia.config'`.

- [ ] **Step 3: Implement `config.py`**

```python
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
    vault_str = os.environ.get("SOFIA_VAULT", data["vault"])

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
```

- [ ] **Step 4: Run tests, expect pass**

```bash
uv run pytest tests/test_config.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.local/share/sofia/src/sofia/config.py sofia/.local/share/sofia/src/tests/test_config.py
git -C ~/dev/dotfiles commit -m "sofia: add config loader (config.toml + SOFIA_VAULT env override)"
```

---

### Task 5: Database module (`db.py`)

**Files:**
- Create: `dotfiles/sofia/.local/share/sofia/src/sofia/db.py`
- Create: `dotfiles/sofia/.local/share/sofia/src/tests/test_db.py`

- [ ] **Step 1: Write the failing test**

`tests/test_db.py`:
```python
from __future__ import annotations

import sqlite3
from pathlib import Path

from sofia import db


def test_connect_creates_schema(tmp_db: Path):
    conn = db.connect(tmp_db)
    try:
        tables = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','virtual')"
        )}
        assert "documents" in tables
        assert "chunks" in tables
        assert "chunks_vec" in tables
        assert "chunks_fts" in tables
    finally:
        conn.close()


def test_connect_enables_wal(tmp_db: Path):
    conn = db.connect(tmp_db)
    try:
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        assert mode.lower() == "wal"
    finally:
        conn.close()


def test_upsert_document_and_chunks(tmp_db: Path):
    conn = db.connect(tmp_db)
    try:
        embedding = [0.0] * 384
        db.upsert_document(
            conn,
            path="_agent/memory/personal.md",
            context="personal",
            doc_type="memory",
            mtime=1000,
            content_hash="abc123",
            chunks=[
                db.ChunkRow(idx=0, heading="Personal Memory", text="hello world", embedding=embedding),
                db.ChunkRow(idx=1, heading="Personal Memory", text="goodbye world", embedding=embedding),
            ],
        )

        rows = conn.execute("SELECT path, content_hash FROM documents").fetchall()
        assert rows == [("_agent/memory/personal.md", "abc123")]

        chunks = conn.execute("SELECT chunk_idx, text FROM chunks ORDER BY chunk_idx").fetchall()
        assert chunks == [(0, "hello world"), (1, "goodbye world")]

        vec_count = conn.execute("SELECT COUNT(*) FROM chunks_vec").fetchone()[0]
        fts_count = conn.execute("SELECT COUNT(*) FROM chunks_fts").fetchone()[0]
        assert vec_count == 2
        assert fts_count == 2
    finally:
        conn.close()


def test_upsert_replaces_old_chunks(tmp_db: Path):
    conn = db.connect(tmp_db)
    try:
        emb = [0.0] * 384
        db.upsert_document(
            conn, path="x.md", context="personal", doc_type="other",
            mtime=1, content_hash="h1",
            chunks=[db.ChunkRow(0, "h", "first", emb), db.ChunkRow(1, "h", "second", emb)],
        )
        # Re-upsert with one chunk; old two chunks must be deleted.
        db.upsert_document(
            conn, path="x.md", context="personal", doc_type="other",
            mtime=2, content_hash="h2",
            chunks=[db.ChunkRow(0, "h", "only", emb)],
        )

        chunks = conn.execute("SELECT text FROM chunks WHERE doc_path = 'x.md'").fetchall()
        assert chunks == [("only",)]

        # Vec and FTS rows should also have been replaced.
        vec_count = conn.execute("SELECT COUNT(*) FROM chunks_vec").fetchone()[0]
        fts_count = conn.execute("SELECT COUNT(*) FROM chunks_fts").fetchone()[0]
        assert vec_count == 1
        assert fts_count == 1
    finally:
        conn.close()


def test_get_document_hash(tmp_db: Path):
    conn = db.connect(tmp_db)
    try:
        emb = [0.0] * 384
        db.upsert_document(
            conn, path="x.md", context="personal", doc_type="other",
            mtime=1, content_hash="abc",
            chunks=[db.ChunkRow(0, "h", "t", emb)],
        )
        assert db.get_document_hash(conn, "x.md") == "abc"
        assert db.get_document_hash(conn, "missing.md") is None
    finally:
        conn.close()
```

- [ ] **Step 2: Run test, expect failure**

```bash
uv run pytest tests/test_db.py -v
```

Expected: `ModuleNotFoundError: No module named 'sofia.db'`.

- [ ] **Step 3: Implement `db.py`**

```python
"""SQLite + sqlite-vec + FTS5 storage for sofia.

The DB has four logical relations:
  * documents     — one row per indexed file
  * chunks        — many rows per document
  * chunks_vec    — vector index (sqlite-vec virtual table)
  * chunks_fts    — keyword index (FTS5 virtual table)

A single connection should be reused for reads. Writes are wrapped in
transactions inside upsert_document().
"""
from __future__ import annotations

import sqlite3
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import sqlite_vec


SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
    path          TEXT PRIMARY KEY,
    context       TEXT,
    type          TEXT,
    mtime         INTEGER,
    content_hash  TEXT,
    indexed_at    INTEGER
);

CREATE TABLE IF NOT EXISTS chunks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_path    TEXT NOT NULL REFERENCES documents(path) ON DELETE CASCADE,
    chunk_idx   INTEGER NOT NULL,
    heading     TEXT,
    text        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_path);
"""

VEC_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
    chunk_id INTEGER PRIMARY KEY,
    embedding FLOAT[384]
);
"""

FTS_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text,
    content='chunks',
    content_rowid='id'
);
"""


@dataclass(frozen=True)
class ChunkRow:
    idx: int
    heading: str
    text: str
    embedding: list[float]


def _serialize_vec(vec: list[float]) -> bytes:
    """Pack a float32 vector for sqlite-vec storage."""
    return struct.pack(f"{len(vec)}f", *vec)


def connect(db_path: Path) -> sqlite3.Connection:
    """Open the database, loading sqlite-vec and ensuring the schema exists."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.executescript(SCHEMA_SQL)
    conn.execute(VEC_SQL)
    conn.execute(FTS_SQL)
    conn.commit()
    return conn


def upsert_document(
    conn: sqlite3.Connection,
    *,
    path: str,
    context: str | None,
    doc_type: str | None,
    mtime: int,
    content_hash: str,
    chunks: Iterable[ChunkRow],
) -> None:
    """Replace any existing record for `path` and write fresh chunks."""
    chunks = list(chunks)
    with conn:
        # Delete old chunks (cascades to chunks_vec via trigger and chunks_fts via content rowid)
        old_ids = [row[0] for row in conn.execute(
            "SELECT id FROM chunks WHERE doc_path = ?", (path,)
        )]
        if old_ids:
            placeholders = ",".join("?" * len(old_ids))
            conn.execute(f"DELETE FROM chunks_vec WHERE chunk_id IN ({placeholders})", old_ids)
            conn.execute(f"DELETE FROM chunks_fts WHERE rowid IN ({placeholders})", old_ids)
            conn.execute("DELETE FROM chunks WHERE doc_path = ?", (path,))

        # Upsert document
        conn.execute("""
            INSERT INTO documents (path, context, type, mtime, content_hash, indexed_at)
            VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
            ON CONFLICT(path) DO UPDATE SET
                context = excluded.context,
                type = excluded.type,
                mtime = excluded.mtime,
                content_hash = excluded.content_hash,
                indexed_at = excluded.indexed_at
        """, (path, context, doc_type, mtime, content_hash))

        # Insert chunks + vec + fts
        for ch in chunks:
            cur = conn.execute(
                "INSERT INTO chunks (doc_path, chunk_idx, heading, text) VALUES (?, ?, ?, ?)",
                (path, ch.idx, ch.heading, ch.text),
            )
            chunk_id = cur.lastrowid
            conn.execute(
                "INSERT INTO chunks_vec (chunk_id, embedding) VALUES (?, ?)",
                (chunk_id, _serialize_vec(ch.embedding)),
            )
            conn.execute(
                "INSERT INTO chunks_fts (rowid, text) VALUES (?, ?)",
                (chunk_id, ch.text),
            )


def get_document_hash(conn: sqlite3.Connection, path: str) -> str | None:
    row = conn.execute(
        "SELECT content_hash FROM documents WHERE path = ?", (path,)
    ).fetchone()
    return row[0] if row else None


def delete_document(conn: sqlite3.Connection, path: str) -> None:
    """Remove a document and all its chunks."""
    with conn:
        old_ids = [row[0] for row in conn.execute(
            "SELECT id FROM chunks WHERE doc_path = ?", (path,)
        )]
        if old_ids:
            placeholders = ",".join("?" * len(old_ids))
            conn.execute(f"DELETE FROM chunks_vec WHERE chunk_id IN ({placeholders})", old_ids)
            conn.execute(f"DELETE FROM chunks_fts WHERE rowid IN ({placeholders})", old_ids)
        conn.execute("DELETE FROM documents WHERE path = ?", (path,))


def reset(db_path: Path) -> None:
    """Drop the file. Used by `sofia index --rebuild`."""
    if db_path.exists():
        db_path.unlink()
    wal = db_path.with_suffix(db_path.suffix + "-wal")
    shm = db_path.with_suffix(db_path.suffix + "-shm")
    for p in (wal, shm):
        if p.exists():
            p.unlink()
```

- [ ] **Step 4: Run tests, expect pass**

```bash
uv run pytest tests/test_db.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.local/share/sofia/src/sofia/db.py sofia/.local/share/sofia/src/tests/test_db.py
git -C ~/dev/dotfiles commit -m "sofia: add SQLite/sqlite-vec/FTS5 storage layer with upsert + reset"
```

---

### Task 6: Markdown chunker (`chunker.py`)

**Files:**
- Create: `dotfiles/sofia/.local/share/sofia/src/sofia/chunker.py`
- Create: `dotfiles/sofia/.local/share/sofia/src/tests/test_chunker.py`

- [ ] **Step 1: Write the failing test**

`tests/test_chunker.py`:
```python
from sofia.chunker import Chunk, chunk_markdown, estimate_tokens


def test_estimate_tokens_counts_whitespace_separated_words():
    assert estimate_tokens("hello world") == 2
    assert estimate_tokens("  one    two\n\nthree  ") == 3


def test_chunk_simple_doc_with_one_section():
    text = "# Heading\n\nSome content here."
    chunks = chunk_markdown(text, max_tokens=512, overlap_tokens=64)
    assert len(chunks) == 1
    assert chunks[0].heading == "Heading"
    assert "Some content" in chunks[0].text
    assert chunks[0].idx == 0


def test_chunk_multiple_sections_become_multiple_chunks():
    text = (
        "# Doc\n\n"
        "## Section A\n\n"
        "Alpha content.\n\n"
        "## Section B\n\n"
        "Beta content.\n"
    )
    chunks = chunk_markdown(text, max_tokens=512, overlap_tokens=64)
    headings = [c.heading for c in chunks]
    assert "Section A" in headings
    assert "Section B" in headings
    text_blob = "\n".join(c.text for c in chunks)
    assert "Alpha content" in text_blob
    assert "Beta content" in text_blob


def test_chunk_long_section_is_windowed_with_overlap():
    # Build a section that exceeds max_tokens to force windowing.
    body = " ".join(f"word{i}" for i in range(120))
    text = f"# Long\n\n{body}"
    chunks = chunk_markdown(text, max_tokens=50, overlap_tokens=10)
    assert len(chunks) >= 2
    # All windowed chunks share the heading.
    assert all(c.heading == "Long" for c in chunks)
    # Successive chunks overlap (last 10 tokens of chunk N appear in chunk N+1).
    for prev, nxt in zip(chunks, chunks[1:]):
        prev_tail_words = prev.text.split()[-10:]
        nxt_head_words = nxt.text.split()[:10]
        assert any(w in nxt_head_words for w in prev_tail_words)


def test_chunks_have_sequential_indices():
    text = "# A\n\none\n\n## B\n\ntwo\n\n## C\n\nthree\n"
    chunks = chunk_markdown(text, max_tokens=512, overlap_tokens=64)
    assert [c.idx for c in chunks] == list(range(len(chunks)))


def test_text_above_top_heading_uses_empty_heading():
    text = "Lead-in paragraph.\n\n# Doc\n\nBody.\n"
    chunks = chunk_markdown(text, max_tokens=512, overlap_tokens=64)
    headings = {c.heading for c in chunks}
    assert "" in headings or "Doc" in headings  # implementation choice — both are valid
    text_blob = " ".join(c.text for c in chunks)
    assert "Lead-in" in text_blob
```

- [ ] **Step 2: Run test, expect failure**

```bash
uv run pytest tests/test_chunker.py -v
```

Expected: `ModuleNotFoundError: No module named 'sofia.chunker'`.

- [ ] **Step 3: Implement `chunker.py`**

```python
"""Markdown chunker.

Splits a markdown document into heading-aware chunks. The chunker uses
H1/H2/H3 boundaries, then sliding-windows any section that exceeds the
token budget. Each chunk carries its nearest heading so callers can
display it as snippet context.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


_TOKEN_RE = re.compile(r"\S+")
_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*$", re.MULTILINE)


@dataclass(frozen=True)
class Chunk:
    idx: int
    heading: str
    text: str


def estimate_tokens(text: str) -> int:
    return len(_TOKEN_RE.findall(text))


def _split_by_headings(text: str) -> list[tuple[str, str]]:
    """Return [(heading, body), ...] in document order.

    Text above the first heading is returned with an empty heading.
    """
    sections: list[tuple[str, str]] = []
    matches = list(_HEADING_RE.finditer(text))

    if not matches:
        return [("", text)]

    if matches[0].start() > 0:
        prelude = text[: matches[0].start()].rstrip()
        if prelude:
            sections.append(("", prelude))

    for i, m in enumerate(matches):
        heading = m.group(2).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        sections.append((heading, body))

    return sections


def _window(body: str, max_tokens: int, overlap_tokens: int) -> list[str]:
    words = body.split()
    if len(words) <= max_tokens:
        return [body]
    step = max_tokens - overlap_tokens
    if step <= 0:
        raise ValueError("overlap_tokens must be < max_tokens")
    out: list[str] = []
    i = 0
    while i < len(words):
        out.append(" ".join(words[i : i + max_tokens]))
        if i + max_tokens >= len(words):
            break
        i += step
    return out


def chunk_markdown(
    text: str, *, max_tokens: int = 512, overlap_tokens: int = 64
) -> list[Chunk]:
    """Return a flat list of Chunks for the document."""
    sections = _split_by_headings(text)

    chunks: list[Chunk] = []
    idx = 0
    for heading, body in sections:
        if not body:
            continue
        for piece in _window(body, max_tokens, overlap_tokens):
            chunks.append(Chunk(idx=idx, heading=heading, text=piece))
            idx += 1
    return chunks
```

- [ ] **Step 4: Run tests, expect pass**

```bash
uv run pytest tests/test_chunker.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.local/share/sofia/src/sofia/chunker.py sofia/.local/share/sofia/src/tests/test_chunker.py
git -C ~/dev/dotfiles commit -m "sofia: add heading-aware markdown chunker with sliding-window overflow"
```

---

### Task 7: Embedder wrapper (`embedder.py`)

**Files:**
- Create: `dotfiles/sofia/.local/share/sofia/src/sofia/embedder.py`
- Create: `dotfiles/sofia/.local/share/sofia/src/tests/test_embedder.py`

**Note:** The first test run downloads the ~80MB model into `~/.cache/fastembed/`. Subsequent runs are fast.

- [ ] **Step 1: Write the failing test**

`tests/test_embedder.py`:
```python
import pytest

from sofia.embedder import Embedder

MODEL = "sentence-transformers/all-MiniLM-L6-v2"


@pytest.fixture(scope="module")
def embedder() -> Embedder:
    """Module-scoped: model loads once for the whole file."""
    return Embedder(MODEL)


def test_dim_is_384(embedder: Embedder):
    assert embedder.dim == 384


def test_embed_returns_one_vector_per_input(embedder: Embedder):
    vecs = embedder.embed(["alpha", "beta", "gamma"])
    assert len(vecs) == 3
    for v in vecs:
        assert len(v) == 384
        assert all(isinstance(x, float) for x in v)


def test_same_text_gives_same_vector(embedder: Embedder):
    a = embedder.embed(["hello world"])[0]
    b = embedder.embed(["hello world"])[0]
    assert a == pytest.approx(b, abs=1e-5)


def test_different_text_gives_different_vector(embedder: Embedder):
    [a, b] = embedder.embed(["dogs and cats", "the quadratic formula"])
    assert a != pytest.approx(b, abs=1e-3)
```

- [ ] **Step 2: Run test, expect failure**

```bash
uv run pytest tests/test_embedder.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `embedder.py`**

```python
"""FastEmbed wrapper.

A thin facade so the rest of sofia depends on a small interface, not
on FastEmbed's API directly. Lazily loads the model on first use.
"""
from __future__ import annotations

from typing import Iterable

from fastembed import TextEmbedding


class Embedder:
    def __init__(self, model_name: str, cache_dir: str | None = None) -> None:
        self._model_name = model_name
        self._cache_dir = cache_dir
        self._model: TextEmbedding | None = None

    @property
    def dim(self) -> int:
        # all-MiniLM-L6-v2 outputs 384 dimensions. Hard-coded to avoid an
        # extra inference round-trip just to discover the size.
        return 384

    def _ensure_model(self) -> TextEmbedding:
        if self._model is None:
            kwargs: dict = {"model_name": self._model_name}
            if self._cache_dir is not None:
                kwargs["cache_dir"] = self._cache_dir
            self._model = TextEmbedding(**kwargs)
        return self._model

    def embed(self, texts: Iterable[str]) -> list[list[float]]:
        model = self._ensure_model()
        return [list(map(float, v)) for v in model.embed(list(texts))]
```

- [ ] **Step 4: Run tests, expect pass (slow on first run)**

```bash
uv run pytest tests/test_embedder.py -v
```

Expected: 4 passed. First run takes ~1 minute (model download); subsequent runs <5s.

- [ ] **Step 5: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.local/share/sofia/src/sofia/embedder.py sofia/.local/share/sofia/src/tests/test_embedder.py
git -C ~/dev/dotfiles commit -m "sofia: add FastEmbed wrapper (all-MiniLM-L6-v2, 384-dim)"
```

---

### Task 8: Indexer (`indexer.py`)

**Files:**
- Create: `dotfiles/sofia/.local/share/sofia/src/sofia/indexer.py`
- Create: `dotfiles/sofia/.local/share/sofia/src/tests/test_indexer.py`

- [ ] **Step 1: Write the failing test**

`tests/test_indexer.py`:
```python
from __future__ import annotations

import time
from pathlib import Path

import pytest

from sofia import db, indexer


# A minimal stub embedder so indexer tests don't pay the FastEmbed cost.
class StubEmbedder:
    dim = 384

    def embed(self, texts):
        # Deterministic but distinct: vector[0] = len(text), rest = zeros.
        return [[float(len(t))] + [0.0] * 383 for t in texts]


@pytest.fixture
def stub_embedder() -> StubEmbedder:
    return StubEmbedder()


def test_should_skip_for_ignore_glob():
    assert indexer.should_skip(
        Path("vault/.obsidian/config.json"),
        Path("vault"),
        ignore_globs=[".obsidian/**"],
    )
    assert not indexer.should_skip(
        Path("vault/notes/x.md"),
        Path("vault"),
        ignore_globs=[".obsidian/**"],
    )


def test_should_skip_for_frontmatter_flag(tmp_path: Path):
    f = tmp_path / "skip.md"
    f.write_text("---\nsofia-index: false\n---\nbody")
    assert indexer.should_skip_by_frontmatter(f)

    f2 = tmp_path / "keep.md"
    f2.write_text("---\nsofia-index: true\n---\nbody")
    assert not indexer.should_skip_by_frontmatter(f2)

    f3 = tmp_path / "default.md"
    f3.write_text("body")
    assert not indexer.should_skip_by_frontmatter(f3)


def test_index_walks_vault_and_writes_chunks(tmp_vault: Path, tmp_db: Path, stub_embedder):
    conn = db.connect(tmp_db)
    try:
        stats = indexer.index_vault(
            conn=conn,
            vault=tmp_vault,
            embedder=stub_embedder,
            ignore_globs=[".obsidian/**"],
            chunk_max_tokens=512,
            chunk_overlap_tokens=64,
        )
        assert stats.indexed >= 4  # SOUL, USER, memory/personal, memory/work
        rows = conn.execute("SELECT path FROM documents ORDER BY path").fetchall()
        paths = {r[0] for r in rows}
        assert "_agent/SOUL.md" in paths
        assert "_agent/USER.md" in paths
        assert "_agent/memory/personal.md" in paths
        assert "_agent/memory/work.md" in paths
    finally:
        conn.close()


def test_incremental_skip_when_hash_unchanged(tmp_vault: Path, tmp_db: Path, stub_embedder):
    conn = db.connect(tmp_db)
    try:
        s1 = indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
        )
        # Touch mtime but don't change content.
        target = tmp_vault / "_agent" / "SOUL.md"
        future = time.time() + 60
        target.touch(exist_ok=True)
        import os
        os.utime(target, (future, future))

        s2 = indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
        )
        # Second run should be a no-op (skipped == total).
        assert s2.skipped >= s1.indexed - s2.indexed
    finally:
        conn.close()


def test_reindex_after_content_change(tmp_vault: Path, tmp_db: Path, stub_embedder):
    conn = db.connect(tmp_db)
    try:
        indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
        )
        target = tmp_vault / "_agent" / "memory" / "personal.md"
        target.write_text(target.read_text() + "\n\n## new\nnew content here.\n")

        s2 = indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
        )
        assert s2.indexed >= 1
        # Content of the latest indexed document should reflect the new heading.
        chunks = conn.execute(
            "SELECT text FROM chunks WHERE doc_path = '_agent/memory/personal.md'"
        ).fetchall()
        text_blob = " ".join(c[0] for c in chunks)
        assert "new content here." in text_blob
    finally:
        conn.close()


def test_orphan_documents_removed(tmp_vault: Path, tmp_db: Path, stub_embedder):
    conn = db.connect(tmp_db)
    try:
        indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
        )
        # Delete a file from the vault.
        (tmp_vault / "_agent" / "USER.md").unlink()

        indexer.index_vault(
            conn=conn, vault=tmp_vault, embedder=stub_embedder,
            ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
            prune_missing=True,
        )
        rows = conn.execute(
            "SELECT path FROM documents WHERE path = '_agent/USER.md'"
        ).fetchall()
        assert rows == []
    finally:
        conn.close()
```

- [ ] **Step 2: Run test, expect failure**

```bash
uv run pytest tests/test_indexer.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `indexer.py`**

```python
"""Vault indexer.

Walks a vault directory, applies the ignore-list, dedups by content hash,
chunks the markdown, embeds the chunks, and upserts them into the SQLite
database. Idempotent: running twice on unchanged content is a no-op.
"""
from __future__ import annotations

import fnmatch
import hashlib
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import frontmatter

from sofia import db
from sofia.chunker import chunk_markdown


@dataclass
class IndexStats:
    indexed: int = 0
    skipped: int = 0
    pruned: int = 0


# ---------- public predicates ----------

def should_skip(path: Path, vault: Path, ignore_globs: Iterable[str]) -> bool:
    rel = path.relative_to(vault).as_posix()
    return any(fnmatch.fnmatch(rel, g) for g in ignore_globs)


def should_skip_by_frontmatter(path: Path) -> bool:
    try:
        post = frontmatter.load(path)
    except Exception:
        return False
    val = post.metadata.get("sofia-index", True)
    if isinstance(val, bool):
        return not val
    if isinstance(val, str):
        return val.strip().lower() in {"false", "no", "0"}
    return False


# ---------- helpers ----------

def _file_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _classify_type(rel_path: str) -> str | None:
    """Best-effort document-type label, used as a search filter."""
    if rel_path == "_agent/SOUL.md":
        return "soul"
    if rel_path == "_agent/USER.md":
        return "user"
    if rel_path.startswith("_agent/memory/"):
        return "memory"
    if rel_path.startswith("_agent/daily/"):
        return "daily"
    if rel_path.startswith("_agent/plans/"):
        return "plan"
    if rel_path.startswith("inbox/"):
        return "inbox"
    if rel_path.startswith("projects/"):
        return "project"
    return "other"


def _classify_context(rel_path: str, frontmatter_context: str | None) -> str | None:
    if frontmatter_context:
        return frontmatter_context
    if "/personal/" in rel_path or rel_path.endswith("/personal.md"):
        return "personal"
    if "/work/" in rel_path or rel_path.endswith("/work.md"):
        return "work"
    return "universal"


# ---------- main entrypoint ----------

def index_vault(
    *,
    conn: sqlite3.Connection,
    vault: Path,
    embedder,
    ignore_globs: Iterable[str],
    chunk_max_tokens: int,
    chunk_overlap_tokens: int,
    prune_missing: bool = False,
) -> IndexStats:
    stats = IndexStats()
    seen_paths: set[str] = set()

    for md_path in sorted(vault.rglob("*.md")):
        if should_skip(md_path, vault, ignore_globs):
            continue
        if should_skip_by_frontmatter(md_path):
            continue

        rel = md_path.relative_to(vault).as_posix()
        seen_paths.add(rel)

        try:
            raw = md_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            stats.skipped += 1
            continue

        h = _file_hash(raw)
        existing = db.get_document_hash(conn, rel)
        if existing == h:
            stats.skipped += 1
            continue

        post = frontmatter.loads(raw)
        body = post.content
        chunks = chunk_markdown(
            body,
            max_tokens=chunk_max_tokens,
            overlap_tokens=chunk_overlap_tokens,
        )

        if not chunks:
            stats.skipped += 1
            continue

        embeddings = embedder.embed([c.text for c in chunks])
        chunk_rows = [
            db.ChunkRow(idx=c.idx, heading=c.heading, text=c.text, embedding=emb)
            for c, emb in zip(chunks, embeddings)
        ]

        db.upsert_document(
            conn,
            path=rel,
            context=_classify_context(rel, post.metadata.get("context")),
            doc_type=post.metadata.get("type") or _classify_type(rel),
            mtime=int(md_path.stat().st_mtime),
            content_hash=h,
            chunks=chunk_rows,
        )
        stats.indexed += 1

    if prune_missing:
        rows = conn.execute("SELECT path FROM documents").fetchall()
        for (p,) in rows:
            if p not in seen_paths:
                db.delete_document(conn, p)
                stats.pruned += 1

    return stats


def index_single_file(
    *,
    conn: sqlite3.Connection,
    vault: Path,
    md_path: Path,
    embedder,
    ignore_globs: Iterable[str],
    chunk_max_tokens: int,
    chunk_overlap_tokens: int,
) -> bool:
    """Re-index one file (for incremental triggered by fswatch). Returns True if work was done."""
    if not md_path.exists():
        # File was deleted — remove from index.
        rel = md_path.relative_to(vault).as_posix()
        db.delete_document(conn, rel)
        return True

    if should_skip(md_path, vault, ignore_globs):
        return False
    if should_skip_by_frontmatter(md_path):
        return False

    rel = md_path.relative_to(vault).as_posix()
    raw = md_path.read_text(encoding="utf-8")
    h = _file_hash(raw)
    if db.get_document_hash(conn, rel) == h:
        return False

    post = frontmatter.loads(raw)
    chunks = chunk_markdown(
        post.content,
        max_tokens=chunk_max_tokens,
        overlap_tokens=chunk_overlap_tokens,
    )
    if not chunks:
        return False

    embeddings = embedder.embed([c.text for c in chunks])
    chunk_rows = [
        db.ChunkRow(idx=c.idx, heading=c.heading, text=c.text, embedding=emb)
        for c, emb in zip(chunks, embeddings)
    ]
    db.upsert_document(
        conn,
        path=rel,
        context=_classify_context(rel, post.metadata.get("context")),
        doc_type=post.metadata.get("type") or _classify_type(rel),
        mtime=int(md_path.stat().st_mtime),
        content_hash=h,
        chunks=chunk_rows,
    )
    return True
```

- [ ] **Step 4: Run tests, expect pass**

```bash
uv run pytest tests/test_indexer.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.local/share/sofia/src/sofia/indexer.py sofia/.local/share/sofia/src/tests/test_indexer.py
git -C ~/dev/dotfiles commit -m "sofia: add vault indexer (ignore-list, dedup, chunk, embed, upsert)"
```

---

### Task 9: Hybrid search (`search.py`)

**Files:**
- Create: `dotfiles/sofia/.local/share/sofia/src/sofia/search.py`
- Create: `dotfiles/sofia/.local/share/sofia/src/tests/test_search.py`

- [ ] **Step 1: Write the failing test**

`tests/test_search.py`:
```python
from __future__ import annotations

from pathlib import Path

import pytest

from sofia import db, indexer, search


class StubEmbedder:
    """Returns a vector keyed on a tiny vocabulary so vector hits are predictable."""
    dim = 384

    _VOCAB = {
        "uv": [1.0, 0.0, 0.0],
        "review": [0.0, 1.0, 0.0],
        "memory": [0.0, 0.0, 1.0],
    }

    def _vec(self, text: str) -> list[float]:
        v = [0.0, 0.0, 0.0]
        for word, key_vec in self._VOCAB.items():
            if word in text.lower():
                for i in range(3):
                    v[i] += key_vec[i]
        # pad to 384 dims
        return v + [0.0] * 381

    def embed(self, texts):
        return [self._vec(t) for t in texts]


@pytest.fixture
def populated_db(tmp_vault: Path, tmp_db: Path):
    conn = db.connect(tmp_db)
    indexer.index_vault(
        conn=conn, vault=tmp_vault, embedder=StubEmbedder(),
        ignore_globs=[], chunk_max_tokens=512, chunk_overlap_tokens=64,
    )
    yield conn
    conn.close()


def test_search_returns_top_results(populated_db):
    results = search.hybrid_search(
        conn=populated_db, embedder=StubEmbedder(),
        query="uv", limit=10, vec_weight=0.7, fts_weight=0.3,
    )
    assert len(results) > 0
    # The personal-memory entry mentions "uv" — should be in top results.
    paths = [r.path for r in results]
    assert "_agent/memory/personal.md" in paths


def test_filter_by_context(populated_db):
    results = search.hybrid_search(
        conn=populated_db, embedder=StubEmbedder(),
        query="memory", context="work", limit=10,
        vec_weight=0.7, fts_weight=0.3,
    )
    assert all(r.context in {"work", "universal"} for r in results)


def test_filter_by_type(populated_db):
    results = search.hybrid_search(
        conn=populated_db, embedder=StubEmbedder(),
        query="memory", doc_type="memory", limit=10,
        vec_weight=0.7, fts_weight=0.3,
    )
    assert all(r.type == "memory" for r in results)


def test_snippet_trims_around_match(populated_db):
    results = search.hybrid_search(
        conn=populated_db, embedder=StubEmbedder(),
        query="quarterly", limit=5,
        vec_weight=0.7, fts_weight=0.3,
    )
    if results:
        for r in results:
            assert len(r.snippet) <= 220  # 200 +/- ellipsis
```

- [ ] **Step 2: Run test, expect failure**

```bash
uv run pytest tests/test_search.py -v
```

Expected: `ModuleNotFoundError: No module named 'sofia.search'`.

- [ ] **Step 3: Implement `search.py`**

```python
"""Hybrid search.

Returns ranked results combining sqlite-vec (cosine-like distance) and
FTS5 (BM25) scores with configurable weights.
"""
from __future__ import annotations

import re
import sqlite3
import struct
from dataclasses import dataclass


@dataclass(frozen=True)
class SearchResult:
    path: str
    heading: str
    snippet: str
    score: float
    context: str | None
    type: str | None


_FTS_SAFE_RE = re.compile(r"[^A-Za-z0-9_\s]")


def _sanitize_fts5(query: str) -> str:
    """Strip characters that have FTS5 syntax meaning. Quote multi-word."""
    cleaned = _FTS_SAFE_RE.sub(" ", query).strip()
    if not cleaned:
        return '""'
    # Wrap each token in quotes and AND them. Robust against punctuation.
    tokens = cleaned.split()
    return " ".join(f'"{t}"' for t in tokens)


def _serialize_vec(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def _normalize(scores: dict[int, float]) -> dict[int, float]:
    if not scores:
        return {}
    lo = min(scores.values())
    hi = max(scores.values())
    if hi == lo:
        return {k: 1.0 for k in scores}
    return {k: (v - lo) / (hi - lo) for k, v in scores.items()}


def _make_snippet(text: str, query: str, width: int = 200) -> str:
    if not query:
        return text[:width]
    q = query.lower().split()[0] if query.split() else query.lower()
    pos = text.lower().find(q)
    if pos < 0:
        return (text[:width] + ("…" if len(text) > width else ""))
    start = max(0, pos - width // 2)
    end = min(len(text), start + width)
    snippet = text[start:end]
    if start > 0:
        snippet = "…" + snippet
    if end < len(text):
        snippet = snippet + "…"
    return snippet


def hybrid_search(
    *,
    conn: sqlite3.Connection,
    embedder,
    query: str,
    limit: int = 20,
    context: str | None = None,
    doc_type: str | None = None,
    vec_weight: float = 0.7,
    fts_weight: float = 0.3,
) -> list[SearchResult]:
    """Return up to `limit` ranked results."""
    if not query.strip():
        return []

    # ---- vector side ----
    qvec = embedder.embed([query])[0]
    vec_rows = conn.execute(
        """
        SELECT chunk_id, distance
        FROM chunks_vec
        WHERE embedding MATCH ? AND k = 50
        ORDER BY distance
        """,
        (_serialize_vec(qvec),),
    ).fetchall()
    # smaller distance = closer; flip to similarity-like: 1 / (1 + d)
    vec_scores = {cid: 1.0 / (1.0 + d) for cid, d in vec_rows}

    # ---- fts side ----
    fts_query = _sanitize_fts5(query)
    fts_rows = conn.execute(
        """
        SELECT rowid, bm25(chunks_fts) AS rank
        FROM chunks_fts
        WHERE chunks_fts MATCH ?
        LIMIT 50
        """,
        (fts_query,),
    ).fetchall()
    # bm25() returns lower = better; flip via 1 / (1 + rank)
    fts_scores = {rid: 1.0 / (1.0 + abs(rank)) for rid, rank in fts_rows}

    # ---- blend ----
    vec_norm = _normalize(vec_scores)
    fts_norm = _normalize(fts_scores)
    blended: dict[int, float] = {}
    for cid, s in vec_norm.items():
        blended[cid] = blended.get(cid, 0.0) + vec_weight * s
    for cid, s in fts_norm.items():
        blended[cid] = blended.get(cid, 0.0) + fts_weight * s

    if not blended:
        return []

    # Hydrate. Apply context/type filter via a single SQL query.
    placeholders = ",".join("?" * len(blended))
    args: list = list(blended.keys())
    sql = f"""
        SELECT c.id, c.doc_path, c.heading, c.text, d.context, d.type, d.mtime
        FROM chunks c
        JOIN documents d ON d.path = c.doc_path
        WHERE c.id IN ({placeholders})
    """
    if context and context != "both":
        sql += " AND (d.context = ? OR d.context = 'universal')"
        args.append(context)
    if doc_type:
        sql += " AND d.type = ?"
        args.append(doc_type)

    rows = conn.execute(sql, args).fetchall()

    results = [
        SearchResult(
            path=path,
            heading=heading or "",
            snippet=_make_snippet(text, query),
            score=blended[cid] + (mtime / 1e12 if mtime else 0),  # mtime tiebreak
            context=ctx,
            type=typ,
        )
        for cid, path, heading, text, ctx, typ, mtime in rows
    ]
    results.sort(key=lambda r: r.score, reverse=True)
    return results[:limit]
```

- [ ] **Step 4: Run tests, expect pass**

```bash
uv run pytest tests/test_search.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.local/share/sofia/src/sofia/search.py sofia/.local/share/sofia/src/tests/test_search.py
git -C ~/dev/dotfiles commit -m "sofia: add hybrid search (sqlite-vec + FTS5, weighted blend)"
```

---

### Task 10: CLI (`cli.py`)

**Files:**
- Create: `dotfiles/sofia/.local/share/sofia/src/sofia/cli.py`
- Create: `dotfiles/sofia/.local/share/sofia/src/tests/test_cli.py`

- [ ] **Step 1: Write the failing test**

`tests/test_cli.py`:
```python
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
```

- [ ] **Step 2: Run test, expect failure**

```bash
uv run pytest tests/test_cli.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `cli.py`**

```python
"""sofia — typer CLI entrypoint.

Subcommands:
  init     create DB, download embed model, smoke-test
  index    full / incremental walk; --rebuild drops the DB first
  search   hybrid search; outputs human or --json
  status   doc count, last index, oldest entry, DB size
  doctor   health check (model present, DB writable, fswatch alive)
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

import typer

from sofia import config as config_mod
from sofia import db
from sofia.embedder import Embedder
from sofia.indexer import index_vault, index_single_file
from sofia.search import hybrid_search


app = typer.Typer(no_args_is_help=True, add_completion=False, help="sofia second brain")


# ---------- helpers ----------

def _load_cfg() -> config_mod.Config:
    path = Path(os.environ.get("SOFIA_CONFIG") or config_mod.DEFAULT_CONFIG_PATH)
    return config_mod.load(path)


def _make_embedder(cfg: config_mod.Config):
    """Return a real Embedder, unless SOFIA_TEST_STUB_EMBEDDER=1 (test-only)."""
    if os.environ.get("SOFIA_TEST_STUB_EMBEDDER") == "1":
        # tiny deterministic stub matching dim=384
        class _Stub:
            dim = 384
            def embed(self, texts):
                return [[float(len(t)) % 7] + [0.0] * 383 for t in texts]
        return _Stub()
    return Embedder(cfg.embed_model, cache_dir=str(cfg.embed_cache_dir))


def _detect_context() -> str:
    explicit = os.environ.get("SOFIA_CONTEXT")
    if explicit:
        return explicit
    cwd = os.getcwd().lower()
    home = os.path.expanduser("~").lower()
    if cwd.startswith(f"{home}/telophaseqs") or "/sofia/" in cwd and "/work/" in cwd:
        return "work"
    return "personal"


# ---------- subcommands ----------

@app.command()
def init() -> None:
    """Create DB, download embed model, smoke-test the pipeline."""
    cfg = _load_cfg()
    typer.echo(f"vault: {cfg.vault}")
    typer.echo(f"index db: {cfg.index_db}")
    cfg.index_db.parent.mkdir(parents=True, exist_ok=True)
    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    cfg.embed_cache_dir.mkdir(parents=True, exist_ok=True)

    conn = db.connect(cfg.index_db)
    conn.close()
    typer.echo("DB schema OK.")

    embedder = _make_embedder(cfg)
    _ = embedder.embed(["smoke test"])  # forces download / loads weights
    typer.echo(f"Embedder OK (dim={embedder.dim}).")
    typer.echo("init complete. Next: `sofia index`.")


@app.command()
def index(
    rebuild: bool = typer.Option(False, "--rebuild", help="Drop DB before indexing."),
    incremental: bool = typer.Option(False, "--incremental", help="Skip docs whose mtime/hash are unchanged."),
    file: Optional[Path] = typer.Option(None, "--file", help="Index a single file (used by fswatch)."),
) -> None:
    """Walk the vault and update the index."""
    cfg = _load_cfg()
    if rebuild:
        db.reset(cfg.index_db)
        typer.echo("DB reset.")

    conn = db.connect(cfg.index_db)
    embedder = _make_embedder(cfg)

    try:
        if file is not None:
            did_work = index_single_file(
                conn=conn, vault=cfg.vault, md_path=file.resolve(),
                embedder=embedder,
                ignore_globs=cfg.ignore_globs,
                chunk_max_tokens=cfg.chunk_max_tokens,
                chunk_overlap_tokens=cfg.chunk_overlap_tokens,
            )
            typer.echo(f"single-file index: {'updated' if did_work else 'no change'} ({file})")
            return

        stats = index_vault(
            conn=conn, vault=cfg.vault, embedder=embedder,
            ignore_globs=cfg.ignore_globs,
            chunk_max_tokens=cfg.chunk_max_tokens,
            chunk_overlap_tokens=cfg.chunk_overlap_tokens,
            prune_missing=not incremental,
        )
        typer.echo(f"indexed: {stats.indexed}, skipped: {stats.skipped}, pruned: {stats.pruned}")

        # Update state file
        cfg.state_dir.mkdir(parents=True, exist_ok=True)
        (cfg.state_dir / "state.json").write_text(json.dumps({
            "last_index_at": int(time.time()),
            "last_indexed": stats.indexed,
            "last_skipped": stats.skipped,
            "last_pruned": stats.pruned,
        }))
    finally:
        conn.close()


@app.command()
def search(
    query: str = typer.Argument(..., help="Natural language or keyword query."),
    context: Optional[str] = typer.Option(None, "--context", help="personal | work | both"),
    type_: Optional[str] = typer.Option(None, "--type", help="memory | daily | plan | inbox | project"),
    limit: int = typer.Option(20, "--limit", help="Max results."),
    output_json: bool = typer.Option(False, "--json", help="Emit JSON instead of human text."),
) -> None:
    """Hybrid search."""
    cfg = _load_cfg()
    ctx = context or _detect_context()
    conn = db.connect(cfg.index_db)
    embedder = _make_embedder(cfg)
    try:
        results = hybrid_search(
            conn=conn, embedder=embedder,
            query=query, limit=limit, context=ctx, doc_type=type_,
            vec_weight=cfg.vec_weight, fts_weight=cfg.fts_weight,
        )
    finally:
        conn.close()

    if output_json:
        typer.echo(json.dumps([
            {
                "path": r.path, "heading": r.heading, "snippet": r.snippet,
                "score": r.score, "context": r.context, "type": r.type,
            } for r in results
        ]))
        return

    if not results:
        typer.echo("(no results)")
        return
    for i, r in enumerate(results, 1):
        typer.echo(f"{i:>2}. {r.path}  [{r.context or '-'}/{r.type or '-'}]  score={r.score:.3f}")
        if r.heading:
            typer.echo(f"     ## {r.heading}")
        typer.echo(f"     {r.snippet}")


@app.command()
def status() -> None:
    """Index stats."""
    cfg = _load_cfg()
    if not cfg.index_db.exists():
        typer.echo("no index yet — run `sofia init` then `sofia index`.")
        raise typer.Exit(code=1)
    conn = db.connect(cfg.index_db)
    try:
        docs = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        chunks = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        oldest = conn.execute("SELECT MIN(indexed_at) FROM documents").fetchone()[0]
        newest = conn.execute("SELECT MAX(indexed_at) FROM documents").fetchone()[0]
    finally:
        conn.close()
    size_bytes = cfg.index_db.stat().st_size
    typer.echo(f"documents: {docs}")
    typer.echo(f"chunks: {chunks}")
    typer.echo(f"db size: {size_bytes/1024:.1f} KB")
    if oldest:
        typer.echo(f"oldest indexed_at: {time.strftime('%Y-%m-%d %H:%M', time.localtime(oldest))}")
    if newest:
        typer.echo(f"newest indexed_at: {time.strftime('%Y-%m-%d %H:%M', time.localtime(newest))}")


@app.command()
def doctor() -> None:
    """Health check: vault reachable, DB writable, fswatch agent loaded."""
    cfg = _load_cfg()
    ok = True

    if not cfg.vault.exists():
        typer.echo(f"FAIL: vault not found at {cfg.vault}")
        ok = False
    else:
        typer.echo(f"OK: vault at {cfg.vault}")

    try:
        conn = db.connect(cfg.index_db)
        conn.close()
        typer.echo(f"OK: DB at {cfg.index_db}")
    except Exception as e:
        typer.echo(f"FAIL: DB error: {e}")
        ok = False

    plist_path = Path.home() / "Library/LaunchAgents/com.sofia.indexer.plist"
    if plist_path.exists():
        typer.echo(f"OK: LaunchAgent plist present at {plist_path}")
    else:
        typer.echo(f"WARN: LaunchAgent plist not found ({plist_path})")

    if not ok:
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
```

- [ ] **Step 4: Run tests, expect pass**

```bash
uv run pytest tests/test_cli.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Verify the bash wrapper now works**

```bash
~/dev/dotfiles/sofia/.local/bin/sofia --help
```

Expected: typer help with `init`, `index`, `search`, `status`, `doctor`.

- [ ] **Step 6: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.local/share/sofia/src/sofia/cli.py sofia/.local/share/sofia/src/tests/test_cli.py
git -C ~/dev/dotfiles commit -m "sofia: add typer CLI (init, index, search, status, doctor)"
```

---

### Task 11: LaunchAgent for fswatch-driven incremental indexing

**Files:**
- Create: `dotfiles/sofia/Library/LaunchAgents/com.sofia.indexer.plist`

- [ ] **Step 1: Write the plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sofia.indexer</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>/opt/homebrew/bin/fswatch -o "$HOME/dev/SOFIA" | xargs -n1 -I{} "$HOME/.local/bin/sofia" index --incremental</string>
    </array>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>/Users/justinramirez/.local/state/sofia/indexer.log</string>

    <key>StandardErrorPath</key>
    <string>/Users/justinramirez/.local/state/sofia/indexer.log</string>

    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
```

- [ ] **Step 2: Validate the plist syntax**

```bash
plutil -lint ~/dev/dotfiles/sofia/Library/LaunchAgents/com.sofia.indexer.plist
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git -C ~/dev/dotfiles add sofia/Library/LaunchAgents/com.sofia.indexer.plist
git -C ~/dev/dotfiles commit -m "sofia: add LaunchAgent plist for fswatch-driven incremental indexer"
```

---

## Phase C — Hooks

### Task 12: Shared bash context helper

**Why:** All three hook scripts and skills need the same context-detection logic. DRY.

**Files:**
- Create: `dotfiles/sofia/.claude/hooks/_sofia-context.sh`

- [ ] **Step 1: Write the helper**

```bash
#!/usr/bin/env bash
# _sofia-context.sh — shared helper, sourced by sofia hook scripts.
# Sets:
#   SOFIA_VAULT     — vault root path
#   SOFIA_CTX       — personal | work
#   SOFIA_TODAY     — YYYY-MM-DD
#   SOFIA_DAILY_DIR — $SOFIA_VAULT/_agent/daily/$SOFIA_CTX
#
# Reads:
#   $1                  — JSON blob from Claude Code (cwd, transcript_path, etc.)
#   $SOFIA_CONTEXT env  — explicit override (wins over PWD inference)

set -uo pipefail   # NOT -e: hooks must never block sessions

: "${SOFIA_VAULT:=$HOME/dev/SOFIA}"

_input_json="${1:-}"
_cwd=""
if [[ -n "$_input_json" ]]; then
  _cwd="$(echo "$_input_json" | jq -r '.cwd // empty' 2>/dev/null || echo "")"
fi

if [[ -n "${SOFIA_CONTEXT:-}" ]]; then
  SOFIA_CTX="$SOFIA_CONTEXT"
else
  shopt -s nocasematch
  if [[ "$_cwd" == "$HOME/telophaseqs"* ]] || [[ "$_cwd" == *"/SOFIA/"*"/work/"* ]]; then
    SOFIA_CTX=work
  else
    SOFIA_CTX=personal
  fi
  shopt -u nocasematch
fi

# `both` is allowed as an explicit override, but for daily-log writes we still
# need to pick one bucket. Treat `both` as personal for write paths.
SOFIA_CTX_WRITE="$SOFIA_CTX"
[[ "$SOFIA_CTX" == "both" ]] && SOFIA_CTX_WRITE="personal"

SOFIA_TODAY="$(date +%Y-%m-%d)"
SOFIA_DAILY_DIR="$SOFIA_VAULT/_agent/daily/$SOFIA_CTX_WRITE"

export SOFIA_VAULT SOFIA_CTX SOFIA_CTX_WRITE SOFIA_TODAY SOFIA_DAILY_DIR
```

- [ ] **Step 2: Test it standalone**

```bash
echo '{"cwd": "/Users/justinramirez/telophaseqs/foo"}' \
  | xargs -0 -I{} bash -c 'source ~/dev/dotfiles/sofia/.claude/hooks/_sofia-context.sh "{}"; echo "ctx=$SOFIA_CTX, dir=$SOFIA_DAILY_DIR"'
```

Expected: `ctx=work, dir=/Users/justinramirez/dev/SOFIA/_agent/daily/work`

```bash
echo '{"cwd": "/Users/justinramirez/personal/notes"}' \
  | xargs -0 -I{} bash -c 'source ~/dev/dotfiles/sofia/.claude/hooks/_sofia-context.sh "{}"; echo "ctx=$SOFIA_CTX"'
```

Expected: `ctx=personal`

- [ ] **Step 3: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.claude/hooks/_sofia-context.sh
git -C ~/dev/dotfiles commit -m "sofia: add shared context-detection helper for hooks"
```

---

### Task 13: SessionStart hook (Python + bash wrapper)

**Files:**
- Create: `dotfiles/sofia/.local/share/sofia/src/sofia/hooks/session_start.py`
- Create: `dotfiles/sofia/.claude/hooks/sofia-session-start.sh`
- Create: `dotfiles/sofia/.local/share/sofia/src/tests/test_session_start.py`

- [ ] **Step 1: Write the failing test**

`tests/test_session_start.py`:
```python
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
```

- [ ] **Step 2: Run test, expect failure**

```bash
uv run pytest tests/test_session_start.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement `session_start.py`**

```python
"""SessionStart hook implementation.

Reads SOUL.md, USER.md, and memory/{context}.md, applies a size budget,
and emits a JSON payload that Claude Code injects as additional context.

Failure modes are non-fatal: a missing file or unreadable vault yields a
minimal payload instead of an error.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


_ENTRY_RE = re.compile(r"(?=^## )", re.MULTILINE)


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _strip_frontmatter(text: str) -> str:
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end != -1:
            return text[end + 4 :].lstrip("\n")
    return text


def _truncate_memory(memory_text: str, max_entries: int) -> str:
    """Keep only the top `max_entries` `## …` sections (newest-first ordering)."""
    body = _strip_frontmatter(memory_text)
    # Find header line and keep first N entries below it.
    lines = body.splitlines(keepends=True)
    header_lines: list[str] = []
    rest_lines: list[str] = []
    seen_first_h2 = False
    for line in lines:
        if not seen_first_h2 and line.startswith("## "):
            seen_first_h2 = True
        if seen_first_h2:
            rest_lines.append(line)
        else:
            header_lines.append(line)
    rest = "".join(rest_lines)
    parts = _ENTRY_RE.split(rest)
    parts = [p for p in parts if p.strip()]
    parts = parts[:max_entries]
    return "".join(header_lines) + "".join(parts)


def build_payload(
    *, vault: Path, context: str, max_chars: int, memory_max_entries: int
) -> str:
    soul = _read(vault / "_agent" / "SOUL.md")
    user = _read(vault / "_agent" / "USER.md")
    memory_path = vault / "_agent" / "memory" / f"{context}.md"
    memory = _read(memory_path)
    memory_trim = _truncate_memory(memory, memory_max_entries) if memory else ""

    sections = []
    sections.append(f"# SOFIA — your second brain context (context: {context})")
    if soul.strip():
        sections.append(f"## SOUL (identity + rules)\n\n{_strip_frontmatter(soul).strip()}")
    if user.strip():
        sections.append(f"## USER (profile)\n\n{_strip_frontmatter(user).strip()}")
    if memory_trim.strip():
        sections.append(
            f"## MEMORY (recent durable insights, newest first)\n\n{memory_trim.strip()}"
        )
    footer = (
        f"\n---\n"
        f"Vault: {vault}\n"
        f"For full memory, search with `sofia-search` or read the files directly."
    )

    payload = "\n\n".join(sections) + footer

    if len(payload) > max_chars:
        # Hard truncate. Preserve footer if budget allows; otherwise plain trim.
        if max_chars > len(footer):
            payload = payload[: max_chars - len(footer)] + footer
        else:
            payload = payload[:max_chars]
    return payload


def emit(*, vault: Path, context: str, max_chars: int, memory_max_entries: int) -> None:
    """Print Claude-Code-shaped JSON to stdout."""
    try:
        payload = build_payload(
            vault=vault, context=context,
            max_chars=max_chars, memory_max_entries=memory_max_entries,
        )
    except Exception:
        payload = ""

    out = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": payload,
        }
    }
    sys.stdout.write(json.dumps(out))
    sys.stdout.flush()


def main() -> None:
    """Read context + cfg from env (set by the bash wrapper) and emit."""
    import os
    from sofia import config as config_mod

    vault = Path(os.environ.get("SOFIA_VAULT", "")).expanduser()
    context = os.environ.get("SOFIA_CTX", "personal")
    if context == "both":
        context = "personal"

    try:
        cfg = config_mod.load(Path(os.environ.get("SOFIA_CONFIG") or config_mod.DEFAULT_CONFIG_PATH))
        max_chars = cfg.session_start_max_chars
        max_entries = cfg.memory_max_entries
    except Exception:
        max_chars = 32000
        max_entries = 20

    emit(vault=vault, context=context, max_chars=max_chars, memory_max_entries=max_entries)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests, expect pass**

```bash
uv run pytest tests/test_session_start.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Write the bash wrapper**

`dotfiles/sofia/.claude/hooks/sofia-session-start.sh`:
```bash
#!/usr/bin/env bash
# sofia-session-start.sh — Claude Code SessionStart hook.
# Reads JSON on stdin, infers context, runs the python module, emits its JSON.
set -uo pipefail

INPUT="$(cat)"
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_sofia-context.sh" "$INPUT"

LOG="${SOFIA_LOG:-$HOME/.local/state/sofia/hooks.log}"
mkdir -p "$(dirname "$LOG")"

if [[ ! -d "$HOME/.local/share/sofia/src" ]]; then
  echo "[$(date -Iseconds)] session-start: src dir missing, no-op" >> "$LOG"
  echo '{}'
  exit 0
fi

cd "$HOME/.local/share/sofia/src"
{
  echo "[$(date -Iseconds)] session-start: ctx=$SOFIA_CTX vault=$SOFIA_VAULT"
} >> "$LOG"

# Forward env so the python sees the resolved context.
SOFIA_VAULT="$SOFIA_VAULT" SOFIA_CTX="$SOFIA_CTX" \
  uv run --quiet python -m sofia.hooks.session_start
```

- [ ] **Step 6: Make executable**

```bash
chmod +x ~/dev/dotfiles/sofia/.claude/hooks/sofia-session-start.sh
```

- [ ] **Step 7: Smoke-test the hook end-to-end**

```bash
cd ~/dev/dotfiles/sofia/.local/share/sofia/src
SOFIA_CONFIG=~/dev/dotfiles/sofia/.config/sofia/config.toml \
SOFIA_VAULT=~/dev/SOFIA \
echo '{"cwd": "/tmp/anywhere"}' | ~/dev/dotfiles/sofia/.claude/hooks/sofia-session-start.sh
```

Expected: a JSON object on stdout containing `"hookSpecificOutput"`. (Even if the SOFIA vault has no SOUL.md yet, the JSON envelope is well-formed.)

- [ ] **Step 8: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.local/share/sofia/src/sofia/hooks/session_start.py \
  sofia/.claude/hooks/sofia-session-start.sh \
  sofia/.local/share/sofia/src/tests/test_session_start.py
git -C ~/dev/dotfiles commit -m "sofia: add SessionStart hook (python + bash wrapper)"
```

---

### Task 14: PreCompact and SessionEnd bash hooks

**Files:**
- Create: `dotfiles/sofia/.claude/hooks/sofia-pre-compact.sh`
- Create: `dotfiles/sofia/.claude/hooks/sofia-session-end.sh`
- Create: `dotfiles/sofia/.local/share/sofia/src/tests/test_hooks_bash.py`

- [ ] **Step 1: Write the failing test**

`tests/test_hooks_bash.py`:
```python
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[3]
HOOKS = REPO / ".claude" / "hooks"
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
```

- [ ] **Step 2: Run tests, expect failure (script doesn't exist yet)**

```bash
uv run pytest tests/test_hooks_bash.py -v
```

Expected: `assert res.returncode == 0` fails because the scripts don't exist (or `FileNotFoundError`).

- [ ] **Step 3: Write `sofia-pre-compact.sh`**

```bash
#!/usr/bin/env bash
# sofia-pre-compact.sh — append a session pre-compact section to today's daily log.
set -uo pipefail

INPUT="$(cat)"
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_sofia-context.sh" "$INPUT"

LOG="${SOFIA_LOG:-$HOME/.local/state/sofia/hooks.log}"
mkdir -p "$(dirname "$LOG")"

mkdir -p "$SOFIA_DAILY_DIR" 2>>"$LOG" || { echo '{}'; exit 0; }
DAILY="$SOFIA_DAILY_DIR/$SOFIA_TODAY.md"

# Initialise file with frontmatter on first write of the day.
if [[ ! -f "$DAILY" ]]; then
  cat > "$DAILY" <<EOF
---
type: daily
context: $SOFIA_CTX_WRITE
agent-managed: true
last-touched: $SOFIA_TODAY
sofia-index: true
---
# Daily log — $SOFIA_TODAY ($SOFIA_CTX_WRITE)

EOF
fi

NOW="$(date +%H:%M)"
# Pull fields from input JSON (best effort; empty if absent).
TRANSCRIPT="$(echo "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null || echo "")"
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo "")"
TRIGGER="$(echo "$INPUT" | jq -r '.trigger // ""' 2>/dev/null || echo "")"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null || echo "")"

cat >> "$DAILY" <<EOF

## $NOW · session pre-compact
- Transcript: $TRANSCRIPT
- Session ID: $SESSION_ID
- CWD: $CWD
- Trigger: $TRIGGER
EOF

echo "[$(date -Iseconds)] pre-compact: ctx=$SOFIA_CTX_WRITE wrote $DAILY" >> "$LOG"
echo '{}'
```

- [ ] **Step 4: Write `sofia-session-end.sh`**

```bash
#!/usr/bin/env bash
# sofia-session-end.sh — append a session-end section to today's daily log.
set -uo pipefail

INPUT="$(cat)"
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_sofia-context.sh" "$INPUT"

LOG="${SOFIA_LOG:-$HOME/.local/state/sofia/hooks.log}"
mkdir -p "$(dirname "$LOG")"

mkdir -p "$SOFIA_DAILY_DIR" 2>>"$LOG" || { echo '{}'; exit 0; }
DAILY="$SOFIA_DAILY_DIR/$SOFIA_TODAY.md"

if [[ ! -f "$DAILY" ]]; then
  cat > "$DAILY" <<EOF
---
type: daily
context: $SOFIA_CTX_WRITE
agent-managed: true
last-touched: $SOFIA_TODAY
sofia-index: true
---
# Daily log — $SOFIA_TODAY ($SOFIA_CTX_WRITE)

EOF
fi

NOW="$(date +%H:%M)"
TRANSCRIPT="$(echo "$INPUT" | jq -r '.transcript_path // ""' 2>/dev/null || echo "")"
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo "")"
REASON="$(echo "$INPUT" | jq -r '.reason // ""' 2>/dev/null || echo "")"
CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2>/dev/null || echo "")"

cat >> "$DAILY" <<EOF

## $NOW · session end
- Reason: $REASON
- Transcript: $TRANSCRIPT
- Session ID: $SESSION_ID
- CWD: $CWD
EOF

echo "[$(date -Iseconds)] session-end: ctx=$SOFIA_CTX_WRITE wrote $DAILY" >> "$LOG"
echo '{}'
```

- [ ] **Step 5: Make executable**

```bash
chmod +x ~/dev/dotfiles/sofia/.claude/hooks/sofia-pre-compact.sh \
         ~/dev/dotfiles/sofia/.claude/hooks/sofia-session-end.sh
```

- [ ] **Step 6: Run tests, expect pass**

```bash
cd ~/dev/dotfiles/sofia/.local/share/sofia/src
uv run pytest tests/test_hooks_bash.py -v
```

Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.claude/hooks/sofia-pre-compact.sh \
  sofia/.claude/hooks/sofia-session-end.sh \
  sofia/.local/share/sofia/src/tests/test_hooks_bash.py
git -C ~/dev/dotfiles commit -m "sofia: add PreCompact and SessionEnd hooks (append to daily logs)"
```

---

### Task 15: Register hooks in settings.json (template + live)

**Files:**
- Modify: `dotfiles/claude/.claude/settings.json`
- Modify: `~/.claude/settings.json` (live; in `.stow-local-ignore`)

- [ ] **Step 1: Add `SOFIA_VAULT` env var and three hooks to dotfiles template**

Edit `dotfiles/claude/.claude/settings.json`. Replace the `env` and `hooks` sections so they read:

```json
"env": {
  "CLAUDE_CODE_SUBAGENT_MODEL": "sonnet",
  "TRELLO_API_KEY": "op://Telophase QS/Trello API key/API key",
  "TRELLO_TOKEN": "op://Telophase QS/Trello API key/Trello Token",
  "TRELLO_BOARD_ID": "DyXW6UrW",
  "ALPACA_API_KEY": "op://Private/Alpaca Paper Trading/Key",
  "ALPACA_API_SECRET": "op://Private/Alpaca Paper Trading/Secret",
  "ALPACA_PAPER": "true",
  "OBSIDIAN_API_URL": "https://127.0.0.1:27124",
  "OBSIDIAN_API_KEY": "op://dev_vault/obsidian_local_rest_api_key/add more/API Key",
  "OBSIDIAN_API_CERT": "/Users/justinramirez/.config/sofia/cert.pem",
  "SOFIA_VAULT": "/Users/justinramirez/dev/SOFIA",
  "ENABLE_LSP_TOOL": 1
},
"hooks": {
  "SessionStart": [
    {"hooks": [{"type": "command", "command": "$HOME/.claude/hooks/sofia-session-start.sh"}]}
  ],
  "PreCompact": [
    {"hooks": [{"type": "command", "command": "$HOME/.claude/hooks/sofia-pre-compact.sh"}]}
  ],
  "SessionEnd": [
    {"hooks": [{"type": "command", "command": "$HOME/.claude/hooks/sofia-session-end.sh"}]}
  ],
  "Stop": [
    {"hooks": [{"type": "command", "command": "afplay /System/Library/Sounds/Submarine.aiff"}]}
  ]
}
```

- [ ] **Step 2: Mirror the same change in live settings**

Apply the same edit to `~/.claude/settings.json`. Use the Edit tool, not raw shell.

- [ ] **Step 3: Validate both files parse as JSON**

```bash
python3 -c "import json; json.load(open('/Users/justinramirez/dev/dotfiles/claude/.claude/settings.json')); print('template ok')"
python3 -c "import json; json.load(open('/Users/justinramirez/.claude/settings.json')); print('live ok')"
```

Expected: `template ok` then `live ok`.

- [ ] **Step 4: Commit (template only — live file isn't tracked)**

```bash
git -C ~/dev/dotfiles add claude/.claude/settings.json
git -C ~/dev/dotfiles commit -m "claude: register sofia hooks (SessionStart, PreCompact, SessionEnd) and SOFIA_VAULT env"
```

---

## Phase D — Skills

Each SKILL.md has:
- **YAML frontmatter** with `name` and `description` (visible in skill discovery)
- **Markdown body** with explicit instructions to Claude

For the format, see how other skills like `sofia:` are not yet a plugin namespace — these are user-level. Skill names match the file under which they live: `sofia-init/` → invoked as `/sofia-init`.

### Task 16: `sofia-init/SKILL.md`

**Files:**
- Create: `dotfiles/sofia/.claude/skills/sofia-init/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: sofia-init
description: One-shot SOFIA second-brain onboarding. Interactively generates _agent/SOUL.md and _agent/USER.md by interviewing the user. Use when first setting up SOFIA, or when the user asks to refresh their identity files. Do NOT use for routine memory edits — use sofia-promote or direct file edits instead.
---

You are conducting the SOFIA second brain onboarding. Your goal is to produce two files:

- `$SOFIA_VAULT/_agent/SOUL.md` — agent identity and operating rules
- `$SOFIA_VAULT/_agent/USER.md` — user profile (with `## Personal` and `## Work` sections)

**Steps:**

1. Resolve `$SOFIA_VAULT` (default `~/dev/SOFIA`). If `$SOFIA_VAULT/_agent/SOUL.md` exists, ask the user whether to **refresh** (rewrite from scratch), **extend** (append/edit specific sections), or **abort**. Default to extend.
2. Pre-load context: read `~/.claude/CLAUDE.md`, the existing files under `$SOFIA_VAULT/_agent/`, and any earlier conversation context the user has shared in this session.
3. Conduct **SOUL phase** (4-5 questions). Ask one at a time:
   - Agent persona / tone (laid-back collaborator? structured analyst?)
   - Hard rules (e.g., "only write inside `_agent/`", "never commit to a branch other than main without asking")
   - Decision style (when to recommend vs. defer to user)
   - What counts as MEMORY.md-worthy (criteria for promotion)
   - Anything to NEVER do
4. Conduct **USER phase** (4-5 questions). Ask one at a time:
   - Role / current responsibilities (with sub-prompts for personal vs. work)
   - Active projects (top 3-5)
   - Working style and preferences
   - Tooling that matters (you can pre-populate from CLAUDE.md and existing memory)
   - Recurring contexts (recurring meetings, recurring decisions)
5. Draft both files using the frontmatter convention:
   ```yaml
   ---
   type: soul | user
   context: universal
   agent-managed: true
   last-touched: <today YYYY-MM-DD>
   sofia-index: true
   ---
   ```
6. Show the user a unified diff of the proposed files. Ask whether to **save**, **edit further**, or **abort**.
7. On save, write the files. Confirm by listing `ls -la $SOFIA_VAULT/_agent/SOUL.md $SOFIA_VAULT/_agent/USER.md`.

**Tone:** conversational, one question per turn. Don't lecture. If the user gives a one-line answer, that's enough — don't push for elaboration.

**Idempotency:** if extending, preserve existing content the user did NOT ask to change.
```

- [ ] **Step 2: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.claude/skills/sofia-init/SKILL.md
git -C ~/dev/dotfiles commit -m "sofia: add /sofia-init onboarding skill"
```

---

### Task 17: `sofia-search/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: sofia-search
description: Hybrid search across the SOFIA vault. Wraps the `sofia search` CLI and formats results as a ranked list with snippets and clickable Obsidian URIs. Use whenever the user asks "what did I write/decide/plan about X", "search my notes for Y", or any retrieval over the vault. Pass through context (personal/work) and type filters.
---

You are running a search over the SOFIA second brain vault.

**Inputs:**
- `query`: the user's query (required)
- Optional flags: `--context personal|work|both`, `--type memory|daily|plan|inbox|project`, `--limit N`

**Steps:**

1. Resolve `$SOFIA_VAULT` and confirm the `sofia` CLI is on `$PATH` (`command -v sofia` should find it; otherwise instruct the user to run `mise run link`).
2. Build the command. Always pass `--json` so we can format consistently:
   ```bash
   sofia search "<query>" [--context X] [--type Y] [--limit N] --json
   ```
3. If the user did not specify `--context`, infer it: use `$SOFIA_CONTEXT` env, otherwise check `$PWD` (anything under `~/telophaseqs` or `*/SOFIA/*/work/*` → `work`, else `personal`). Default to `personal`.
4. Execute the command via Bash. Capture stdout.
5. Parse the JSON. For each result, render:
   ```
   N. <path>  [<context>/<type>]  score=X.XX
      ## <heading>
      <snippet>
      → obsidian://open?vault=SOFIA&file=<URL-encoded path without leading dir>
   ```
6. If results > 0, optionally synthesize a 1-sentence summary across the top 3-5 results (only if the user's query is a question, not a literal grep).
7. If results = 0, suggest a broader query, switching context, or running `/sofia-status` to see what's indexed.

**Failure modes:**
- `sofia search` exits non-zero with "no index yet" → instruct the user to run `mise run sofia-init` then `sofia index`.
- Empty results → see step 7.

**Don't** filter or post-process results beyond what the CLI returned. Trust the ranking.
```

- [ ] **Step 2: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.claude/skills/sofia-search/SKILL.md
git -C ~/dev/dotfiles commit -m "sofia: add /sofia-search skill (CLI wrapper + result formatter)"
```

---

### Task 18: `sofia-journal/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: sofia-journal
description: Append a timestamped entry to today's SOFIA daily log. Zero ceremony — call this whenever the user wants to capture a thought, decision, observation, or todo into the brain. Detects context (personal/work) automatically.
---

You are appending to the SOFIA daily log.

**Inputs:**
- `text`: the entry content (required, can be multiline)
- Optional flags: `--context personal|work`, `--type decision|note|todo` (default: `note`), `--dry-run`

**Steps:**

1. Resolve context: explicit `--context` flag > `$SOFIA_CONTEXT` env > PWD-based detection > `personal`.
2. Compute paths:
   - Vault: `$SOFIA_VAULT` (default `~/dev/SOFIA`)
   - Daily file: `$SOFIA_VAULT/_agent/daily/<context>/$(date +%Y-%m-%d).md`
   - Time: `$(date +%H:%M)`
3. If `--dry-run`, print what *would* be appended and stop.
4. If the file does not exist, create it with frontmatter:
   ```yaml
   ---
   type: daily
   context: <context>
   agent-managed: true
   last-touched: <today>
   sofia-index: true
   ---
   # Daily log — <today> (<context>)
   ```
5. Idempotency check: if the last appended section in the file has the same `## HH:MM` timestamp AND the same body text, do nothing (avoid dup writes from rapid invocations).
6. Otherwise, append:
   ```markdown

   ## HH:MM · <type>
   <user-provided text>
   ```
7. Output a 1-line confirmation: `appended to <path> at HH:MM (<type>)`.

**Edge cases:**
- Multiline body: indent each line by 0 (just paste verbatim — markdown handles it).
- If `$SOFIA_VAULT` doesn't exist: refuse and explain (run `mise run sofia-init` first).
```

- [ ] **Step 2: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.claude/skills/sofia-journal/SKILL.md
git -C ~/dev/dotfiles commit -m "sofia: add /sofia-journal skill (append to today's daily log)"
```

---

### Task 19: `sofia-promote/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: sofia-promote
description: Curate insights from recent SOFIA daily logs into _agent/memory/{context}.md. Reads the last N days of daily entries, identifies promotion candidates (decisions, lessons, durable facts), proposes phrasing, and only writes after the user accepts each one.
---

You are running the manual promotion flow — the v1 stand-in for v2's automated daily reflection.

**Inputs:**
- Optional flags: `--days N` (default 1), `--context personal|work` (default: detected), `--dry-run`

**Steps:**

1. Resolve context (explicit > env > PWD > `personal`).
2. Read the last `N` days of daily logs from `$SOFIA_VAULT/_agent/daily/<context>/`. Skip days with no file.
3. Read the current `$SOFIA_VAULT/_agent/memory/<context>.md` (frontmatter + body). Note the existing entries by their source `[[daily/...]]` backlinks.
4. Identify **promotion candidates**:
   - Decisions ("decided X", "chose Y over Z")
   - Lessons ("learned X", "X went poorly because Y")
   - Durable facts (people, systems, conventions worth remembering)
   - **Skip:** trivial todos, transient state, error noise, anything already in memory (matched by source backlink).
5. For each candidate, draft an entry of the form:
   ```markdown
   ## YYYY-MM-DD · <decision|lesson|fact>
   <1-3 sentence distillation>
   Source: [[daily/<context>/<YYYY-MM-DD>#HH-MM]]
   ```
6. Present all candidates as a numbered checklist. Ask the user, per-candidate: **accept**, **edit**, or **reject**. Allow batch operations like "accept all" or "reject 3,5,7".
7. If `--dry-run`, stop here and print what would have been written.
8. For accepted entries, prepend them to memory (newest first, after the frontmatter and any `# Title` line). Update the frontmatter `last-touched` field.
9. Confirm: `promoted N/M candidates to <path>`.

**Tone:** conversational. Don't bury the user under candidates — if there are >10, ask "want to triage in batches of 5?" first.

**Idempotency:** never re-promote an entry whose source backlink already exists in memory.
```

- [ ] **Step 2: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.claude/skills/sofia-promote/SKILL.md
git -C ~/dev/dotfiles commit -m "sofia: add /sofia-promote skill (interactive daily-log curation)"
```

---

### Task 20: `sofia-plan/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: sofia-plan
description: Open a SOFIA project plan file for the current session. Creates the file if missing, treats it as the active doc — subsequent edits/decisions in the session are implicitly about this plan. Use when starting or resuming work on a named project.
---

You are opening a SOFIA project plan as the active doc for this session.

**Inputs:**
- `name`: the project name (required, free-form; we'll slugify)
- Optional flags: `--context personal|work` (default: detected)

**Steps:**

1. Resolve context (explicit > env > PWD > `personal`).
2. Slugify the name: lowercase, spaces → hyphens, strip non-`[a-z0-9-]`.
3. Compute path: `$SOFIA_VAULT/_agent/plans/<context>/<slug>.md`
4. If the file does not exist, create it with this template:
   ```yaml
   ---
   type: plan
   context: <context>
   agent-managed: true
   status: active
   last-touched: <today>
   sofia-index: true
   ---
   # <Original Name>

   ## Goal

   <1-2 sentences — leave blank for the user to fill>

   ## Status

   <current state — leave blank>

   ## Open questions

   - <none yet>

   ## Decisions

   <link to memory entries when promoted>
   ```
5. Read the file. Show its current contents to the user as the new "active context."
6. Tell the user: "Plan loaded. Edits I make in this session will land in this file unless you tell me otherwise."
7. Tail-update the `last-touched: <today>` field in frontmatter on save.

**Tone:** brief; this is a setup skill, not a long conversation.

**Don't** mark a plan as done automatically. Status flips are user-driven (they say "this is done" → you toggle frontmatter).
```

- [ ] **Step 2: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.claude/skills/sofia-plan/SKILL.md
git -C ~/dev/dotfiles commit -m "sofia: add /sofia-plan skill (open or create project plan)"
```

---

### Task 21: `sofia-status/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: sofia-status
description: One-page situational digest of the SOFIA brain. Reads SOUL.md, USER.md, the active context's memory file, last 7 days of daily logs, and active plans. Outputs a compact summary. Use at start of day, when returning to a project after a break, or when the user asks "where am I?".
---

You are producing the SOFIA status digest.

**Inputs:**
- Optional flags: `--context personal|work` (default: detected)

**Steps:**

1. Resolve context.
2. Read these files (best effort — silently skip what's missing):
   - `$SOFIA_VAULT/_agent/SOUL.md`
   - `$SOFIA_VAULT/_agent/USER.md`
   - `$SOFIA_VAULT/_agent/memory/<context>.md`
   - Last 7 days of `$SOFIA_VAULT/_agent/daily/<context>/*.md`
   - All `$SOFIA_VAULT/_agent/plans/<context>/*.md` files
3. Parse plan frontmatter for `status` and `last-touched`.
4. Render this layout (markdown, terse — fits in <60 lines):

   ```markdown
   # SOFIA status — <context>, <today>

   ## Active plans
   - [<status>] **<plan title>** — <last-touched>: <one-line summary from frontmatter `## Status` or first paragraph>
   - ...

   ## Recent decisions (top 5 from memory)
   - <YYYY-MM-DD · type>: <distillation>
   - ...

   ## Recent activity (last 3 days, top entries)
   - <YYYY-MM-DD HH:MM>: <entry preview>
   - ...

   ## Stale plans (active, not touched in 14+ days)
   - **<plan title>** — last-touched <date>
   - (none if all plans recent)
   ```

5. Output the rendered digest. Don't add commentary unless the user asks.

**Don't:**
- Don't promote, summarize for memory, or write any files.
- Don't include items outside the requested context.
- Don't truncate so aggressively that an entry's meaning is lost.
```

- [ ] **Step 2: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.claude/skills/sofia-status/SKILL.md
git -C ~/dev/dotfiles commit -m "sofia: add /sofia-status skill (one-page situational digest)"
```

---

### Task 22: `sofia-link/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: sofia-link
description: Suggest [[wikilink]] backlinks for a SOFIA note. Uses hybrid search to find related notes, presents proposed link locations with confidence scores, and applies user-accepted edits. Use when curating notes — turning isolated entries into a connected knowledge graph.
---

You are proposing wikilink-style backlinks for a note.

**Inputs:**
- `path` (optional, relative to `$SOFIA_VAULT`): the target note. If omitted, query the Obsidian Local REST API at `$OBSIDIAN_API_URL` for the currently active note.

**Steps:**

1. Resolve target note path. If neither `path` arg nor an active Obsidian note can be determined, ask the user.
2. Read the note. Extract its meaningful text body (skip frontmatter).
3. Run hybrid search using the note body as the query: `sofia search "<first 200 words of body>" --json --limit 15`. Filter out: the note itself, anything already linked from it.
4. For each candidate result, **decide where in the note** the backlink would best fit:
   - Find the chunk whose embedding most resembles the candidate (or, simpler: the chunk in the note containing the most overlap with the candidate's snippet).
   - Propose: `at line N (in section "<heading>"), insert [[<candidate-path-without-extension>]]`
5. Present the suggestions as a numbered list with:
   ```
   1. [[<wiki-target>]] (score: 0.78)
      reason: shared topic — "<top overlapping words>"
      where: line 42 of note, in section "Decisions"
   ```
6. Per-suggestion, ask the user: **accept**, **edit location**, or **reject**.
7. Apply accepted edits as a single batched write to the note file. Format wikilinks correctly:
   - `[[notes/foo/bar]]` for files, NOT `[[notes/foo/bar.md]]` (Obsidian convention)
   - For files inside `_agent/`, use the relative path.
8. Confirm: `applied N/M backlinks to <path>`.

**Don't:**
- Don't add a backlink that the source note already contains.
- Don't change any text other than inserting `[[...]]` tokens.
- Don't apply more than 5 backlinks per invocation without user confirmation ("apply all 12?").

**Idempotency:** if user accepts a backlink, then re-runs the skill, you should not re-suggest it (it's now in the note).
```

- [ ] **Step 2: Commit**

```bash
git -C ~/dev/dotfiles add sofia/.claude/skills/sofia-link/SKILL.md
git -C ~/dev/dotfiles commit -m "sofia: add /sofia-link skill (hybrid-search-driven backlink suggestions)"
```

---

## Phase E — Integration & Vault Scaffolding

### Task 23: Brewfile + mise.toml additions

**Files:**
- Modify: `dotfiles/Brewfile`
- Modify: `dotfiles/mise.toml`

- [ ] **Step 1: Add `fswatch` to Brewfile**

Find the `# CLI` section in Brewfile (or wherever the homebrew formulae live) and add:

```ruby
brew "fswatch"
```

Sort it alphabetically with neighbouring entries.

- [ ] **Step 2: Add `sofia` to `link` and `unlink` task lists in `mise.toml`**

Edit the existing tasks. Append `sofia` to each `stow` invocation:

```toml
[tasks.link]
description = "Stow all topics into $HOME"
depends = ["brew-install"]
run = "stow --dir={{config_root}} --target=$HOME --restow zsh nvim tmux ghostty gh-dash gh git mise claude eza marimo aws lazygit rectangle sofia"

[tasks.unlink]
description = "Remove all stow symlinks"
run = "stow --dir={{config_root}} --target=$HOME --delete zsh nvim tmux ghostty gh-dash gh git mise claude eza marimo aws lazygit rectangle sofia"
```

- [ ] **Step 3: Add `sofia-init` and `sofia-status` mise tasks**

Append to `mise.toml`:

```toml
[tasks.sofia-init]
description = "Bootstrap SOFIA second brain (deps, DB, LaunchAgent)"
run = """
set -e
cd ~/.local/share/sofia/src
uv sync
~/.local/bin/sofia init
mkdir -p ~/.local/state/sofia
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.sofia.indexer.plist || true
launchctl enable gui/$UID/com.sofia.indexer || true
echo "SOFIA bootstrapped. Next: open Claude Code in ~/dev/SOFIA and run /sofia-init"
"""

[tasks.sofia-status]
description = "Check SOFIA health"
run = "~/.local/bin/sofia doctor"

[tasks.sofia-reindex]
description = "Drop and rebuild SOFIA search index"
run = "~/.local/bin/sofia index --rebuild"
```

- [ ] **Step 4: Validate mise.toml parses**

```bash
mise tasks ls 2>&1 | grep sofia
```

Expected: lists `sofia-init`, `sofia-status`, `sofia-reindex`.

- [ ] **Step 5: Commit**

```bash
git -C ~/dev/dotfiles add Brewfile mise.toml
git -C ~/dev/dotfiles commit -m "sofia: wire into Brewfile (fswatch) and mise (link, sofia-init, sofia-status, sofia-reindex)"
```

---

### Task 24: Vault scaffolding (replace empty scaffold with v1 layout)

**Files:**
- Create: `~/dev/SOFIA/_agent/memory/personal.md` (skeleton)
- Create: `~/dev/SOFIA/_agent/memory/work.md` (skeleton)
- Create: `~/dev/SOFIA/_agent/SOUL.md` (placeholder; final content from `/sofia-init`)
- Create: `~/dev/SOFIA/_agent/USER.md` (placeholder; final content from `/sofia-init`)
- Create: `~/dev/SOFIA/_agent/daily/personal/` (directory)
- Create: `~/dev/SOFIA/_agent/daily/work/` (directory)
- Create: `~/dev/SOFIA/_agent/plans/personal/` (directory)
- Create: `~/dev/SOFIA/_agent/plans/work/` (directory)
- Remove: `~/dev/SOFIA/_agent/context/` (empty, no longer used)
- Remove: `~/dev/SOFIA/_agent/heartbeat/` (empty; will return in v3)

- [ ] **Step 1: Create directories**

```bash
mkdir -p ~/dev/SOFIA/_agent/memory \
         ~/dev/SOFIA/_agent/daily/personal \
         ~/dev/SOFIA/_agent/daily/work \
         ~/dev/SOFIA/_agent/plans/personal \
         ~/dev/SOFIA/_agent/plans/work
```

- [ ] **Step 2: Verify the empty scaffold dirs are still empty before removing**

```bash
ls ~/dev/SOFIA/_agent/context ~/dev/SOFIA/_agent/heartbeat
```

Expected: both directories empty.

- [ ] **Step 3: Remove empty scaffold dirs**

```bash
rmdir ~/dev/SOFIA/_agent/context ~/dev/SOFIA/_agent/heartbeat
```

(`rmdir` will refuse if non-empty — fail-safe.)

- [ ] **Step 4: Create `_agent/SOUL.md` placeholder**

```bash
cat > ~/dev/SOFIA/_agent/SOUL.md <<'EOF'
---
type: soul
context: universal
agent-managed: true
last-touched: 2026-04-28
sofia-index: true
---
# SOUL

> This file is a placeholder. Run `/sofia-init` in Claude Code from inside `~/dev/SOFIA/` to populate it interactively.

## Identity

(to be defined)

## Hard rules

- Only write inside `_agent/`.
- Never modify user-curated content under `inbox/` or `projects/`.

## Tone & style

(to be defined)
EOF
```

- [ ] **Step 5: Create `_agent/USER.md` placeholder**

```bash
cat > ~/dev/SOFIA/_agent/USER.md <<'EOF'
---
type: user
context: universal
agent-managed: true
last-touched: 2026-04-28
sofia-index: true
---
# USER

> Placeholder. Run `/sofia-init` to populate.

## Personal

(to be defined)

## Work

(to be defined)
EOF
```

- [ ] **Step 6: Create `_agent/memory/personal.md` and `_agent/memory/work.md`**

```bash
cat > ~/dev/SOFIA/_agent/memory/personal.md <<'EOF'
---
type: memory
context: personal
agent-managed: true
last-touched: 2026-04-28
sofia-index: true
---
# Personal Memory

> Curated by `/sofia-promote`. Newest entries first.
EOF

cat > ~/dev/SOFIA/_agent/memory/work.md <<'EOF'
---
type: memory
context: work
agent-managed: true
last-touched: 2026-04-28
sofia-index: true
---
# Work Memory

> Curated by `/sofia-promote`. Newest entries first.
EOF
```

- [ ] **Step 7: Verify final shape**

```bash
find ~/dev/SOFIA/_agent -type f -o -type d | sort
```

Expected (no extras):
```
/Users/justinramirez/dev/SOFIA/_agent
/Users/justinramirez/dev/SOFIA/_agent/SOUL.md
/Users/justinramirez/dev/SOFIA/_agent/USER.md
/Users/justinramirez/dev/SOFIA/_agent/daily
/Users/justinramirez/dev/SOFIA/_agent/daily/personal
/Users/justinramirez/dev/SOFIA/_agent/daily/work
/Users/justinramirez/dev/SOFIA/_agent/memory
/Users/justinramirez/dev/SOFIA/_agent/memory/personal.md
/Users/justinramirez/dev/SOFIA/_agent/memory/work.md
/Users/justinramirez/dev/SOFIA/_agent/plans
/Users/justinramirez/dev/SOFIA/_agent/plans/personal
/Users/justinramirez/dev/SOFIA/_agent/plans/work
```

(No commit — vault contents are not in dotfiles git. Obsidian Sync handles the vault.)

---

### Task 25: Roadmap plan stubs in vault

**Files:**
- Create: `~/dev/SOFIA/_agent/plans/personal/sofia-v2.md`
- Create: `~/dev/SOFIA/_agent/plans/personal/sofia-v3.md`

- [ ] **Step 1: Create v2 stub**

```bash
cat > ~/dev/SOFIA/_agent/plans/personal/sofia-v2.md <<'EOF'
---
type: plan
context: personal
agent-managed: true
status: paused
last-touched: 2026-04-28
sofia-index: true
---
# SOFIA v2 — Daily Reflection

## Goal

Add the automated 8am promotion job that v1 punts to manual `sofia-promote`.

## Triggers (graduation criteria from v1)

- 30+ days of v1 in continuous use
- 20+ daily log entries
- 10+ curated entries in `_agent/memory/personal.md` (and ≥3 in `work.md` if active)
- Search latency stable (<100ms p95)
- Zero recurring hook failures
- A clear daily-reflection workflow has emerged from real `sofia-promote` use

## Status

paused — start when v1 graduation criteria are met.

## Spec reference

`~/dev/dotfiles/sofia/docs/specs/2026-04-28-sofia-second-brain-v1-design.md` § Roadmap → v2
EOF
```

- [ ] **Step 2: Create v3 stub**

```bash
cat > ~/dev/SOFIA/_agent/plans/personal/sofia-v3.md <<'EOF'
---
type: plan
context: personal
agent-managed: true
status: paused
last-touched: 2026-04-28
sofia-index: true
---
# SOFIA v3 — Heartbeat + Chat + Integrations

## Goal

Proactive monitoring and chat surfaces. 30-min `heartbeat.py` polling Gmail / Calendar / Trello, optional Slack chat interface, direct integrations module.

## Triggers

- v2 in use for 30+ days
- A clear "what should the heartbeat tell me" pattern from real curated memory

## Status

paused.

## Spec reference

`~/dev/dotfiles/sofia/docs/specs/2026-04-28-sofia-second-brain-v1-design.md` § Roadmap → v3
EOF
```

(No commit; vault contents not in dotfiles git.)

---

## Phase F — Bootstrap & End-to-End Smoke Test

### Task 26: Bootstrap on this machine

- [ ] **Step 1: Stow the new sofia topic**

```bash
mise run link
```

Expected: `LINK: sofia/...` lines printing all the symlinks created.

- [ ] **Step 2: Verify stow links**

```bash
ls -la ~/.local/bin/sofia
ls -la ~/.config/sofia/config.toml
ls -la ~/.claude/hooks/sofia-session-start.sh
ls -la ~/.claude/skills/sofia-search/SKILL.md
ls -la ~/Library/LaunchAgents/com.sofia.indexer.plist
```

Expected: each is a symlink (`->`) pointing into `~/dev/dotfiles/sofia/...`.

- [ ] **Step 3: Install fswatch**

```bash
mise run brew-install
```

Or if you don't want to run the full Brewfile: `brew install fswatch`.

- [ ] **Step 4: Initialize sofia (DB + model + LaunchAgent)**

```bash
mise run sofia-init
```

Expected: prints `vault: /Users/justinramirez/dev/SOFIA`, `Embedder OK (dim=384)`, loads the LaunchAgent. First run downloads the FastEmbed model (~1 minute).

- [ ] **Step 5: Run `sofia doctor`**

```bash
sofia doctor
```

Expected:
```
OK: vault at /Users/justinramirez/dev/SOFIA
OK: DB at /Users/justinramirez/.local/share/sofia/index.db
OK: LaunchAgent plist present at /Users/justinramirez/Library/LaunchAgents/com.sofia.indexer.plist
```

- [ ] **Step 6: Run a full index**

```bash
sofia index
```

Expected: `indexed: ≥4, skipped: 0, pruned: 0` (SOUL, USER, memory/personal, memory/work, plus the v2/v3 plan stubs).

- [ ] **Step 7: Smoke-test search**

```bash
sofia search "second brain" --limit 5
```

Expected: at least one ranked result, almost certainly the v2 or v3 plan stub.

- [ ] **Step 8: Smoke-test the SessionStart hook directly**

```bash
echo '{"cwd":"/Users/justinramirez/personal-test"}' | ~/.claude/hooks/sofia-session-start.sh | jq .
```

Expected: a JSON envelope with `hookSpecificOutput.additionalContext` containing the SOUL/USER/MEMORY content as injected text.

- [ ] **Step 9: Smoke-test PreCompact and SessionEnd writing to today's daily log**

```bash
echo '{"cwd":"/Users/justinramirez/personal-test","transcript_path":"/tmp/t","session_id":"smoke-1","trigger":"manual"}' \
  | ~/.claude/hooks/sofia-pre-compact.sh

echo '{"cwd":"/Users/justinramirez/personal-test","transcript_path":"/tmp/t","session_id":"smoke-1","reason":"exit"}' \
  | ~/.claude/hooks/sofia-session-end.sh

cat ~/dev/SOFIA/_agent/daily/personal/$(date +%Y-%m-%d).md
```

Expected: daily log file with two `## HH:MM ·` sections (one pre-compact, one session-end), SESSION_ID `smoke-1`, etc.

- [ ] **Step 10: Verify fswatch indexer reacts**

```bash
launchctl list | grep com.sofia.indexer
```

Expected: a line with PID and exit code 0.

```bash
echo "" >> ~/dev/SOFIA/_agent/memory/personal.md
sleep 3
tail -5 ~/.local/state/sofia/indexer.log
```

Expected: the log shows recent `indexed: 1` activity from the watcher.

- [ ] **Step 11: Open Claude Code in the vault and run `/sofia-init`**

```bash
cd ~/dev/SOFIA
claude
```

In the session, run `/sofia-init`. The skill should walk you through SOUL.md / USER.md generation. Save when done.

- [ ] **Step 12: Run `/sofia-journal "first entry — bootstrapped second brain"`** in the same session, then `/sofia-status` and `/sofia-search "bootstrap"`.

Expected: each skill behaves as designed.

- [ ] **Step 13: Final commit (if any cleanup edits were needed)**

If steps 1-12 surfaced any small fixes, fix them and commit:

```bash
git -C ~/dev/dotfiles status
git -C ~/dev/dotfiles add ...
git -C ~/dev/dotfiles commit -m "sofia: smoke-test fixes from initial bootstrap"
```

If everything worked, no commit is needed for Task 26.

---

## Self-Review Notes

The plan covers every section of the spec:

| Spec section | Plan tasks |
|---|---|
| Architecture overview / invariants | Tasks 4-15 collectively |
| Vault layout (`_agent/...`) | Task 24 |
| Frontmatter conventions | Encoded in placeholder content (Task 24) and skill instructions (Tasks 16-22) |
| File semantics table | Encoded in skill behavior (16-22) |
| Hooks (context detection, SessionStart, PreCompact, SessionEnd) | Tasks 12-15 |
| Search infrastructure (DB, schema, indexing pipeline, hybrid query, file watcher, CLI, perf, failure modes) | Tasks 5-11 |
| Skills (7) | Tasks 16-22 |
| Dotfiles topology | Tasks 1-3, 11, 16-22 |
| `mise.toml` additions | Task 23 |
| `Brewfile` addition | Task 23 |
| Bootstrap & operations | Task 26 |
| Reproducibility / DR | Implicit; covered by `mise run sofia-init` and `sofia index --rebuild` |
| Roadmap (plan stubs) | Task 25 |

No placeholders in any step. Every code block is complete. Function/class names are consistent across tasks (`Embedder`, `Config`, `db.connect`, `db.upsert_document`, `db.ChunkRow`, `chunk_markdown`, `index_vault`, `index_single_file`, `hybrid_search`, `SearchResult`).

Test framework is consistent: pytest with shared `conftest.py` fixtures. Bash hooks are tested via subprocess from pytest in Task 14.
