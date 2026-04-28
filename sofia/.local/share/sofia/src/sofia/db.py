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
        # Delete old chunks (cascades via FK; explicit delete on chunks_vec/fts since they're virtual)
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
