from __future__ import annotations

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
